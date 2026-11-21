import type { CheckRun } from "github";
import { ReviewBots, type ReviewBot } from "types/trigger-conditions";

const REVIEW_BOT_NAMES: ReadonlySet<string> = new Set(
  Object.values(ReviewBots),
);

export function isReviewBot(value: string): value is ReviewBot {
  return REVIEW_BOT_NAMES.has(value);
}

/** A rerun takes a higher id, so the highest is the run GitHub counts. */
export function findLatestRun(
  runs: readonly CheckRun[],
  isCounted: (run: CheckRun) => boolean,
): CheckRun | undefined {
  return runs.filter(isCounted).reduce<CheckRun | undefined>((latest, run) => {
    if (latest === undefined || run.checkRunId > latest.checkRunId) {
      return run;
    }
    return latest;
  }, undefined);
}
