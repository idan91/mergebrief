// The gated-route fresh re-resolve, shared by every mutating pr route: the
// gate's cached slug may be up to 60s stale, and a rename + name-reuse
// inside that window would point an outward write at the wrong repository.
// The matching handler-side posture mapper lives here too — a denial at this
// stage runs BEFORE the viewer has re-proven access this request, so 403 and
// 404 both collapse to the gate's uniform 404 posture.
import {
  createUserOctokit,
  fetchRepositoryById,
  GitHubApiErrorCode,
  type GitHubApiError,
} from "github";
import type { RepoId } from "persistence";
import type { Result } from "types";
import { ApiErrorCodes } from "../../../../error-response";
import { buildGitHubDeniedResult } from "../../../../shared-errors/failures";
import {
  BadGateway,
  NotFound,
  Unauthorized,
} from "../../../../shared-errors/api-error";
import type {
  GitHubDeniedFailure,
  TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import { parseOwnerAndName } from "../../utils";

export type RepoResolveFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<GitHubApiError>;

export interface RepoOwnerAndName {
  readonly owner: string;
  readonly repo: string;
}

/**
 * The repo's CURRENT `{ owner, repo }` name pair, fetched by numeric id with
 * the viewer's token. Call it immediately before an outward write — the
 * gate's cached slug may be up to 60s stale.
 */
export async function resolveRepoOwnerAndName(
  deps: { readonly github: ReviewerGitHubClient },
  repoId: RepoId,
): Promise<Result<RepoOwnerAndName, RepoResolveFailure>> {
  const repoInfo = await deps.github.run((token) => {
    const octokit = createUserOctokit(token);
    return fetchRepositoryById(octokit, repoId);
  });
  if (!repoInfo.ok) {
    return buildGitHubDeniedResult(repoInfo.error, "resolve");
  }
  const ownerAndName = parseOwnerAndName(repoInfo.value.fullName);
  if (ownerAndName === undefined) {
    throw new NotFound();
  }
  return { ok: true, value: ownerAndName };
}

export function throwRepoResolveFailure(failure: RepoResolveFailure): never {
  if (failure.kind === "token-unreadable") {
    throw new Unauthorized();
  }
  if (failure.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    throw new Unauthorized();
  }
  if (
    failure.error.code === GitHubApiErrorCode.NOT_FOUND ||
    failure.error.code === GitHubApiErrorCode.FORBIDDEN
  ) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
