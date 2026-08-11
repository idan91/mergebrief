// POST /api/repos/:repoId/pulls/:prNumber/comments/:commentId/{resolve,
// unresolve} — the thread-resolution routes. Behind the FULL per-repo gate;
// run the resolve/unresolveReviewThread mutations with the VIEWER's token.
// GitHub itself enforces who may flip a thread (push permission or PR
// authorship — the same rule `viewerCanResolve` mirrors for affordances), so
// the route needs no capability check of its own: a viewer whose access was
// revoked inside the pr-view TTL gets the mutation-stage 403 and the FE's
// clean error + refetch path.
//
// The two directions are separate routes (not a body flag), sharing one
// handler core.
//
// Success (fresh flip OR convergence) busts the PR's shared conversation cache
// so the FE's post-write refetch reflects the write inside the 60s TTL, and
// audits with the direction's own action.
import { Hono, type Context } from "hono";
import {
  createUserOctokit,
  fetchRepositoryById,
  GitHubApiErrorCode,
  setReviewThreadResolution,
  type GitHubApiError,
  type SetReviewThreadResolutionResult,
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
import { ApiErrorCode, errorJson } from "../error-response";

const prNumberSchema = z.coerce.number().int().positive();
/** A thread's root comment id — bounded by JS integer precision. */
const commentIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .refine((value) => Number.isSafeInteger(value));

/** Split the fresh-resolve's verified `owner/name`; `undefined` on a non-slug shape. */
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

/**
 * Map a FRESH REPO RE-RESOLVE failure: runs BEFORE the viewer has re-proven
 * access this request, so 403/404 collapse to the gate's 404 posture (no
 * existence leak, indistinguishable from a cold denial).
 */
function resolveRepoFailure(
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

/**
 * Map a walk/mutation-stage failure: runs AFTER the gate and the fresh
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
 * Mount the thread-resolution routes behind their own per-repo gate instance.
 * Mounted BEFORE `readsRoute` in `app.ts` (single-gate rule).
 */
export function resolveThreadRoute(
  deps: AuthRouteDeps,
  evictConversation: (
    installationId: InstallationId,
    repoId: RepoId,
    prNumber: number,
  ) => void,
): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  const authz = createAuthzMiddleware(deps);

  const RESOLVE_PATH =
    "/api/repos/:repoId/pulls/:prNumber/comments/:commentId/resolve";
  const UNRESOLVE_PATH =
    "/api/repos/:repoId/pulls/:prNumber/comments/:commentId/unresolve";
  app.use(RESOLVE_PATH, authz);
  app.use(UNRESOLVE_PATH, authz);
  app.post(RESOLVE_PATH, (c) => handleSetResolution(c, true));
  app.post(UNRESOLVE_PATH, (c) => handleSetResolution(c, false));

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
      return resolveRepoFailure(c, repoInfo.error);
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

    // Audit with the direction's own action (numeric-only). The GitHub write
    // above is the commit point — never turn a landed flip into an error
    // response over a local audit failure (the FE would invite a retry of a
    // done action).
    try {
      await audit(deps.handle, {
        installationId: ctx.installationId,
        actorType: AuditActorType.REVIEWER,
        actorId: currentSession.reviewerId,
        action: resolved
          ? AuditAction.RESOLVE_THREAD
          : AuditAction.UNRESOLVE_THREAD,
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
