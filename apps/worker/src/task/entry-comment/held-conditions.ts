import type { TFunction } from "i18next";
import {
  BotStates,
  ReviewBotNames,
  SizeBoundSides,
  TriggerConditionKinds,
  UnmetConditionKinds,
  type UnmetBot,
  type UnmetCi,
  type UnmetCondition,
  type UnmetPlainCondition,
  type UnmetSize,
} from "types/trigger-conditions";

/** A CI line names this many checks, then counts the rest. */
const CHECK_NAMES_SHOWN = 3;

const BACKTICK_RUN = /`+/g;

/**
 * Third-party text (a label, a branch, a check name, a glob) as inline code
 * that nothing inside can close: the fence is one backtick longer than the
 * text's longest run, and a line break folds to a space.
 */
export function formatInlineCode(text: string): string {
  const flat = text.replace(/[\r\n]+/g, " ");
  const runs = flat.match(BACKTICK_RUN) ?? [];
  const longest = Math.max(0, ...runs.map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const padded = longest > 0 ? ` ${flat} ` : flat;
  return `${fence}${padded}${fence}`;
}

function formatCodeList(names: readonly string[]): string {
  return names.map(formatInlineCode).join(", ");
}

function formatCheckList(t: TFunction, names: readonly string[]): string {
  const shown = formatCodeList(names.slice(0, CHECK_NAMES_SHOWN));
  const rest = names.length - CHECK_NAMES_SHOWN;
  if (rest <= 0) {
    return shown;
  }
  return t("entryComment.held.moreChecks", { names: shown, count: rest });
}

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

function describeSize(t: TFunction, condition: UnmetSize): string {
  const params = {
    actual: String(condition.actual),
    measure: t(`entryComment.held.reason.sizeCount.${condition.count}`),
    limit: String(condition.limit),
  };
  if (condition.side === SizeBoundSides.MAX) {
    return t("entryComment.held.reason.sizeMax", params);
  }
  return t("entryComment.held.reason.sizeMin", params);
}

function describeBot(t: TFunction, condition: UnmetBot): string {
  const bot = ReviewBotNames[condition.bot];
  if (condition.state === BotStates.ISSUES) {
    return t("entryComment.held.reason.bots.issues", {
      bot,
      count: condition.issues ?? 0,
    });
  }
  return t(`entryComment.held.reason.bots.${condition.state}`, { bot });
}

function describeCi(t: TFunction, condition: UnmetCi): string[] {
  if (condition.permissionMissing) {
    return [t("entryComment.held.reason.ciPermissionMissing")];
  }

  const lines: string[] = [];
  if (condition.failed.length > 0) {
    const checks = formatCheckList(t, condition.failed);
    lines.push(t("entryComment.held.reason.ciFailed", { checks }));
  }
  if (condition.running.length > 0) {
    const checks = formatCheckList(t, condition.running);
    lines.push(t("entryComment.held.reason.ciRunning", { checks }));
  }
  if (condition.missing.length > 0) {
    const checks = formatCheckList(t, condition.missing);
    const count = condition.missing.length;
    lines.push(t("entryComment.held.reason.ciMissing", { checks, count }));
  }
  return lines;
}

/** One unmet condition's reasons, most kinds one line and CI one per state. */
function describeCondition(
  t: TFunction,
  condition: UnmetPlainCondition,
): string[] {
  switch (condition.kind) {
    case TriggerConditionKinds.READY_FOR_REVIEW:
    case TriggerConditionKinds.NEVER:
    case TriggerConditionKinds.REVIEW_REQUESTED:
      return [t(`entryComment.held.reason.${condition.kind}`)];
    case TriggerConditionKinds.SIZE:
      return [describeSize(t, condition)];
    case TriggerConditionKinds.LABELS:
      return [
        t("entryComment.held.reason.labels", {
          labels: formatCodeList(condition.labels),
          count: condition.labels.length,
        }),
      ];
    case TriggerConditionKinds.TITLE_KEYWORDS:
      return [
        t("entryComment.held.reason.title-keywords", {
          keywords: formatCodeList(condition.keywords),
          count: condition.keywords.length,
        }),
      ];
    case TriggerConditionKinds.BASE_BRANCHES:
      return [
        t("entryComment.held.reason.base-branches", {
          base: formatInlineCode(condition.base),
          branches: formatCodeList(condition.branches),
          count: condition.branches.length,
        }),
      ];
    case TriggerConditionKinds.PATHS:
      return [
        t("entryComment.held.reason.paths", {
          paths: formatCodeList(condition.paths),
          count: condition.paths.length,
        }),
      ];
    case TriggerConditionKinds.BOTS:
      return [describeBot(t, condition)];
    case TriggerConditionKinds.CI:
      return describeCi(t, condition);
  }
}

/** A condition's reasons, each naming whose setting it is. */
function describeOwnedCondition(
  t: TFunction,
  condition: UnmetPlainCondition,
): string[] {
  const owner = t(`entryComment.held.owner.${condition.source}`);
  return describeCondition(t, condition).map((reason) =>
    t("entryComment.held.condition", { reason, owner }),
  );
}

/**
 * The held body's Markdown list: one bullet per unmet reason, in wait,
 * blocker, group order, an `any` group's members nested under its line.
 */
export function formatHeldConditionLines(
  t: TFunction,
  unmet: readonly UnmetCondition[],
): string[] {
  return sortUnmetConditions(unmet).flatMap((condition) => {
    if (condition.kind !== UnmetConditionKinds.ANY) {
      return describeOwnedCondition(t, condition).map((line) => `- ${line}`);
    }
    const members = condition.conditions.flatMap((member) =>
      describeOwnedCondition(t, member).map((line) => `  - ${line}`),
    );
    return [`- ${t("entryComment.held.anyGroup")}`, ...members];
  });
}
