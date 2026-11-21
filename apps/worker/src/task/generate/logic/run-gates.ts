import { isPermanentGitHubError } from "github";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { TransientJobError } from "../../failure";
import type { AcquiredRepoConfig } from "../../repo-config";
import type { RunContext } from "../types";

/**
 * Whether a pre-claim gate applies: a url-box job is the viewer's own paste,
 * a recovery run or a stored brief's run already passed, and a succeeded row
 * has nothing to gate.
 */
export function isGateable(context: RunContext): boolean {
  const { payload, recovering, existingBrief, projected } = context;
  const gateable =
    payload.grantId === undefined &&
    !recovering &&
    existingBrief === undefined &&
    projected?.status !== GenerationStatuses.SUCCEEDED;
  return gateable;
}

/**
 * A settings read a retry may clear could change what the gate decides, so
 * the run hands it to graphile while attempts remain. A permanent failure,
 * or the last attempt, returns and the gate decides without the settings.
 */
export function retrySettingsReadWhileAttemptsLeft(
  context: RunContext,
  repoConfig: AcquiredRepoConfig,
): void {
  const failure = repoConfig.settingsFetchFailure;
  const retryable = failure !== undefined && !isPermanentGitHubError(failure);
  const { job } = context;
  const attemptsLeft = job !== undefined && job.attempts < job.max_attempts;
  const retriesRead = retryable && attemptsLeft;
  if (!retriesRead) {
    return;
  }
  throw new TransientJobError(`settings read failed: ${failure.message}`, {
    failure: { code: GenerationFailureCodes.GITHUB_UNAVAILABLE },
  });
}
