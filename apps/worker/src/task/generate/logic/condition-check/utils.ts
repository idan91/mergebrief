import type { CheckRun } from "github";
import type {
  EffectiveTriggerConditions,
  TriggerConditionSetting,
} from "generators/trigger-conditions";
import {
  ReviewBots,
  type ReviewBot,
  type TriggerConditionKind,
} from "types/trigger-conditions";

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
    const isNewer = latest === undefined || run.checkRunId > latest.checkRunId;
    if (isNewer) {
      return run;
    }
    return latest;
  }, undefined);
}

export function listSettings(
  effective: EffectiveTriggerConditions,
): TriggerConditionSetting[] {
  const conditions = [...effective.all, ...effective.any];
  return conditions.map((condition) => condition.setting);
}

export function isKindConfigured(
  effective: EffectiveTriggerConditions,
  kind: TriggerConditionKind,
): boolean {
  return listSettings(effective).some((setting) => setting.kind === kind);
}
