import { isWaitingCondition, sortUnmetConditions } from "contract";
import { describeUnmetCondition } from "i18n";
import type { TFunction } from "i18next";

import type {
  HeldCondition,
  HeldConditionSplit,
  HeldPlainCondition,
} from "./types";

const NAME_SEPARATOR = ", ";

/**
 * The page's two groups: what clears by itself and what needs someone to act,
 * each in the Entry's order. An `any` group waits when one member does.
 */
export function splitUnmetConditions(
  unmet: readonly HeldCondition[],
): HeldConditionSplit {
  const sorted = sortUnmetConditions(unmet);
  return {
    waits: sorted.filter(isWaitingCondition),
    needs: sorted.filter((condition) => !isWaitingCondition(condition)),
  };
}

/**
 * Why the held head has not generated, for the line under the heading. A list
 * this bundle read only in part may hide what holds it, so it says neither.
 */
export function readHeldLead(
  t: TFunction,
  split: HeldConditionSplit,
  unmetConditionsPartial: boolean,
): string {
  if (unmetConditionsPartial) {
    return t("pulls.held.lead.unknown");
  }
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

function keepName(name: string): string {
  return name;
}

/** A condition's reasons in the Entry comment's words; CI gives one per state. */
export function describeUnmetReasons(
  t: TFunction,
  condition: HeldPlainCondition,
): string[] {
  return describeUnmetCondition(condition, {
    t,
    formatName: keepName,
    formatNames: joinNames,
    formatChecks: joinNames,
  });
}

/** A stable React key for one unmet item: its content, which no two items share. */
export function readUnmetConditionKey(condition: HeldCondition): string {
  return JSON.stringify(condition);
}
