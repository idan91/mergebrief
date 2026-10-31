import type { SpendView } from "contract";
import type { LoadedInstancePolicy } from "generators/instance-policy";
import {
  readSpendBreakdown,
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
  const breakdown = await readSpendBreakdown(deps.handle, day);

  const view: Mutable<SpendView> = {
    startedRuns: breakdown.startedUnits,
    dayStartedAt: day.from.toISOString(),
    resetsAt: day.to.toISOString(),
  };
  const cap = deps.spendPolicy.maxGenerationsPerDay;
  if (cap !== null) {
    view.cap = cap;
  }
  if (breakdown.largeRuns.runs > 0) {
    view.largeRuns = breakdown.largeRuns;
  }
  return view;
}
