import {
  BotStates,
  TriggerConditionKinds,
  UnmetConditionKinds,
  type UnmetCondition,
} from "types/trigger-conditions";

/**
 * A condition that clears by itself, a bot or CI still working, as against
 * one someone has to act on. Decided by the state, never the kind.
 */
export function isWaitingCondition(condition: UnmetCondition): boolean {
  switch (condition.kind) {
    case TriggerConditionKinds.BOTS:
      return (
        condition.state === BotStates.NOT_STARTED ||
        condition.state === BotStates.RUNNING
      );
    case TriggerConditionKinds.CI:
      return !condition.permissionMissing && condition.failed.length === 0;
    case UnmetConditionKinds.ANY:
      return condition.conditions.some(isWaitingCondition);
    default:
      return false;
  }
}

/** Waits first, then the conditions someone must act on, the `any` group last. */
export function sortUnmetConditions(
  unmet: readonly UnmetCondition[],
): UnmetCondition[] {
  const plain = unmet.filter((item) => item.kind !== UnmetConditionKinds.ANY);
  const groups = unmet.filter((item) => item.kind === UnmetConditionKinds.ANY);
  const waits = plain.filter(isWaitingCondition);
  const blockers = plain.filter((item) => !isWaitingCondition(item));
  return [...waits, ...blockers, ...groups];
}
