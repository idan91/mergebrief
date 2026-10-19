import type { SpendView } from "contract";
import type { LoadedInstancePolicy } from "generators/instance-policy";
import {
  countStartedRunsOnDay,
  utcDayBounds,
  type AppDatabase,
} from "persistence";
import type { Mutable } from "types/utils";

export interface ReadSpendDeps {
  readonly handle: AppDatabase;
  readonly spendPolicy: LoadedInstancePolicy["spendPolicy"];
}

export async function readSpend(
  deps: ReadSpendDeps,
  now: Date,
): Promise<SpendView> {
  const day = utcDayBounds(now);
  const startedRuns = await countStartedRunsOnDay(deps.handle, day);

  const view: Mutable<SpendView> = {
    startedRuns,
    dayStartedAt: day.from.toISOString(),
    resetsAt: day.to.toISOString(),
  };
  const cap = deps.spendPolicy.maxGenerationsPerDay;
  if (cap !== null) {
    view.cap = cap;
  }
  return view;
}
