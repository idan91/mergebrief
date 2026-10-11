// The ready domain's failure->throw mapper (gated-route posture).
import {
  resolveGitHubDenialError,
  unwrapGitHubFailure,
} from "../../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../../shared-errors/github-denial/types";
import type { MarkReadyFailure } from "../types";

/**
 * Runs after the gate and the fresh re-resolve, so a FORBIDDEN is a genuine
 * App permission gap: `markPullRequestReadyForReview` requires
 * `contents: write`, which the viewer can act on.
 */
export function throwMarkReadyFailure(failure: MarkReadyFailure): never {
  throw resolveGitHubDenialError(
    unwrapGitHubFailure(failure),
    DenialPostures.HONEST,
  );
}
