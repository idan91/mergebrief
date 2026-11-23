import type { TFunction } from "i18next";
import {
  BotStates,
  ReviewBots,
  SizeBoundSides,
  TriggerConditionKinds,
  UnmetConditionKinds,
  type ReviewBot,
  type UnmetBot,
  type UnmetCi,
  type UnmetPlainCondition,
  type UnmetSize,
} from "types/trigger-conditions";

/** Each review bot's product name, a proper noun shown as is. */
const ReviewBotNames = {
  [ReviewBots.UNBLOCKED]: "Unblocked",
  [ReviewBots.CODERABBIT]: "CodeRabbit",
  [ReviewBots.CLAUDE]: "Claude Code Review",
  [ReviewBots.GREPTILE]: "Greptile",
  [ReviewBots.COPILOT]: "Copilot",
} as const satisfies Record<ReviewBot, string>;

/** An unmet condition as a reader holds it: no reason names a bot's verdict, so a reader may keep one it predates. */
export type DescribableCondition =
  | Exclude<UnmetPlainCondition, UnmetBot>
  | Omit<UnmetBot, "verdict">;

/** How a surface writes third-party text (a label, a branch, a glob, a check) into a reason. */
export interface UnmetConditionFormat {
  readonly t: TFunction;
  readonly formatName: (name: string) => string;
  readonly formatNames: (names: readonly string[]) => string;
  readonly formatChecks: (names: readonly string[]) => string;
}

function describeSize(t: TFunction, condition: UnmetSize): string {
  const params = {
    actual: String(condition.actual),
    measure: t(`triggerCondition.reason.sizeMeasure.${condition.measure}`),
    limit: String(condition.limit),
  };
  if (condition.side === SizeBoundSides.MAX) {
    return t("triggerCondition.reason.sizeMax", params);
  }
  return t("triggerCondition.reason.sizeMin", params);
}

function describeBot(
  t: TFunction,
  condition: Omit<UnmetBot, "verdict">,
): string {
  const bot = ReviewBotNames[condition.bot];
  if (condition.state === BotStates.ISSUES) {
    return t("triggerCondition.reason.bots.issues", {
      bot,
      count: condition.issues ?? 0,
    });
  }
  return t(`triggerCondition.reason.bots.${condition.state}`, { bot });
}

function describeCi(
  format: UnmetConditionFormat,
  condition: UnmetCi,
): string[] {
  const { t, formatChecks } = format;
  if (condition.permissionMissing) {
    return [t("triggerCondition.reason.ciPermissionMissing")];
  }

  const reasons: string[] = [];
  if (condition.failed.length > 0) {
    const checks = formatChecks(condition.failed);
    reasons.push(t("triggerCondition.reason.ciFailed", { checks }));
  }
  if (condition.running.length > 0) {
    const checks = formatChecks(condition.running);
    reasons.push(t("triggerCondition.reason.ciRunning", { checks }));
  }
  if (condition.missing.length > 0) {
    const checks = formatChecks(condition.missing);
    const count = condition.missing.length;
    reasons.push(t("triggerCondition.reason.ciMissing", { checks, count }));
  }
  return reasons;
}

/** One unmet condition's reasons in the catalog's words: one per kind, CI one per state with checks in it. */
export function describeUnmetCondition(
  condition: DescribableCondition,
  format: UnmetConditionFormat,
): string[] {
  const { t, formatName, formatNames } = format;
  switch (condition.kind) {
    case TriggerConditionKinds.READY_FOR_REVIEW:
    case TriggerConditionKinds.NEVER:
    case TriggerConditionKinds.REVIEW_REQUESTED:
      return [t(`triggerCondition.reason.${condition.kind}`)];
    case TriggerConditionKinds.SIZE:
      return [describeSize(t, condition)];
    case TriggerConditionKinds.LABELS:
      return [
        t("triggerCondition.reason.labels", {
          labels: formatNames(condition.labels),
          count: condition.labels.length,
        }),
      ];
    case TriggerConditionKinds.TITLE_KEYWORDS:
      return [
        t("triggerCondition.reason.title-keywords", {
          keywords: formatNames(condition.keywords),
          count: condition.keywords.length,
        }),
      ];
    case TriggerConditionKinds.BASE_BRANCHES:
      return [
        t("triggerCondition.reason.base-branches", {
          base: formatName(condition.base),
          branches: formatNames(condition.branches),
          count: condition.branches.length,
        }),
      ];
    case TriggerConditionKinds.PATHS:
      return [
        t("triggerCondition.reason.paths", {
          paths: formatNames(condition.paths),
          count: condition.paths.length,
        }),
      ];
    case TriggerConditionKinds.BOTS:
      return [describeBot(t, condition)];
    case TriggerConditionKinds.CI:
      return describeCi(format, condition);
  }
}

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
