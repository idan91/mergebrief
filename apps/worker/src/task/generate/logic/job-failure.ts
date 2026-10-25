import type { LogFields } from "logging";
import {
  GenerationErrorCodes,
  InvalidArtifactBodyError,
  ScopeViolationError,
  type GenerationFailure,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import { classifyFailure, PermanentJobError } from "../../failure";
import {
  FailureRecords,
  JobFailureOutcomes,
  type FailureRecord,
  type JobFailureInputs,
  type JobFailureOutcome,
  type JobFailureReport,
} from "../types";
import { emitProviderError } from "./errors";

/**
 * Mark the run failed, unless the row is to be left alone, and emit its
 * events. The outcome tells the caller whether the job ends here: it returns
 * normally on a permanent failure, or on a claim lost to another run or to a
 * deleted pull request, whose retry would only meet `held` or no row; it
 * rethrows otherwise so graphile owns the backoff.
 */
export async function reportJobFailure(
  error: unknown,
  inputs: JobFailureInputs,
): Promise<JobFailureReport> {
  const { deps, job, log } = inputs;

  const failure = classifyFailure(error);
  const record = await recordFailure(failure, inputs);
  const rowKept = record !== FailureRecords.WRITTEN;
  if (record === FailureRecords.LOST) {
    log.warn(
      "generate: the generation row is held by another run or gone, standing down",
    );
    return { outcome: JobFailureOutcomes.CLAIM_LOST, failure, rowKept };
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
  const lastAttempt =
    attempt !== undefined &&
    maxAttempts !== undefined &&
    attempt >= maxAttempts;
  if (lastAttempt) {
    log.error("generate: retries exhausted", {
      evt: "job.retries.exhausted",
      attempt,
      maxAttempts,
    });
  }
  return { outcome: selectOutcome(permanent, lastAttempt), failure, rowKept };
}

function selectOutcome(
  permanent: boolean,
  lastAttempt: boolean,
): JobFailureOutcome {
  if (permanent) {
    return JobFailureOutcomes.PERMANENT;
  }
  if (lastAttempt) {
    return JobFailureOutcomes.LAST_ATTEMPT;
  }
  return JobFailureOutcomes.RETRYING;
}

/**
 * A claimed run fails through its claim; before the claim, an unclaimed mark,
 * which leaves a row awaiting its trigger approval or holding a stored brief
 * even when the throw came before the run read it.
 */
async function recordFailure(
  failure: GenerationFailure,
  inputs: JobFailureInputs,
): Promise<FailureRecord> {
  const { projection, target, leaveRow, runId } = inputs;
  if (runId !== undefined) {
    const finished = await projection.finishRun(target, runId, {
      status: GenerationStatuses.FAILED,
      failure,
    });
    return finished.ok ? FailureRecords.WRITTEN : FailureRecords.LOST;
  }
  if (leaveRow) {
    return FailureRecords.KEPT;
  }

  const marked = await projection.markFailed(target, failure);
  if (marked.ok) {
    return FailureRecords.WRITTEN;
  }
  if (marked.error.code === GenerationErrorCodes.STATUS_KEPT) {
    return FailureRecords.KEPT;
  }
  return FailureRecords.LOST;
}
