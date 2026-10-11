// The fresh re-resolve a mutating operation runs on the request's bound
// GitHub before its write: the gate's slug and admin bit are up to 60s stale,
// and a rename plus name reuse inside that window would aim the write at
// another repository.
import { ApiErrorCodes } from "contract";
import type { GitHubCallFailure, ReviewerGitHub } from "github";
import type { RepoId } from "persistence";
import type { Result } from "types/utils";
import { AccessFootings, type AccessFooting } from "../../../access/types";
import {
  Forbidden,
  NotFound,
  type ApiError,
} from "../../../shared-errors/api-error";
import {
  FailureKinds,
  isGitHubDenial,
  type GitHubDeniedFailure,
} from "../../../shared-errors/failures";
import { resolveGitHubDenialError } from "../../../shared-errors/github-denial";
import { DenialPostures } from "../../../shared-errors/github-denial/types";
import { parseOwnerAndName } from "../utils";
import type { FreshRepository } from "./resolve-repo-owner-and-name";

/** GitHub refused the re-resolve itself, before the write was tried. */
export type FreshRepositoryFailure = GitHubDeniedFailure<GitHubCallFailure>;

export async function fetchFreshRepository(
  github: ReviewerGitHub,
  repoId: RepoId,
): Promise<Result<FreshRepository, FreshRepositoryFailure>> {
  const fetched = await github.fetchRepositoryById(repoId);
  if (!fetched.ok) {
    const error = fetched.error;
    return {
      ok: false,
      error: { kind: FailureKinds.GITHUB_DENIED, phase: "resolve", error },
    };
  }
  const ownerAndName = parseOwnerAndName(fetched.value.fullName);
  if (ownerAndName === undefined) {
    throw new NotFound();
  }
  return { ok: true, value: { info: fetched.value, ownerAndName } };
}

/**
 * The re-resolve answers as the gate would, a uniform 404. Behind an
 * operator pass the reader already sees the brief, so a 404 would send them
 * hunting for a deleted pull request; the honest answer is that this account
 * cannot write here, since a write on the operator's token would misattribute
 * the reader's words.
 */
export function resolveFreshRepositoryError(
  error: GitHubCallFailure,
  footing: AccessFooting,
): ApiError {
  const refusedOnOperatorPass =
    footing === AccessFootings.OPERATOR && isGitHubDenial(error);
  if (refusedOnOperatorPass) {
    return new Forbidden(ApiErrorCodes.NO_REPO_WRITE_ACCESS);
  }
  return resolveGitHubDenialError(error, DenialPostures.COLLAPSE);
}
