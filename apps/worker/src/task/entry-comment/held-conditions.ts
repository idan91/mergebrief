import { sortUnmetConditions } from "contract";
import { describeUnmetCondition } from "i18n";
import type { TFunction } from "i18next";
import {
  UnmetConditionKinds,
  type UnmetCondition,
  type UnmetPlainCondition,
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
  return t("triggerCondition.moreChecks", { names: shown, count: rest });
}

/** A condition's reasons, each naming whose setting it is. */
function describeConditionWithSetBy(
  t: TFunction,
  condition: UnmetPlainCondition,
): string[] {
  const setBy = t(`triggerCondition.setBy.${condition.setBy}`);
  const reasons = describeUnmetCondition(condition, {
    t,
    formatName: formatInlineCode,
    formatNames: formatCodeList,
    formatChecks: (names) => formatCheckList(t, names),
  });
  return reasons.map((reason) =>
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
