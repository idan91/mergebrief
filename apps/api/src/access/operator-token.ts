import type { GitHubReader, OperatorToken } from "github";
import { createTenantRepository, type ReviewerId } from "persistence";
import type { AuthRouteDeps } from "../routes/auth/session/types";
import { isGitHubDenial } from "../shared-errors/failures";
import {
  AccessFootings,
  type CachedOperatorRepoAccess,
  type OperatorRungRequest,
} from "./types";

/**
 * The operator PAT, only for the reviewer who owns it. Every door the token
 * has reads it here, so anyone else sees an instance with no operator PAT at
 * all, as does everyone while the owner lookup is pending.
 */
export function resolveOperatorTokenFor(
  deps: AuthRouteDeps,
  reviewerId: ReviewerId,
): OperatorToken | undefined {
  const operatorToken = deps.operatorToken;
  if (operatorToken === undefined || !operatorToken.isOwnedBy(reviewerId)) {
    return undefined;
  }
  return operatorToken.token;
}

/**
 * The operator's read-only GitHub for the token's owner, for a caller that
 * chooses itself what the operator may answer; `undefined` as for no PAT.
 */
export function bindOperatorReader(
  deps: AuthRouteDeps,
  reviewerId: ReviewerId,
): GitHubReader | undefined {
  const token = resolveOperatorTokenFor(deps, reviewerId);
  if (token === undefined) {
    return undefined;
  }
  return deps.auth.bindOperatorGitHub(token);
}

/**
 * The gate's second rung. Answers ONLY when every condition holds: the
 * denial is a 404/403 (not upstream trouble), an operator PAT is configured,
 * the reader owns it, the request names a PR, that PR exists
 * in the reader's OWN url-box world, and the PAT can read the repo.
 * Otherwise `undefined` and the caller collapses to the uniform 404.
 */
export async function resolveOperatorRepoAccess(
  deps: AuthRouteDeps,
  reviewerId: ReviewerId,
  denied: OperatorRungRequest,
): Promise<CachedOperatorRepoAccess | undefined> {
  const operator = bindOperatorReader(deps, reviewerId);
  if (operator === undefined || !isGitHubDenial(denied.error)) {
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
  const repo = await operator.fetchRepositoryById(repoId);
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
