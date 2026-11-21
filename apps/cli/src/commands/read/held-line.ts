// `pr <n>`'s `held:` line: each unmet trigger condition as the Entry comment
// words it, every check named. An item this build does not know prints its
// kind raw, so a newer server's condition still shows.
import { sortUnmetConditions } from "contract";
import { formatDisplayText } from "brief-core/hidden-chars";
import { createI18n } from "i18n";
import { GenerationStatuses } from "types/generations";
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
import { parseHeldItems, type HeldItem } from "./held-items";

const { t } = createI18n();

/** Third-party text a PR author or a repository controls, shown escaped. */
function formatNames(names: readonly string[]): string {
  return names.map(formatDisplayText).join(", ");
}

function describeSize(condition: UnmetSize): string {
  const params = {
    actual: String(condition.actual),
    measure: t(`triggerCondition.reason.sizeCount.${condition.count}`),
    limit: String(condition.limit),
  };
  if (condition.side === SizeBoundSides.MAX) {
    return t("triggerCondition.reason.sizeMax", params);
  }
  return t("triggerCondition.reason.sizeMin", params);
}

function describeBot(condition: UnmetBot): string {
  const bot = ReviewBotNames[condition.bot];
  if (condition.state === BotStates.ISSUES) {
    return t("triggerCondition.reason.bots.issues", {
      bot,
      count: condition.issues ?? 0,
    });
  }
  return t(`triggerCondition.reason.bots.${condition.state}`, { bot });
}

function describeCi(condition: UnmetCi): string[] {
  if (condition.permissionMissing) {
    return [t("triggerCondition.reason.ciPermissionMissing")];
  }

  const phrases: string[] = [];
  if (condition.failed.length > 0) {
    const checks = formatNames(condition.failed);
    phrases.push(t("triggerCondition.reason.ciFailed", { checks }));
  }
  if (condition.running.length > 0) {
    const checks = formatNames(condition.running);
    phrases.push(t("triggerCondition.reason.ciRunning", { checks }));
  }
  if (condition.missing.length > 0) {
    const checks = formatNames(condition.missing);
    const count = condition.missing.length;
    phrases.push(t("triggerCondition.reason.ciMissing", { checks, count }));
  }
  return phrases;
}

function describeCondition(condition: UnmetPlainCondition): string[] {
  switch (condition.kind) {
    case TriggerConditionKinds.READY_FOR_REVIEW:
    case TriggerConditionKinds.NEVER:
    case TriggerConditionKinds.REVIEW_REQUESTED:
      return [t(`triggerCondition.reason.${condition.kind}`)];
    case TriggerConditionKinds.SIZE:
      return [describeSize(condition)];
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
          base: formatDisplayText(condition.base),
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
      return [describeBot(condition)];
    case TriggerConditionKinds.CI:
      return describeCi(condition);
  }
}

function describeOwnedCondition(condition: UnmetPlainCondition): string[] {
  const owner = t(`triggerCondition.owner.${condition.source}`);
  return describeCondition(condition).map((reason) =>
    t("triggerCondition.condition", { reason, owner }),
  );
}

function describeKnownItem(condition: UnmetCondition): string[] {
  if (condition.kind !== UnmetConditionKinds.ANY) {
    return describeOwnedCondition(condition);
  }
  const members = condition.conditions.flatMap(describeOwnedCondition);
  return [`${t("triggerCondition.anyGroup")} ${members.join(" or ")}`];
}

function listKnownConditions(items: readonly HeldItem[]): UnmetCondition[] {
  return items.flatMap((item) =>
    item.known === undefined ? [] : [item.known],
  );
}

/**
 * The line `pr <n>` prints under a held head, or `undefined` when the head
 * is not held. Known items follow the Entry's order; raw kinds trail them.
 */
export function formatHeldLine(
  status: string | undefined,
  rawItems: unknown,
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
  return `held: ${phrases.join("; ")}\n`;
}
