// The `sweep-generation-parts` task: deletes a multi-call run's stored parts
// once their span sat idle past the week on graphile's cron. Instance-wide,
// not ctx-bound. Always on: a span no run finished keeps its parts for a
// retry or a re-trigger, and nothing else removes them before the pull
// request's own cascade.
import { sweepStaleGenerationParts, type AppDatabase } from "persistence";
import type { Logger } from "logging";

export const SWEEP_GENERATION_PARTS_TASK = "sweep-generation-parts";

/** Daily, away from the other sweeps' minutes. */
export const SWEEP_GENERATION_PARTS_CRONTAB = `29 4 * * * ${SWEEP_GENERATION_PARTS_TASK}`;

export interface SweepGenerationPartsTaskDeps {
  readonly handle: AppDatabase;
  readonly log: Logger;
}

/** Graphile's `Task` shape; the cron payload is unused. */
export function createSweepGenerationPartsTask(
  deps: SweepGenerationPartsTaskDeps,
): () => Promise<void> {
  return async function sweepParts(): Promise<void> {
    const deleted = await sweepStaleGenerationParts(deps.handle, new Date());

    if (deleted > 0) {
      deps.log.info(
        `sweep-generation-parts: deleted ${deleted} stored parts of idle spans`,
      );
    }
  };
}
