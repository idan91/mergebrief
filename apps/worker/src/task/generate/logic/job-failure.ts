import type { LogFields } from "logging";
import {
  GenerationErrorCodes,
  InvalidArtifactBodyError,
  ScopeViolationError,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import { classifyFailure, PermanentJobError } from "../../failure";
import type { JobFailureInputs } from "../types";
import { emitProviderError } from "./errors";

/**
 * Mark the run failed, unless the row is to be left alone, and emit its
 * events. Returns whether the job ends here: the caller returns normally on
 * a permanent failure, or on a claim another run took over, whose retry would
 * only meet `held`; it rethrows otherwise so graphile owns the backoff.
 */
export async function reportJobFailure(
  error: unknown,
  inputs: JobFailureInputs,
): Promise<boolean> {
  const { deps, job, log } = inputs;

  const claimKept = await recordFailure(error, inputs);
  if (!claimKept) {
    log.warn("generate: another run holds the generation row, standing down");
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  emitProviderError(log, deps, error);
  const permanent =
    error instanceof PermanentJobError ||
    error instanceof ScopeViolationError ||
    error instanceof InvalidArtifactBodyError;
  const attempt = job?.attempts;
  const maxAttempts = job?.max_attempts;
  const failFields: LogFields = { evt: "job.fail", permanent };

  if (attempt !== undefined) {
    failFields["attempt"] = attempt;
  }
  if (maxAttempts !== undefined) {
    failFields["maxAttempts"] = maxAttempts;
  }

  // Message-only: no `err` field, provider cause chains may carry
  // request contents, which the boundary's URL scrub does not cover.
  log.error(
    permanent
      ? `generate: permanent failure — ${message}`
      : `generate: failed (${message}) — handing to graphile for retry`,
    failFields,
  );
  if (
    attempt !== undefined &&
    maxAttempts !== undefined &&
    attempt >= maxAttempts
  ) {
    log.error("generate: retries exhausted", {
      evt: "job.retries.exhausted",
      attempt,
      maxAttempts,
    });
  }
  return permanent;
}

/**
 * A claimed run fails through its claim; before the claim, an unclaimed mark.
 * False when the fenced write found the claim lost.
 */
async function recordFailure(
  error: unknown,
  inputs: JobFailureInputs,
): Promise<boolean> {
  const { projection, target, leaveRow, runId } = inputs;
  const failure = classifyFailure(error);
  if (runId !== undefined) {
    const finished = await projection.finishRun(target, runId, {
      status: GenerationStatuses.FAILED,
      failure,
    });
    return (
      finished.ok || finished.error.code !== GenerationErrorCodes.CLAIM_LOST
    );
  }
  if (!leaveRow) {
    await projection.markFailed(target, failure);
  }
  return true;
}
