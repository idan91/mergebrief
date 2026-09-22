import type { LogFields } from "logging";
import { classifyFailure, PermanentJobError } from "../../failure";
import type { JobFailureInputs } from "../types";
import { emitProviderError } from "./errors";

/**
 * Mark the run failed, unless the row is to be left alone, and emit its
 * events. Returns whether the failure is permanent: the caller returns
 * normally on permanent so graphile does not retry, and rethrows otherwise
 * so graphile owns the backoff.
 */
export async function reportJobFailure(
  error: unknown,
  inputs: JobFailureInputs,
): Promise<boolean> {
  const { deps, projection, target, leaveRow, job, log } = inputs;

  const message = error instanceof Error ? error.message : String(error);
  if (!leaveRow) {
    await projection.markFailed(target, classifyFailure(error));
  }
  emitProviderError(log, deps, error);
  const permanent = error instanceof PermanentJobError;
  const attempt = job?.attempts;
  const maxAttempts = job?.max_attempts;
  const failFields: LogFields = { evt: "job.fail", permanent };

  if (attempt !== undefined) failFields["attempt"] = attempt;
  if (maxAttempts !== undefined) failFields["maxAttempts"] = maxAttempts;

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
    });
  }
  return permanent;
}
