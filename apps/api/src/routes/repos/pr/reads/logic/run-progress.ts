import type {
  GenerationRow,
  GenerationProjection,
  RunAttempt,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import type { Mutable } from "types/utils";
import type { MetaRunProgress } from "../../../../pr-view";

/**
 * The plan the grouping recorded: every detail call, stored and fresh alike,
 * so a resumed attempt reads the same N as the Entry; `done` never reads
 * past it.
 */
export function deriveRunProgress(attempt: RunAttempt): MetaRunProgress {
  const progress: Mutable<MetaRunProgress> = {
    startedAt: attempt.recordedAt,
  };
  const total = attempt.partsTotal;
  if (total !== null && total > 0) {
    progress.parts = { done: Math.min(attempt.partsDone, total), total };
  }
  return progress;
}

/** The attempt is read only for a running row a claim names; any other poll costs no query. */
export async function readRunProgress(
  generations: GenerationProjection,
  latestGeneration: GenerationRow | undefined,
): Promise<MetaRunProgress | undefined> {
  const running = latestGeneration?.status === GenerationStatuses.RUNNING;
  if (!running || latestGeneration.runId === null) {
    return undefined;
  }

  const attempt = await generations.readRunAttempt(latestGeneration.runId);
  return attempt === undefined ? undefined : deriveRunProgress(attempt);
}
