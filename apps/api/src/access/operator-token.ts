import type { Context } from "hono";
import { fetchRepositoryById } from "github";
import { createTenantRepository, type ReviewerId } from "persistence";
import type { ReviewerGitHubClient } from "../routes/auth/reviewer-github-client";
import type { AuthRouteDeps } from "../routes/auth/session/types";
import { isGitHubDenial } from "../shared-errors/failures";
import {
  AccessFootings,
  type AuthzEnv,
  type ListedOperatorToken,
  type OperatorRepoAccess,
  type OperatorRungRequest,
} from "./types";

/**
 * The operator PAT, only for a reviewer the Operator listed. Every door the
 * token has reads it here, so an unlisted reviewer sees an instance with no
 * operator PAT at all.
 */
export function resolveOperatorTokenFor(
  deps: AuthRouteDeps,
  reviewerId: ReviewerId,
): ListedOperatorToken {
  const operatorToken = deps.operatorToken;
  if (operatorToken === undefined) {
    return undefined;
  }
  const listed = operatorToken.reviewerIds.has(reviewerId);
  return listed ? operatorToken.token : undefined;
}

/**
 * The operator PAT, but only for a request the gate passed on it, a read
 * behind such a pass has to reach GitHub the same way the gate did, or the
 * page opens onto empty diffs and conversations. `undefined` everywhere
 * else, so an ordinary request can never borrow the operator's reach.
 */
export function readFallbackTokenFor(
  c: Context<AuthzEnv>,
  deps: AuthRouteDeps,
): string | undefined {
  const passedOnOperatorToken = c.get("urlBoxOnly") === true;
  if (!passedOnOperatorToken) {
    return undefined;
  }
  return resolveOperatorTokenFor(deps, c.get("session").reviewerId);
}

/**
 * The gate's second rung. Answers ONLY when every condition holds: the
 * denial is a 404/403 (not upstream trouble), an operator PAT is configured,
 * the reader is on its reviewer list, the request names a PR, that PR exists
 * in the reader's OWN url-box world, and the PAT can read the repo.
 * Otherwise `undefined` and the caller collapses to the uniform 404.
 */
export async function resolveOperatorRepoAccess(
  deps: AuthRouteDeps,
  client: ReviewerGitHubClient,
  denied: OperatorRungRequest,
): Promise<Omit<OperatorRepoAccess, "session"> | undefined> {
  const reviewerId = client.session().reviewerId;
  const fallbackToken = resolveOperatorTokenFor(deps, reviewerId);
  if (fallbackToken === undefined || !isGitHubDenial(denied.error)) {
    return undefined;
  }
  if (!denied.requestedPr.ok) {
    return undefined;
  }
  const { repoId } = denied;
  const prNumber = denied.requestedPr.value;
  const owned = await createTenantRepository(deps.handle, {
    ownerUserId: reviewerId,
  }).pullRequests.getByNumber(repoId, prNumber);
  if (owned === undefined) {
    return undefined;
  }
  const repo = await fetchRepositoryById(
    client.createOctokit(fallbackToken),
    repoId,
  );
  if (!repo.ok) {
    return undefined;
  }
  return {
    footing: AccessFootings.OPERATOR,
    repoId,
    repoFullName: repo.value.fullName,
    prNumber,
    viewerCanPush: false,
    installation: { kind: "owner" },
  };
}
