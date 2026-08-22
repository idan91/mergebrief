// The /comments family, behind the pr subtree's shared per-repo gate:
//   POST /                                  — publish one held draft comment
//   POST /:commentId/replies                — reply to a review comment
//   POST /:commentId/{resolve,unresolve}    — flip a thread's state
//
// All four run their GitHub write with the VIEWER's token (authorship stays
// the reviewer's): lazy-decrypt + refresh-once, fresh repo re-resolve before
// the mutating call (gated-route rule). NOT gated on viewerIsAuthor or draft:
// GitHub separately authorizes each write (anyone with repo access may
// comment/reply; push permission or PR authorship flips a thread), so no
// capability check of its own is needed here.
//
// Every one of these IS a conversation write, so success calls the injected
// `evictConversation` hook — the conversation module owns the cache.
import type { Context } from "hono";
import {
  createInlineReviewComment,
  createReviewCommentReply,
  createUserOctokit,
  fetchRepositoryById,
  GitHubApiErrorCode,
  ReviewCommentSide,
  setReviewThreadResolution,
  type GitHubApiError,
  type InlineReviewCommentError,
  type InlineReviewCommentResult,
  type SetReviewThreadResolutionResult,
} from "github";
import {
  AnchorStatus,
  decryptToken,
  DraftCommentSide,
  DraftCommentStatus,
  forTenant,
  type InstallationId,
  type RepoId,
  type ReviewDraftCommentRow,
} from "persistence";
import type { Result } from "types";
import { z } from "zod";
import { refreshSessionToken, type AuthRouteDeps } from "../../auth/session";
import type { AuthzEnv } from "../../authz";
import { ApiErrorCode, errorJson } from "../../../error-response";
import { stampAuditTarget } from "../../../product-operations/audit";
import { PRODUCT_ACTION_ID } from "../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../product-operations/types";
import {
  mapWriteFailure as sessionFailure,
  resolveWrite,
} from "./session/write-resolve";
import { commitShaSchema, MAX_BODY_LENGTH, rowIdSchema } from "./wire-bounds";

// ---------------------------------------------------------------------------
// Boundary schemas — both routes NAME a draft the server holds; neither
// carries a body. The body, the anchor and the commit all come off rows the
// session already stores, so there is no second copy to reconcile.
//
// The commit is the named Brief's head — the revision the reviewer read.
// A Brief whose head is not a commit sha has nothing GitHub can anchor to,
// which is a deterministic 400 rather than an upstream 422.
// ---------------------------------------------------------------------------

const publishDraftSchema = z.object({ draftId: rowIdSchema });

const prNumberSchema = z.coerce.number().int().positive();
/** A reply/thread target id is a REST comment id — bounded by JS integer precision. */
const commentIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .refine((value) => Number.isSafeInteger(value));

const replyBodySchema = z.object({
  body: z.string().min(1).max(MAX_BODY_LENGTH),
});

/** The stored side vocabulary as GitHub names it. */
const SIDE_ON_GITHUB: Readonly<Record<DraftCommentSide, ReviewCommentSide>> = {
  [DraftCommentSide.OLD]: ReviewCommentSide.LEFT,
  [DraftCommentSide.NEW]: ReviewCommentSide.RIGHT,
};

/** A stored draft as GitHub's inline-comment coordinates. */
function readDraftAnchor(draft: ReviewDraftCommentRow): {
  path: string;
  line: number;
  side: ReviewCommentSide;
  startLine?: number;
  startSide?: ReviewCommentSide;
} {
  const anchor: ReturnType<typeof readDraftAnchor> = {
    path: draft.filePath,
    line: draft.endLine,
    side: SIDE_ON_GITHUB[draft.side],
  };
  // A two-side range is multi-line by definition; same-side needs the span.
  const multiLine = draft.startSide !== null || draft.startLine < draft.endLine;
  if (multiLine) {
    anchor.startLine = draft.startLine;
    anchor.startSide = SIDE_ON_GITHUB[draft.startSide ?? draft.side];
  }
  return anchor;
}

/** The request body, or `undefined` when it is not JSON at all. */
async function jsonBody(c: Context<AuthzEnv>): Promise<unknown> {
  return c.req.json().catch(() => undefined);
}

/** Split the gate's verified `owner/name`; `undefined` on a non-slug shape. */
function splitRepoSlug(
  fullName: string,
): { owner: string; repo: string } | undefined {
  const parts = fullName.split("/");
  const [owner, repo] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    owner === "" ||
    repo === undefined ||
    repo === ""
  ) {
    return undefined;
  }
  return { owner, repo };
}

/** Decrypt a session's stored access token; `undefined` if it is unreadable. */
async function resolveSessionToken(
  deps: AuthRouteDeps,
  session: { keyRef: string; ghTokenCiphertext: string },
): Promise<string | undefined> {
  const decrypted = await decryptToken(
    deps.auth.keyProvider,
    session.keyRef,
    session.ghTokenCiphertext,
  );
  return decrypted.ok ? decrypted.value : undefined;
}

/** Map a repo-resolve failure (not a write yet) to the sanitized posture. */
function repoResolveFailure(
  c: Context<AuthzEnv>,
  error: GitHubApiError,
): Response {
  if (error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    return errorJson(c, ApiErrorCode.UNAUTHORIZED);
  }
  if (
    error.code === GitHubApiErrorCode.NOT_FOUND ||
    error.code === GitHubApiErrorCode.FORBIDDEN
  ) {
    return errorJson(c, ApiErrorCode.NOT_FOUND);
  }
  return errorJson(c, ApiErrorCode.GITHUB_UNAVAILABLE);
}

/** Map a final create-comment failure to the sanitized response posture. */
function writeFailure(
  c: Context<AuthzEnv>,
  error: InlineReviewCommentError,
): Response {
  // A 422 means the anchor no longer sits on the pinned commit's diff — the
  // head advanced under the composer. Fail with a distinct 409 so the FE tells
  // the author to reload (the draft survives locally), never a retry-looking
  // 502.
  if (error.staleAnchor === true) {
    return errorJson(c, ApiErrorCode.PR_CHANGED_SINCE_READ);
  }
  if (error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    return errorJson(c, ApiErrorCode.UNAUTHORIZED);
  }
  // 403/404 collapse to the gate's 404 posture — no existence leak.
  if (
    error.code === GitHubApiErrorCode.NOT_FOUND ||
    error.code === GitHubApiErrorCode.FORBIDDEN
  ) {
    return errorJson(c, ApiErrorCode.NOT_FOUND);
  }
  return errorJson(c, ApiErrorCode.GITHUB_UNAVAILABLE);
}

/**
 * Map a thread-flip MUTATION-stage failure: runs AFTER the gate and the fresh
 * re-resolve both succeeded, so there is no existence to hide. FORBIDDEN is a
 * genuine permission gap (read-only viewer / raced revocation) → an honest,
 * FE-actionable 403. NOT_FOUND covers the PR vanishing AND a `commentId`
 * matching no thread → 404.
 */
function mutationFailure(
  c: Context<AuthzEnv>,
  error: GitHubApiError,
): Response {
  if (error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    return errorJson(c, ApiErrorCode.UNAUTHORIZED);
  }
  if (error.code === GitHubApiErrorCode.FORBIDDEN) {
    return errorJson(c, ApiErrorCode.GITHUB_PERMISSION);
  }
  if (error.code === GitHubApiErrorCode.NOT_FOUND) {
    return errorJson(c, ApiErrorCode.NOT_FOUND);
  }
  return errorJson(c, ApiErrorCode.GITHUB_UNAVAILABLE);
}

/**
 * Mount the comments routes behind the pr subtree's shared gate.
 * `evictConversation` is the conversation module's cache hook: every route
 * here is a conversation write, so success drops the PR's cached
 * conversation.
 */
export function commentsRoute(
  deps: AuthRouteDeps,
  evictConversation: (
    installationId: InstallationId,
    repoId: RepoId,
    prNumber: number,
  ) => void,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();

  app.action(
    {
      id: PRODUCT_ACTION_ID.CREATE_INLINE_COMMENT,
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
    },
    "post",
    "/",
    async (c) => {
      const parsedBody = publishDraftSchema.safeParse(await jsonBody(c));
      const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
      if (!parsedBody.success || !parsedPr.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const draftId = parsedBody.data.draftId;

      const ctx = c.get("ctx");
      const repoId = c.get("repoId");
      const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(
        repoId,
        parsedPr.data,
      );
      if (pr === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }

      // The session answers first, and it answers with no GitHub call spent:
      // a frozen tab, an unknown draft and one already published are all
      // decided off rows this server holds.
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      const commitId = commitShaSchema.safeParse(resolved.head);
      if (!commitId.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const held = await resolved.run(async (writer) =>
        (await writer.draftComments()).find(
          (row) => row.id === draftId || row.carriedFromCommentId === draftId,
        ),
      );
      if (!held.ok) {
        return sessionFailure(c, held.error);
      }
      const draft = held.value;
      if (draft === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      if (draft.status === DraftCommentStatus.SUBMITTED) {
        return errorJson(c, ApiErrorCode.DRAFT_ALREADY_PUBLISHED);
      }
      // Same refusal the submit makes, for the same reason: an orphaned anchor
      // would land the comment on unrelated lines, and posting one at a time
      // has no degradation fold to catch it. Re-anchor or delete to clear it.
      if (draft.anchorStatus === AnchorStatus.ORPHANED) {
        return errorJson(c, ApiErrorCode.DRAFT_ANCHOR_ORPHANED);
      }

      // Viewer token: set by the gate on the verified path; on a positive-cache
      // hit decrypt lazily (same pattern as review-submit / mark-ready).
      let currentSession = c.get("session");
      const resolvedToken =
        c.get("accessToken") ??
        (await resolveSessionToken(deps, currentSession));
      if (resolvedToken === undefined) {
        return errorJson(c, ApiErrorCode.UNAUTHORIZED);
      }
      let accessToken: string = resolvedToken;

      // One refresh-once budget for the WHOLE request, shared across the fresh
      // slug resolve AND the write.
      let refreshSpent = false;
      const spendRefresh = async (): Promise<boolean> => {
        if (refreshSpent) {
          return false;
        }
        refreshSpent = true;
        const refreshed = await refreshSessionToken(
          deps,
          currentSession,
          c.get("logger"),
        );
        if (!refreshed.ok) {
          return false;
        }
        currentSession = refreshed.value.session;
        accessToken = refreshed.value.accessToken;
        return true;
      };

      // Resolve the target `owner/name` FRESH by numeric repo id, right before
      // the mutating write (gated-route rule): the gate's cached slug may be up
      // to 60s stale, and a rename + name-reuse inside that window would point
      // the comment at the wrong repository.
      let repoInfo = await fetchRepositoryById(
        createUserOctokit(accessToken),
        repoId,
      );
      if (
        !repoInfo.ok &&
        repoInfo.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
        (await spendRefresh())
      ) {
        repoInfo = await fetchRepositoryById(
          createUserOctokit(accessToken),
          repoId,
        );
      }
      if (!repoInfo.ok) {
        return repoResolveFailure(c, repoInfo.error);
      }
      const target = splitRepoSlug(repoInfo.value.fullName);
      if (target === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }

      const writeInput = {
        owner: target.owner,
        repo: target.repo,
        prNumber: pr.prNumber,
        commitId: commitId.data,
        ...readDraftAnchor(draft),
        body: draft.body,
      };

      // A 401'd POST created nothing, so a refreshed retry cannot double-post.
      const postWithRefreshOnce = async (): Promise<
        Result<InlineReviewCommentResult, InlineReviewCommentError>
      > => {
        let result = await createInlineReviewComment(
          createUserOctokit(accessToken),
          writeInput,
        );
        if (
          !result.ok &&
          result.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
          (await spendRefresh())
        ) {
          result = await createInlineReviewComment(
            createUserOctokit(accessToken),
            writeInput,
          );
        }
        return result;
      };

      const posted = await postWithRefreshOnce();
      if (!posted.ok) {
        return writeFailure(c, posted.error);
      }

      // The GitHub write is the commit point; flipping the row is how the
      // session records it. A failure here leaves a draft that is on GitHub —
      // logged, never an error response, which would invite a second post.
      try {
        const flipped = await resolved.run((writer) =>
          writer.publishDraftComments([draft.id]),
        );
        if (!flipped.ok) {
          throw new Error(flipped.error.code);
        }
      } catch (flipError) {
        // NOT `audit.fail`: that name is the audit ROW failing to persist,
        // and this is the session's own publication flip.
        c.get("logger").error(
          "draft stayed unpublished after a posted comment",
          {
            commentId: String(posted.value.commentId),
            err: flipError,
          },
        );
      }

      // The write happened: the cached conversation is stale — drop it so the
      // FE's post-write refetch reflects the new thread inside the TTL.
      evictConversation(ctx.installationId, repoId, pr.prNumber);

      stampAuditTarget(c, "review_comment", posted.value.commentId);

      return c.json(
        {
          commentId: Number(posted.value.commentId),
          ...(posted.value.reviewId === undefined
            ? {}
            : { reviewId: Number(posted.value.reviewId) }),
        },
        201,
        { "cache-control": "no-store" },
      );
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.REPLY_TO_COMMENT,
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
    },
    "post",
    "/:commentId/replies",
    async (c) => {
      let rawBody: unknown;
      try {
        rawBody = await c.req.json();
      } catch {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const parsedBody = replyBodySchema.safeParse(rawBody);
      if (!parsedBody.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
      const parsedComment = commentIdSchema.safeParse(c.req.param("commentId"));
      if (!parsedPr.success || !parsedComment.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }

      const ctx = c.get("ctx");
      const repoId = c.get("repoId");
      const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(
        repoId,
        parsedPr.data,
      );
      if (pr === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }

      // Viewer token: set by the gate on the verified path; on a positive-cache
      // hit decrypt lazily (same pattern as the diff proxy / submit route).
      let currentSession = c.get("session");
      const resolvedToken =
        c.get("accessToken") ??
        (await resolveSessionToken(deps, currentSession));
      if (resolvedToken === undefined) {
        return errorJson(c, ApiErrorCode.UNAUTHORIZED);
      }
      let accessToken: string = resolvedToken;

      // One refresh budget per REQUEST, shared across both GitHub calls.
      let refreshSpent = false;
      const spendRefresh = async (): Promise<boolean> => {
        if (refreshSpent) {
          return false;
        }
        refreshSpent = true;
        const refreshed = await refreshSessionToken(
          deps,
          currentSession,
          c.get("logger"),
        );
        if (!refreshed.ok) {
          return false;
        }
        currentSession = refreshed.value.session;
        accessToken = refreshed.value.accessToken;
        return true;
      };

      // Mutations re-resolve the repo FRESH by numeric id (gated-route rule):
      // the gate's cached full name is ≤60s stale, and a rename + name-reuse
      // inside that window would point the reply at the wrong repository.
      let repoInfo = await fetchRepositoryById(
        createUserOctokit(accessToken),
        repoId,
      );
      if (
        !repoInfo.ok &&
        repoInfo.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
        (await spendRefresh())
      ) {
        repoInfo = await fetchRepositoryById(
          createUserOctokit(accessToken),
          repoId,
        );
      }
      if (!repoInfo.ok) {
        return repoResolveFailure(c, repoInfo.error);
      }
      const target = splitRepoSlug(repoInfo.value.fullName);
      if (target === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }

      const replyInput = {
        owner: target.owner,
        repo: target.repo,
        prNumber: pr.prNumber,
        commentId: parsedComment.data,
        body: parsedBody.data.body,
      };
      let created = await createReviewCommentReply(
        createUserOctokit(accessToken),
        replyInput,
      );
      if (
        !created.ok &&
        created.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
        (await spendRefresh())
      ) {
        created = await createReviewCommentReply(
          createUserOctokit(accessToken),
          replyInput,
        );
      }
      if (!created.ok) {
        if (created.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
          return errorJson(c, ApiErrorCode.UNAUTHORIZED);
        }
        // Gated-route rule: ANY in-route GitHub denial (403/404) collapses to
        // the gate's 404 posture — a root comment gone and a permission denial
        // must be indistinguishable from a cold denial.
        if (
          created.error.code === GitHubApiErrorCode.NOT_FOUND ||
          created.error.code === GitHubApiErrorCode.FORBIDDEN
        ) {
          return errorJson(c, ApiErrorCode.NOT_FOUND);
        }
        return errorJson(c, ApiErrorCode.GITHUB_UNAVAILABLE);
      }

      // The write happened: the cached conversation is stale — drop it so the
      // FE's post-reply refetch reflects the reply inside the TTL.
      evictConversation(ctx.installationId, repoId, pr.prNumber);

      stampAuditTarget(c, "review_comment", BigInt(created.value.commentId));

      return c.json({ commentId: created.value.commentId }, 201, {
        "cache-control": "no-store",
      });
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.RESOLVE_THREAD,
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
    },
    "post",
    "/:commentId/resolve",
    (c) => handleSetResolution(c, true),
  );
  app.action(
    {
      id: PRODUCT_ACTION_ID.UNRESOLVE_THREAD,
      classification: WRITE_CLASSIFICATION.EXTERNAL_WRITE,
    },
    "post",
    "/:commentId/unresolve",
    (c) => handleSetResolution(c, false),
  );

  async function handleSetResolution(
    c: Context<AuthzEnv>,
    resolved: boolean,
  ): Promise<Response> {
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    const parsedComment = commentIdSchema.safeParse(c.req.param("commentId"));
    if (!parsedPr.success || !parsedComment.success) {
      return errorJson(c, ApiErrorCode.INVALID_REQUEST);
    }

    const ctx = c.get("ctx");
    const repoId = c.get("repoId");
    const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(
      repoId,
      parsedPr.data,
    );
    if (pr === undefined) {
      return errorJson(c, ApiErrorCode.NOT_FOUND);
    }

    // Viewer token: set by the gate on the verified path; on a positive-cache
    // hit decrypt lazily (same pattern as mark-ready / the reply route).
    let currentSession = c.get("session");
    const resolvedToken =
      c.get("accessToken") ?? (await resolveSessionToken(deps, currentSession));
    if (resolvedToken === undefined) {
      return errorJson(c, ApiErrorCode.UNAUTHORIZED);
    }
    let accessToken: string = resolvedToken;

    // One refresh-once budget per REQUEST, shared across every GitHub call.
    let refreshSpent = false;
    const spendRefresh = async (): Promise<boolean> => {
      if (refreshSpent) {
        return false;
      }
      refreshSpent = true;
      const refreshed = await refreshSessionToken(
        deps,
        currentSession,
        c.get("logger"),
      );
      if (!refreshed.ok) {
        return false;
      }
      currentSession = refreshed.value.session;
      accessToken = refreshed.value.accessToken;
      return true;
    };

    // Mutations re-resolve the repo FRESH by numeric id (gated-route rule):
    // the gate's cached full name is ≤60s stale, and a rename + name-reuse
    // inside that window would flip a thread on the wrong repository.
    let repoInfo = await fetchRepositoryById(
      createUserOctokit(accessToken),
      repoId,
    );
    if (
      !repoInfo.ok &&
      repoInfo.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
      (await spendRefresh())
    ) {
      repoInfo = await fetchRepositoryById(
        createUserOctokit(accessToken),
        repoId,
      );
    }
    if (!repoInfo.ok) {
      return repoResolveFailure(c, repoInfo.error);
    }
    const target = splitRepoSlug(repoInfo.value.fullName);
    if (target === undefined) {
      return errorJson(c, ApiErrorCode.NOT_FOUND);
    }

    const input = {
      owner: target.owner,
      repo: target.repo,
      prNumber: pr.prNumber,
      rootCommentId: parsedComment.data,
      resolved,
    };
    // A 401'd walk/mutation performed no write we care about re-running; the
    // op is idempotent regardless (converged states), so one refreshed retry
    // of the WHOLE op is safe.
    const setWithRefreshOnce = async (): Promise<
      Result<SetReviewThreadResolutionResult, GitHubApiError>
    > => {
      let result = await setReviewThreadResolution(
        createUserOctokit(accessToken),
        input,
      );
      if (
        !result.ok &&
        result.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
        (await spendRefresh())
      ) {
        result = await setReviewThreadResolution(
          createUserOctokit(accessToken),
          input,
        );
      }
      return result;
    };

    const outcome = await setWithRefreshOnce();
    if (!outcome.ok) {
      return mutationFailure(c, outcome.error);
    }

    // The thread state changed (or was confirmed) on GitHub: the cached
    // conversation is stale either way — drop it so the FE's refetch shows
    // the slim-row transition immediately.
    evictConversation(ctx.installationId, repoId, pr.prNumber);

    stampAuditTarget(c, "review_comment", BigInt(parsedComment.data));

    return c.json(
      { resolved, alreadyInTargetState: outcome.value.alreadyInTargetState },
      200,
      { "cache-control": "no-store" },
    );
  }

  return app;
}
