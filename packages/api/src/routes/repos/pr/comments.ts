// The /comments family, behind the pr subtree's shared per-repo gate:
//   POST /                                  — the inline post-now comment
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
  audit,
  AuditAction,
  AuditOutcome,
  AuditActorType,
  decryptToken,
  forTenant,
  type InstallationId,
  type RepoId,
} from "persistence";
import type { Result } from "types";
import { z } from "zod";
import { refreshSessionToken, type AuthRouteDeps } from "../../auth/session";
import type { AuthzEnv } from "../../authz";
import { ApiErrorCode, errorJson } from "../../../error-response";
import { PRODUCT_ACTION_ID } from "../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../product-operations/types";

// ---------------------------------------------------------------------------
// Boundary schema — shape only. Each deterministic reject below MUST stay
// mirrored client-side, or the UI resubmits the same state in an unrecoverable
// loop:
//   - commitId must be a 40-hex SHA — the FE always sends the viewed head;
//   - body 1..65536 — the composer blocks an empty body at save time, and the
//     Post affordance blocks an over-cap body with recoverable copy
//     (`postCommentBlockedReason` in apps/web features/review/comments — keep
//     in lockstep with MAX_BODY_LENGTH here);
//   - startLine < line — set only on a true multi-line range;
//   - startSide requires startLine — GitHub 422s a dangling start_side, which
//     would misclassify as a stale-anchor 409 ("reload") and trap a direct API
//     client in an unfixable retry loop.
// ---------------------------------------------------------------------------

const MAX_BODY_LENGTH = 65_536;
const MAX_PATH_LENGTH = 1_024;

const shaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "commitId must be a 40-hex SHA");
const sideSchema = z.union([
  z.literal(ReviewCommentSide.LEFT),
  z.literal(ReviewCommentSide.RIGHT),
]);

const commentBodySchema = z
  .object({
    commitId: shaSchema,
    path: z.string().min(1).max(MAX_PATH_LENGTH),
    line: z.number().int().positive(),
    side: sideSchema,
    startLine: z.number().int().positive().optional(),
    startSide: sideSchema.optional(),
    body: z.string().min(1).max(MAX_BODY_LENGTH),
  })
  .refine((c) => c.startLine === undefined || c.startLine < c.line, {
    message: "startLine must be strictly before line",
  })
  .refine((c) => c.startSide === undefined || c.startLine !== undefined, {
    message: "startSide requires startLine",
  });

const prNumberSchema = z.coerce.number().int().positive();
/** A reply/thread target id is a REST comment id — bounded by JS integer precision. */
const commentIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .refine((value) => Number.isSafeInteger(value));

/** Same cap GitHub enforces on comment bodies (and the submit route mirrors). */
const MAX_REPLY_BODY_LENGTH = 65_536;
const replyBodySchema = z.object({
  body: z.string().min(1).max(MAX_REPLY_BODY_LENGTH),
});

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
      let rawBody: unknown;
      try {
        rawBody = await c.req.json();
      } catch {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const parsedBody = commentBodySchema.safeParse(rawBody);
      if (!parsedBody.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const commentInput = parsedBody.data;

      const ctx = c.get("ctx");
      const repoId = c.get("repoId");
      const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
      if (!parsedPr.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(
        repoId,
        parsedPr.data,
      );
      if (pr === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
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
        commitId: commentInput.commitId,
        path: commentInput.path,
        line: commentInput.line,
        side: commentInput.side,
        ...(commentInput.startLine === undefined
          ? {}
          : { startLine: commentInput.startLine }),
        ...(commentInput.startSide === undefined
          ? {}
          : { startSide: commentInput.startSide }),
        body: commentInput.body,
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

      // The write happened: the cached conversation is stale — drop it so the
      // FE's post-write refetch reflects the new thread inside the TTL.
      evictConversation(ctx.installationId, repoId, pr.prNumber);

      // The GitHub write above is the COMMIT POINT: a local audit failure must
      // never turn a posted comment into an error response (that would invite a
      // double-posting retry). Best-effort — log and keep the 201.
      try {
        await audit(deps.handle, {
          installationId: ctx.installationId,
          actorType: AuditActorType.REVIEWER,
          actorId: currentSession.reviewerId,
          operation: AuditAction.SUBMIT,
          outcome: AuditOutcome.OK,
          targetType: "review_comment",
          targetId: posted.value.commentId,
        });
      } catch (auditError) {
        // Posted to GitHub, our audit write failed — a data-integrity signal
        // the operator alerts on.
        c.get("logger").error("post-now audit failed after posted comment", {
          evt: "audit.fail",
          commentId: String(posted.value.commentId),
          err: auditError,
        });
      }

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

      // Audit posture consistent with submit — but the GitHub
      // write above is the COMMIT POINT: a local audit failure must never turn
      // a posted reply into an error response (the composer's upstream copy
      // invites a retry, which would double-post). Best-effort: log and keep
      // the 201.
      try {
        await audit(deps.handle, {
          installationId: ctx.installationId,
          actorType: AuditActorType.REVIEWER,
          actorId: currentSession.reviewerId,
          operation: AuditAction.SUBMIT,
          outcome: AuditOutcome.OK,
          targetType: "review_comment",
          targetId: BigInt(created.value.commentId),
        });
      } catch (auditError) {
        // Posted to GitHub, our audit write failed — a data-integrity signal
        // the operator alerts on.
        c.get("logger").error("reply audit failed after posted reply", {
          evt: "audit.fail",
          commentId: String(created.value.commentId),
          err: auditError,
        });
      }

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

    // Audit with the direction's own operation. The GitHub write
    // above is the commit point — never turn a landed flip into an error
    // response over a local audit failure (the FE would invite a retry of a
    // done action).
    try {
      await audit(deps.handle, {
        installationId: ctx.installationId,
        actorType: AuditActorType.REVIEWER,
        actorId: currentSession.reviewerId,
        operation: resolved
          ? AuditAction.RESOLVE_THREAD
          : AuditAction.UNRESOLVE_THREAD,
        outcome: AuditOutcome.OK,
        targetType: "review_comment",
        targetId: BigInt(parsedComment.data),
      });
    } catch (auditError) {
      c.get("logger").error(
        "thread-resolution audit failed after landed flip",
        {
          evt: "audit.fail",
          commentId: String(parsedComment.data),
          err: auditError,
        },
      );
    }

    return c.json(
      { resolved, alreadyInTargetState: outcome.value.alreadyInTargetState },
      200,
      { "cache-control": "no-store" },
    );
  }

  return app;
}
