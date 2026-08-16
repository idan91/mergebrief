// POST /api/repos/:repoId/pulls/:prNumber/ready — the mark-ready route. Behind
// the FULL per-repo gate; runs the GraphQL `markPullRequestReadyForReview`
// mutation with the VIEWER's token (GitHub itself enforces that only the
// author/maintainer may mark ready, so this route needs NO viewerIsAuthor check
// of its own; it only needs to be session-authed and repo-gated).
//
// On mutation success the route flips OUR `draft` mirror to false in the same
// request (a narrow tenant-scoped `setDraft`, never a full re-upsert). The
// later `ready_for_review` webhook lands as an idempotent no-op, so no ordering
// machinery is needed.
//
// Race matrix (the poll/webhook is the reconciler, not this route):
//   - Double-click double-POST: both requests resolve; the first flips the PR,
//     the second either reads `isDraft:false` (converged) or races the mutation
//     into GitHub's "not a draft" (converged). Both return 200; `setDraft` is
//     idempotent, so no double side effect.
//   - Mark-ready racing the `ready_for_review` webhook: the route flip and the
//     webhook upsert both drive `draft=false`; order-independent, idempotent.
//   - Mark-ready on an already-closed PR: GitHub rejects the mutation with an
//     ordinary error (not "not a draft"); it maps to a sanitized 4xx/502 and
//     the row is NOT flipped.
//   - Stale redelivery regressing `draft=true` after the flip: accepted — a
//     late `opened`/redelivered event can re-set draft; the pr-view poll
//     self-heals. This route builds no ordering guard for it.
import { Hono, type Context } from "hono";
import {
  createUserOctokit,
  fetchRepositoryById,
  GitHubApiErrorCode,
  markPullRequestReadyForReview,
  type GitHubApiError,
  type MarkReadyResult,
} from "github";
import {
  audit,
  AuditAction,
  AuditActorType,
  decryptToken,
  forTenant,
} from "persistence";
import type { Result } from "types";
import { z } from "zod";
import { refreshSessionToken, type AuthRouteDeps } from "../../auth/session";
import type { AuthzEnv } from "../../authz";
import { ApiErrorCode, errorJson } from "../../../error-response";

const prNumberSchema = z.coerce.number().int().positive();

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

/**
 * Map a FRESH REPO RE-RESOLVE failure to the sanitized response posture. This
 * runs BEFORE the viewer has proven access to the repo via this request's own
 * fetch, so a 403/404 both collapse to the gate's 404 posture: a viewer whose
 * access was revoked inside the positive-cache TTL must see exactly what a cold
 * gate denial shows — no existence leak, no distinguishable status.
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
 * Map a GraphQL MUTATION-stage failure to the sanitized response posture. This
 * runs AFTER both the gate and the fresh re-resolve succeeded — the viewer has
 * already proven they can see the repo, so there is no existence to leak by
 * being specific. A FORBIDDEN here is a genuine App permission gap:
 * `markPullRequestReadyForReview` requires the App to hold `contents: write`
 * (GitHub's own permission granularity — MergeBrief never pushes code), so it
 * surfaces as a distinct, honestly-actionable 403 instead of collapsing into
 * "no longer accessible". A NOT_FOUND still means the PR is genuinely gone → 404.
 */
function markReadyMutationFailure(
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
 * Mount the mark-ready route behind the pr subtree's shared gate, so a POST
 * here traverses exactly one per-repo gate.
 */
export function markReadyRoute(deps: AuthRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();

  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedPr.success) {
      return errorJson(c, ApiErrorCode.INVALID_REQUEST);
    }
    const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(
      c.get("repoId"),
      parsedPr.data,
    );
    if (pr === undefined) {
      return errorJson(c, ApiErrorCode.NOT_FOUND);
    }

    // Viewer token: set by the gate on the verified path; on a positive-cache
    // hit decrypt lazily (same pattern as review-submit).
    let currentSession = c.get("session");
    const resolvedToken =
      c.get("accessToken") ?? (await resolveSessionToken(deps, currentSession));
    if (resolvedToken === undefined) {
      return errorJson(c, ApiErrorCode.UNAUTHORIZED);
    }
    // Plain `string` binding: the narrowing above doesn't survive into the
    // closures below for a mutable `let` of union type.
    let accessToken: string = resolvedToken;

    // One refresh-once budget for the WHOLE request, shared across the fresh
    // slug resolve AND the mutation (the ~8h token can expire between them).
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
    // the mutating write. The gate's cached `repoFullName` may be up to 60s
    // stale — a rename + name-reuse inside that window would target the wrong
    // repository.
    let repoInfo = await fetchRepositoryById(
      createUserOctokit(accessToken),
      c.get("repoId"),
    );
    if (
      !repoInfo.ok &&
      repoInfo.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
      (await spendRefresh())
    ) {
      repoInfo = await fetchRepositoryById(
        createUserOctokit(accessToken),
        c.get("repoId"),
      );
    }
    if (!repoInfo.ok) {
      return resolveRepoFailure(c, repoInfo.error);
    }
    const target = splitRepoSlug(repoInfo.value.fullName);
    if (target === undefined) {
      return errorJson(c, ApiErrorCode.NOT_FOUND);
    }

    // A 401'd GraphQL call performed no write, so a refreshed retry cannot
    // double-mark; the operation is idempotent regardless (converged states).
    const markWithRefreshOnce = async (): Promise<
      Result<MarkReadyResult, GitHubApiError>
    > => {
      let result = await markPullRequestReadyForReview(
        createUserOctokit(accessToken),
        {
          owner: target.owner,
          repo: target.repo,
          prNumber: pr.prNumber,
        },
      );
      if (
        !result.ok &&
        result.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
        (await spendRefresh())
      ) {
        result = await markPullRequestReadyForReview(
          createUserOctokit(accessToken),
          {
            owner: target.owner,
            repo: target.repo,
            prNumber: pr.prNumber,
          },
        );
      }
      return result;
    };

    const marked = await markWithRefreshOnce();
    if (!marked.ok) {
      return markReadyMutationFailure(c, marked.error);
    }

    // Success (fresh flip OR already-ready convergence): mirror `draft=false`
    // locally so the FE's pr-view invalidation reflects it immediately. A
    // NOT_FOUND here (PR deleted mid-request) is non-fatal — GitHub is the
    // source of truth and the webhook reconciles; do not fail a converged
    // GitHub state on a local mirror race.
    await forTenant(deps.handle, ctx).pullRequests.setDraft(pr.id, false);

    // Audit the mark-ready (numeric-only; no metadata — the converged/fresh
    // distinction is not worth recording).
    await audit(deps.handle, {
      installationId: ctx.installationId,
      actorType: AuditActorType.REVIEWER,
      actorId: currentSession.reviewerId,
      action: AuditAction.MARK_READY,
      targetType: "pull_request",
      targetId: pr.id,
    });

    return c.json({ draft: false }, 200, { "cache-control": "no-store" });
  });

  return app;
}
