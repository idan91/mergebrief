import type { ReviewerRepoClient } from "github";
import type { Result } from "types/utils";
import type { PullRequestAccess } from "../../../../../access/types";
import { FailureKinds } from "../../../../../shared-errors/failures";
import { fetchFreshRepository } from "../../../logic/fresh-repository";
import type { CommentDeniedFailure } from "../types";

/** The viewer's client on the repository under the name GitHub gives it now. */
export async function bindFreshRepoClient(
  access: PullRequestAccess,
): Promise<Result<ReviewerRepoClient, CommentDeniedFailure>> {
  const fresh = await fetchFreshRepository(access.github, access.repoId);
  if (!fresh.ok) {
    return fresh;
  }
  return { ok: true, value: access.github.forRepo(fresh.value.ownerAndName) };
}

/** A refusal of a call made after the re-resolve, riding whole. */
export function shapeMutationDenied(
  error: CommentDeniedFailure["error"],
): Result<never, CommentDeniedFailure> {
  return {
    ok: false,
    error: { kind: FailureKinds.GITHUB_DENIED, phase: "mutation", error },
  };
}
