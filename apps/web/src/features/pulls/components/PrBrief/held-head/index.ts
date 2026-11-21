import { isWaitingCondition, sortUnmetConditions } from "contract";
import type { TFunction } from "i18next";
import {
  BotStates,
  ReviewBotNames,
  SizeBoundSides,
  TriggerConditionKinds,
  type UnmetBot,
  type UnmetCi,
  type UnmetCondition,
  type UnmetPlainCondition,
  type UnmetSize,
} from "types/trigger-conditions";

import type { HeldConditionSplit } from "./types";

const NAME_SEPARATOR = ", ";

/**
 * The page's two groups: what clears by itself and what needs someone to act,
 * each in the Entry's order. An `any` group waits when one member does.
 */
export function splitUnmetConditions(
  unmet: readonly UnmetCondition[],
): HeldConditionSplit {
  const sorted = sortUnmetConditions(unmet);
  return {
    waits: sorted.filter(isWaitingCondition),
    needs: sorted.filter((condition) => !isWaitingCondition(condition)),
  };
}

/** Why the held head has not generated, for the line under the heading. */
export function readHeldLead(t: TFunction, split: HeldConditionSplit): string {
  if (split.needs.length > 0) {
    return t("pulls.held.lead.needs");
  }
  if (split.waits.length > 0) {
    return t("pulls.held.lead.waits");
  }
  return t("pulls.held.lead.unknown");
}

function joinNames(names: readonly string[]): string {
  return names.join(NAME_SEPARATOR);
}

function describeSize(t: TFunction, condition: UnmetSize): string {
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

/** One line per CI state with checks in it; the page names every check. */
function describeCi(t: TFunction, condition: UnmetCi): string[] {
  if (condition.permissionMissing) {
    return [t("triggerCondition.reason.ciPermissionMissing")];
  }

  const lines: string[] = [];
  if (condition.failed.length > 0) {
    const checks = joinNames(condition.failed);
    lines.push(t("triggerCondition.reason.ciFailed", { checks }));
  }
  if (condition.running.length > 0) {
    const checks = joinNames(condition.running);
    lines.push(t("triggerCondition.reason.ciRunning", { checks }));
  }
  if (condition.missing.length > 0) {
    const checks = joinNames(condition.missing);
    const count = condition.missing.length;
    lines.push(t("triggerCondition.reason.ciMissing", { checks, count }));
  }
  return lines;
}

/** A condition's reasons in the Entry comment's words; CI gives one per state. */
export function describeUnmetReasons(
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
          labels: joinNames(condition.labels),
          count: condition.labels.length,
        }),
      ];
    case TriggerConditionKinds.TITLE_KEYWORDS:
      return [
        t("triggerCondition.reason.title-keywords", {
          keywords: joinNames(condition.keywords),
          count: condition.keywords.length,
        }),
      ];
    case TriggerConditionKinds.BASE_BRANCHES:
      return [
        t("triggerCondition.reason.base-branches", {
          base: condition.base,
          branches: joinNames(condition.branches),
          count: condition.branches.length,
        }),
      ];
    case TriggerConditionKinds.PATHS:
      return [
        t("triggerCondition.reason.paths", {
          paths: joinNames(condition.paths),
          count: condition.paths.length,
        }),
      ];
    case TriggerConditionKinds.BOTS:
      return [describeBot(t, condition)];
    case TriggerConditionKinds.CI:
      return describeCi(t, condition);
  }
}

/** A stable React key for one unmet item: its content, which no two items share. */
export function readUnmetConditionKey(condition: UnmetCondition): string {
  return JSON.stringify(condition);
}
