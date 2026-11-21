import type {
  EffectiveTriggerConditions,
  SourcedCondition,
} from "generators/trigger-conditions";
import {
  TriggerConditionKinds,
  UnmetConditionKinds,
  type TriggerConditionKind,
  type UnmetCondition,
  type UnmetPlainCondition,
} from "types/trigger-conditions";

import type { ConditionFacts } from "./types";

/** A kind's check: the unmet items it leaves, none when the push meets it. */
type KindCheck = (
  condition: SourcedCondition,
  facts: ConditionFacts,
) => UnmetPlainCondition[];

const NOTHING_UNMET: UnmetPlainCondition[] = [];

function checkReadyForReview(
  condition: SourcedCondition,
  facts: ConditionFacts,
): UnmetPlainCondition[] {
  if (!facts.draft) {
    return NOTHING_UNMET;
  }
  return [
    { kind: TriggerConditionKinds.READY_FOR_REVIEW, source: condition.source },
  ];
}

function checkNever(condition: SourcedCondition): UnmetPlainCondition[] {
  return [{ kind: TriggerConditionKinds.NEVER, source: condition.source }];
}

/** Each kind's check; a kind without one here is met. */
const KIND_CHECKS: Partial<Record<TriggerConditionKind, KindCheck>> = {
  [TriggerConditionKinds.READY_FOR_REVIEW]: checkReadyForReview,
  [TriggerConditionKinds.NEVER]: checkNever,
};

function checkCondition(
  condition: SourcedCondition,
  facts: ConditionFacts,
): UnmetPlainCondition[] {
  const check = KIND_CHECKS[condition.setting.kind];
  return check === undefined ? NOTHING_UNMET : check(condition, facts);
}

/**
 * Every unmet item, in configured order, an unmet `any` group last: every
 * plain condition must pass, and one member of the group is enough.
 */
export function evaluateTriggerConditions(
  effective: EffectiveTriggerConditions,
  facts: ConditionFacts,
): UnmetCondition[] {
  const unmet: UnmetCondition[] = effective.all.flatMap((condition) =>
    checkCondition(condition, facts),
  );
  if (effective.any.length === 0) {
    return unmet;
  }

  const members = effective.any.map((condition) =>
    checkCondition(condition, facts),
  );
  const groupMet = members.some((items) => items.length === 0);
  if (!groupMet) {
    unmet.push({ kind: UnmetConditionKinds.ANY, conditions: members.flat() });
  }
  return unmet;
}
