import { setTimeout as sleep } from "node:timers/promises";
import { isPermanentGitHubError } from "github";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { TransientJobError } from "../../failure";
import { acquireRepoConfig, type AcquiredRepoConfig } from "../../repo-config";
import type { RunContext } from "../types";

/** The pauses before each in-run retry of a `settings.yaml` read a retry may clear. */
export const SETTINGS_READ_RETRY_DELAYS_MS: readonly number[] = [
  250, 750, 1500,
];

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

function isRetryableSettingsRead(repoConfig: AcquiredRepoConfig): boolean {
  const failure = repoConfig.settingsFetchFailure;
  return failure !== undefined && !isPermanentGitHubError(failure);
}

/**
 * The repo config a pre-claim gate decides on. A `settings.yaml` read a retry
 * may clear is read again in the run after each pause, so no graphile attempt
 * is spent and the row is never marked between tries; the last read stands,
 * its failure included.
 */
export async function acquireGateRepoConfig(
  context: RunContext,
): Promise<AcquiredRepoConfig> {
  const { deps, source, log } = context;
  const delays =
    deps.settingsReadRetryDelaysMs ?? SETTINGS_READ_RETRY_DELAYS_MS;
  let repoConfig = await acquireRepoConfig(source, log);
  for (const delayMs of delays) {
    if (!isRetryableSettingsRead(repoConfig)) {
      return repoConfig;
    }
    // oxlint-disable-next-line no-await-in-loop -- each try waits on the last.
    await sleep(delayMs);
    // oxlint-disable-next-line no-await-in-loop -- each try waits on the last.
    repoConfig = await acquireRepoConfig(source, log);
  }
  return repoConfig;
}

/**
 * The author gate's fail-closed hold is not self-healing, so a settings read
 * the in-run tries could not clear goes to graphile while attempts remain. A
 * permanent failure, or the last attempt, returns and the gate holds.
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
