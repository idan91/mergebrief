import {
  BotStates,
  TriggerConditionKinds,
  UnmetConditionKinds,
  type UnmetBot,
  type UnmetCi,
  type UnmetPlainCondition,
} from "types/trigger-conditions";

type KindDecidedCondition = Exclude<
  UnmetPlainCondition,
  UnmetBot | UnmetCi
>["kind"];

interface WaitDecidingByKind {
  readonly kind: KindDecidedCondition;
}

interface WaitDecidingAnyGroup {
  readonly kind: typeof UnmetConditionKinds.ANY;
  readonly conditions: readonly WaitDecidingCondition[];
}

/** The fields deciding a wait, so a reader that widens a field it never reads still passes its items. */
type WaitDecidingCondition =
  | WaitDecidingByKind
  | Pick<UnmetBot, "kind" | "state">
  | Pick<UnmetCi, "kind" | "permissionMissing" | "failed">
  | WaitDecidingAnyGroup;

/**
 * A condition that clears by itself, a bot or CI still working, as against
 * one someone has to act on. Decided by the state, never the kind.
 */
export function isWaitingCondition(condition: WaitDecidingCondition): boolean {
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
export function sortUnmetConditions<Condition extends WaitDecidingCondition>(
  unmet: readonly Condition[],
): Condition[] {
  const plain = unmet.filter((item) => item.kind !== UnmetConditionKinds.ANY);
  const groups = unmet.filter((item) => item.kind === UnmetConditionKinds.ANY);
  const waits = plain.filter(isWaitingCondition);
  const blockers = plain.filter((item) => !isWaitingCondition(item));
  return [...waits, ...blockers, ...groups];
}
