// `pr <n>`'s `held:` line: each unmet trigger condition as the Entry comment
// words it, every check named. An item this build does not know prints its
// kind raw, so a newer server's condition still shows.
import { formatDisplayText } from "brief-core/hidden-chars";
import { createI18n, describeUnmetCondition, sortUnmetConditions } from "i18n";
import { GenerationStatuses, UnmetConditionKinds } from "types";
import {
  parseHeldItems,
  type HeldCondition,
  type HeldItem,
  type HeldPlainCondition,
} from "./held-items";

const { t } = createI18n();

/** Third-party text a PR author or a repository controls, shown escaped. */
function formatNames(names: readonly string[]): string {
  return names.map(formatDisplayText).join(", ");
}

function describeConditionWithSetBy(condition: HeldPlainCondition): string[] {
  const setBy = t(`triggerCondition.setBy.${condition.setBy}`);
  const reasons = describeUnmetCondition(condition, {
    t,
    formatName: formatDisplayText,
    formatNames,
    formatChecks: formatNames,
  });
  return reasons.map((reason) =>
    t("triggerCondition.condition", { reason, setBy }),
  );
}

function describeKnownItem(condition: HeldCondition): string[] {
  if (condition.kind !== UnmetConditionKinds.ANY) {
    return describeConditionWithSetBy(condition);
  }
  const known = condition.conditions.flatMap(describeConditionWithSetBy);
  const raw = condition.rawKinds.map(formatDisplayText);
  const members = [...known, ...raw];
  return [`${t("triggerCondition.anyGroup")} ${members.join(" or ")}`];
}

function listKnownConditions(items: readonly HeldItem[]): HeldCondition[] {
  return items.flatMap((item) =>
    item.known === undefined ? [] : [item.known],
  );
}

/**
 * The line `pr <n>` prints under a held head, or `undefined` when the head
 * is not held. Known items follow the Entry's order; raw kinds trail them,
 * then a list the server read only in part says so, and a list with nothing
 * readable still says why the head waits.
 */
export function formatHeldLine(
  status: string | undefined,
  rawItems: unknown,
  unmetConditionsPartial = false,
): string | undefined {
  if (status !== GenerationStatuses.HELD) {
    return undefined;
  }

  const items = parseHeldItems(rawItems);
  const known = sortUnmetConditions(listKnownConditions(items));
  const raw = items.flatMap((item) =>
    item.rawKind === undefined ? [] : [formatDisplayText(item.rawKind)],
  );
  const phrases = [...known.flatMap(describeKnownItem), ...raw];
  if (unmetConditionsPartial) {
    phrases.push(t("triggerCondition.unreadable"));
  }
  if (phrases.length === 0) {
    return "held: trigger conditions not met\n";
  }
  return `held: ${phrases.join("; ")}\n`;
}
