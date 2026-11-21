import { sortUnmetConditions } from "contract";
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
  type UnmetCondition,
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
  return t("triggerCondition.moreChecks", { names: shown, count: rest });
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

function describeBot(t: TFunction, condition: UnmetBot): string {
  const bot = ReviewBotNames[condition.bot];
  if (condition.state === BotStates.ISSUES) {
    return t("triggerCondition.reason.bots.issues", {
      bot,
      count: condition.issues ?? 0,
    });
  }
  return t(`triggerCondition.reason.bots.${condition.state}`, { bot });
}

function describeCi(t: TFunction, condition: UnmetCi): string[] {
  if (condition.permissionMissing) {
    return [t("triggerCondition.reason.ciPermissionMissing")];
  }

  const lines: string[] = [];
  if (condition.failed.length > 0) {
    const checks = formatCheckList(t, condition.failed);
    lines.push(t("triggerCondition.reason.ciFailed", { checks }));
  }
  if (condition.running.length > 0) {
    const checks = formatCheckList(t, condition.running);
    lines.push(t("triggerCondition.reason.ciRunning", { checks }));
  }
  if (condition.missing.length > 0) {
    const checks = formatCheckList(t, condition.missing);
    const count = condition.missing.length;
    lines.push(t("triggerCondition.reason.ciMissing", { checks, count }));
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
      return [t(`triggerCondition.reason.${condition.kind}`)];
    case TriggerConditionKinds.SIZE:
      return [describeSize(t, condition)];
    case TriggerConditionKinds.LABELS:
      return [
        t("triggerCondition.reason.labels", {
          labels: formatCodeList(condition.labels),
          count: condition.labels.length,
        }),
      ];
    case TriggerConditionKinds.TITLE_KEYWORDS:
      return [
        t("triggerCondition.reason.title-keywords", {
          keywords: formatCodeList(condition.keywords),
          count: condition.keywords.length,
        }),
      ];
    case TriggerConditionKinds.BASE_BRANCHES:
      return [
        t("triggerCondition.reason.base-branches", {
          base: formatInlineCode(condition.base),
          branches: formatCodeList(condition.branches),
          count: condition.branches.length,
        }),
      ];
    case TriggerConditionKinds.PATHS:
      return [
        t("triggerCondition.reason.paths", {
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
function describeConditionWithSetBy(
  t: TFunction,
  condition: UnmetPlainCondition,
): string[] {
  const setBy = t(`triggerCondition.setBy.${condition.setBy}`);
  return describeCondition(t, condition).map((reason) =>
    t("triggerCondition.condition", { reason, setBy }),
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
      return describeConditionWithSetBy(t, condition).map((line) => `- ${line}`);
    }
    const members = condition.conditions.flatMap((member) =>
      describeConditionWithSetBy(t, member).map((line) => `  - ${line}`),
    );
    return [`- ${t("triggerCondition.anyGroup")}`, ...members];
  });
}
