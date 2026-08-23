// The thread-resolution pair (POST /:commentId/{resolve,unresolve}): the
// VIEWER's token, fresh repo re-resolve before the mutating call, and the
// injected `evictConversation` hook on success — it IS a conversation write.
import type { Context } from "hono";
import {
  createUserOctokit,
  fetchRepositoryById,
  GitHubApiErrorCode,
  setReviewThreadResolution,
  type GitHubApiError,
  type SetReviewThreadResolutionResult,
} from "github";
import {
  decryptToken,
  createTenantRepository,
  type InstallationId,
  type RepoId,
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

// ---------------------------------------------------------------------------
// Boundary schemas — both routes NAME a draft the server holds; neither
// carries a body. The body, the anchor and the commit all come off rows the
// session already stores, so there is no second copy to reconcile.
//
// The commit is the named Brief's head — the revision the reviewer read.
// A Brief whose head is not a commit sha has nothing GitHub can anchor to,
// which is a deterministic 400 rather than an upstream 422.
// ---------------------------------------------------------------------------

const prNumberSchema = z.coerce.number().int().positive();
/** A reply/thread target id is a REST comment id — bounded by JS integer precision. */
const commentIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .refine((value) => Number.isSafeInteger(value));

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
    const pr = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(repoId, parsedPr.data);
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
