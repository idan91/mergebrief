// The gated-route fresh re-resolve, shared by every mutating repo route: the
// gate's cached slug may be up to 60s stale, and a rename + name-reuse
// inside that window would point an outward write at the wrong repository.
// The matching handler-side posture mapper lives here too, a denial at this
// stage runs BEFORE the viewer has re-proven access this request, so 403 and
// 404 both collapse to the gate's uniform 404 posture.
import {
  createUserOctokit,
  fetchRepositoryById,
  GitHubApiErrorCodes,
  type GitHubApiError,
  type RepositoryInfo,
} from "github";
import type { RepoId } from "persistence";
import type { Result } from "types/utils";
import { ApiErrorCodes } from "contract";
import {
  FailureKinds,
  buildGitHubDeniedResult,
} from "../../../shared-errors/failures";
import {
  BadGateway,
  Forbidden,
  NotFound,
  Unauthorized,
} from "../../../shared-errors/api-error";
import type {
  GitHubDeniedFailure,
  TokenUnreadableFailure,
} from "../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../auth/reviewer-github-client";
import { parseOwnerAndName } from "../utils";

export type RepoResolveFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<GitHubApiError>;

export interface RepoOwnerAndName {
  readonly owner: string;
  readonly repo: string;
}

/** The repository as GitHub shows it to the viewer NOW, with its current name pair. */
export interface FreshRepository {
  readonly info: RepositoryInfo;
  readonly ownerAndName: RepoOwnerAndName;
}

/**
 * The repo fetched by numeric id with the viewer's token, immediately
 * before an outward write: the gate's cached slug may be up to 60s stale,
 * and so may its admin bit.
 */
export async function fetchRepositoryFresh(
  deps: { readonly github: ReviewerGitHubClient },
  repoId: RepoId,
): Promise<Result<FreshRepository, RepoResolveFailure>> {
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
  return { ok: true, value: { info: repoInfo.value, ownerAndName } };
}

/** The repo's CURRENT `{ owner, repo }` name pair, for an outward write. */
export async function resolveRepoOwnerAndName(
  deps: { readonly github: ReviewerGitHubClient },
  repoId: RepoId,
): Promise<Result<RepoOwnerAndName, RepoResolveFailure>> {
  const fresh = await fetchRepositoryFresh(deps, repoId);
  if (!fresh.ok) {
    return fresh;
  }
  return { ok: true, value: fresh.value.ownerAndName };
}

/**
 * `urlBoxOnly` says the gate passed this request on the operator PAT, so the
 * reader is already looking at the brief, the title and the diff, there is
 * no existence left for the uniform 404 to hide, and collapsing to it would
 * send them hunting for a deleted pull request. The write still cannot
 * happen (posting under the operator's token would misattribute their
 * words), so the refusal is honest instead: this account cannot write here.
 */
export function throwRepoResolveFailure(
  failure: RepoResolveFailure,
  urlBoxOnly = false,
): never {
  if (failure.kind === FailureKinds.TOKEN_UNREADABLE) {
    throw new Unauthorized();
  }
  if (failure.error.code === GitHubApiErrorCodes.UNAUTHORIZED) {
    throw new Unauthorized();
  }
  if (
    failure.error.code === GitHubApiErrorCodes.NOT_FOUND ||
    failure.error.code === GitHubApiErrorCodes.FORBIDDEN
  ) {
    if (urlBoxOnly) {
      throw new Forbidden(ApiErrorCodes.NO_REPO_WRITE_ACCESS);
    }
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
