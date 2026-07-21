// POST /api/repos/:repoId/pulls/:prNumber/comments — the inline post-now route
// (BRIEF-43 PR 4). Behind the FULL per-repo gate; posts ONE standalone inline
// review comment with the VIEWER's token (ADR 0016 #4), pinned to the commit
// the anchor was read against (`commitId`).
//
// NOT gated on viewerIsAuthor or draft: GitHub separately authorizes the write
// (anyone with repo access may comment on a PR), so the own-draft affordance is
// a UX placement, not a security boundary — this route only needs to be
// session-authed and repo-gated, exactly like mark-ready (ADR 0031). Mounted
// BEFORE `readsRoute` in `app.ts` (single-gate rule) so a POST here traverses
// exactly one per-repo gate.
//
// A posted comment IS a conversation write, so on success the PR's cached
// conversation is evicted (the FE refetches and the new thread renders with the
// "yours" tag once the returned review id is recorded — BRIEF-25).
import { Hono, type Context } from "hono";
import {
  createInlineReviewComment,
  createUserOctokit,
  fetchRepositoryById,
  GitHubApiErrorCode,
  ReviewCommentSide,
  type GitHubApiError,
  type InlineReviewCommentError,
  type InlineReviewCommentResult,
} from "github";
import {
  audit,
  AuditAction,
  AuditActorType,
  decryptToken,
  forTenant,
  type InstallationId,
  type RepoId,
} from "persistence";
import type { Result } from "types";
import { z } from "zod";
import { refreshSessionToken, type AuthRouteDeps } from "./auth";
import { createAuthzMiddleware, type AuthzEnv } from "./authz";

// ---------------------------------------------------------------------------
// Boundary schema — shape only. The FE already maps the composer's chunk-region
// anchor to GitHub's wire shape (side old→LEFT / new→RIGHT, multi-line as
// start_line..line). Each deterministic reject below is mirrored client-side
// (apps/web AGENTS.md) so the UI never resubmits an unrecoverable payload:
//   - commitId must be a 40-hex SHA — the FE always sends the viewed head;
//   - body 1..65536 — the composer blocks an empty body at save time, and the
//     Post affordance blocks an over-cap body with recoverable copy
//     (`postCommentBlockedReason` in apps/web features/review/comments — keep
//     in lockstep with MAX_BODY_LENGTH here);
//   - startLine < line — the anchor→wire map only sets startLine on a true
//     multi-line range (startLine strictly before the end line);
//   - startSide requires startLine — GitHub 422s a dangling start_side, which
//     would misclassify as a stale-anchor 409 ("reload") and trap a direct API
//     client in an unfixable retry loop; the FE's anchor→wire map always sets
//     the pair together, so this only bites hand-built payloads.
// ---------------------------------------------------------------------------

const MAX_BODY_LENGTH = 65_536;
const MAX_PATH_LENGTH = 1_024;

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/, "commitId must be a 40-hex SHA");
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

/** A sanitized error response carrying the gated-route `no-store` posture. */
function errorJson(
  c: Context<AuthzEnv>,
  message: string,
  status: 400 | 401 | 404 | 409 | 502,
): Response {
  return c.json({ error: message }, status, { "cache-control": "no-store" });
}

/** Split the gate's verified `owner/name`; `undefined` on a non-slug shape. */
function splitRepoSlug(fullName: string): { owner: string; repo: string } | undefined {
  const parts = fullName.split("/");
  const [owner, repo] = parts;
  if (parts.length !== 2 || owner === undefined || owner === "" || repo === undefined || repo === "") {
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
function repoResolveFailure(c: Context<AuthzEnv>, error: GitHubApiError): Response {
  if (error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    return errorJson(c, "unauthorized", 401);
  }
  if (
    error.code === GitHubApiErrorCode.NOT_FOUND ||
    error.code === GitHubApiErrorCode.FORBIDDEN
  ) {
    return errorJson(c, "not found", 404);
  }
  return errorJson(c, "upstream error", 502);
}

/** Map a final create-comment failure to the sanitized response posture. */
function writeFailure(c: Context<AuthzEnv>, error: InlineReviewCommentError): Response {
  // A 422 means the anchor no longer sits on the pinned commit's diff — the
  // head advanced under the composer. Fail with a distinct 409 so the FE tells
  // the author to reload (the draft survives locally), never a retry-looking
  // 502 (mirrors review-submit's unknown-commit fail-closed).
  if (error.staleAnchor === true) {
    return errorJson(c, "pull request changed since it was read", 409);
  }
  if (error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    return errorJson(c, "unauthorized", 401);
  }
  // 403/404 collapse to the gate's 404 posture — no existence leak.
  if (
    error.code === GitHubApiErrorCode.NOT_FOUND ||
    error.code === GitHubApiErrorCode.FORBIDDEN
  ) {
    return errorJson(c, "not found", 404);
  }
  return errorJson(c, "upstream error", 502);
}

/**
 * Mount the inline post-now route behind its own per-repo gate instance.
 * `evictConversation` is the conversation surface's cache hook (BRIEF-25): a
 * posted inline comment is a conversation write, so success drops the PR's
 * cached conversation.
 */
export function inlineCommentRoute(
  deps: AuthRouteDeps,
  evictConversation: (installationId: InstallationId, repoId: RepoId, prNumber: number) => void,
): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  const authz = createAuthzMiddleware(deps);

  app.use("/api/repos/:repoId/pulls/:prNumber/comments", authz);

  app.post("/api/repos/:repoId/pulls/:prNumber/comments", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return errorJson(c, "invalid request", 400);
    }
    const parsedBody = commentBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return errorJson(c, "invalid request", 400);
    }
    const commentInput = parsedBody.data;

    const ctx = c.get("ctx");
    const repoId = c.get("repoId");
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedPr.success) {
      return errorJson(c, "invalid request", 400);
    }
    const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(repoId, parsedPr.data);
    if (pr === undefined) {
      return errorJson(c, "not found", 404);
    }

    // Viewer token: set by the gate on the verified path; on a positive-cache
    // hit decrypt lazily (same pattern as review-submit / mark-ready).
    let currentSession = c.get("session");
    const resolvedToken =
      c.get("accessToken") ?? (await resolveSessionToken(deps, currentSession));
    if (resolvedToken === undefined) {
      return errorJson(c, "unauthorized", 401);
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
      const refreshed = await refreshSessionToken(deps, currentSession, c.get("logger"));
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
    let repoInfo = await fetchRepositoryById(createUserOctokit(accessToken), repoId);
    if (
      !repoInfo.ok &&
      repoInfo.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
      (await spendRefresh())
    ) {
      repoInfo = await fetchRepositoryById(createUserOctokit(accessToken), repoId);
    }
    if (!repoInfo.ok) {
      return repoResolveFailure(c, repoInfo.error);
    }
    const target = splitRepoSlug(repoInfo.value.fullName);
    if (target === undefined) {
      return errorJson(c, "not found", 404);
    }

    const writeInput = {
      owner: target.owner,
      repo: target.repo,
      prNumber: pr.prNumber,
      commitId: commentInput.commitId,
      path: commentInput.path,
      line: commentInput.line,
      side: commentInput.side,
      ...(commentInput.startLine === undefined ? {} : { startLine: commentInput.startLine }),
      ...(commentInput.startSide === undefined ? {} : { startSide: commentInput.startSide }),
      body: commentInput.body,
    };

    // A 401'd POST created nothing, so a refreshed retry cannot double-post.
    const postWithRefreshOnce = async (): Promise<
      Result<InlineReviewCommentResult, InlineReviewCommentError>
    > => {
      let result = await createInlineReviewComment(createUserOctokit(accessToken), writeInput);
      if (
        !result.ok &&
        result.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
        (await spendRefresh())
      ) {
        result = await createInlineReviewComment(createUserOctokit(accessToken), writeInput);
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

    // Audit posture consistent with the conversation reply (D9: numeric-only).
    // The GitHub write above is the COMMIT POINT: a local audit failure must
    // never turn a posted comment into an error response (that would invite a
    // double-posting retry). Best-effort — log and keep the 201.
    try {
      await audit(deps.handle, {
        installationId: ctx.installationId,
        actorType: AuditActorType.REVIEWER,
        actorId: currentSession.reviewerId,
        action: AuditAction.SUBMIT,
        targetType: "review_comment",
        targetId: posted.value.commentId,
      });
    } catch (auditError) {
      // Posted to GitHub, our audit write failed — a data-integrity signal
      // the operator alerts on (ADR 0034 taxonomy).
      c.get("logger").error("post-now audit failed after posted comment", {
        evt: "audit.fail",
        commentId: String(posted.value.commentId),
        err: auditError,
      });
    }

    return c.json(
      {
        commentId: Number(posted.value.commentId),
        ...(posted.value.reviewId === undefined ? {} : { reviewId: Number(posted.value.reviewId) }),
      },
      201,
      { "cache-control": "no-store" },
    );
  });

  return app;
}
