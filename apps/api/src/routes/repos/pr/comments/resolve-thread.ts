import type { PullRequestAccess } from "../../../../access/types";
import { bindFreshRepoClient, shapeMutationDenied } from "./logic/repo-client";
import type { ResolutionInput, ResolutionResult } from "./types";

/**
 * Flip a thread's resolution state with the VIEWER's token. The flip
 * converges, so it rides the retrying client and a replay after a renewal
 * is safe.
 */
export async function setThreadResolution(
  access: PullRequestAccess,
  input: ResolutionInput,
): Promise<ResolutionResult> {
  const repo = await bindFreshRepoClient(access);
  if (!repo.ok) {
    return repo;
  }

  const outcome = await repo.value.setReviewThreadResolution({
    prNumber: access.prNumber,
    rootCommentId: input.rootCommentId,
    resolved: input.resolved,
  });
  if (!outcome.ok) {
    return shapeMutationDenied(outcome.error);
  }
  return outcome;
}
