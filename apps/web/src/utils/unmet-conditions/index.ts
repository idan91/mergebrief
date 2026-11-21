import {
  describeUnmetCondition,
  isWaitingCondition,
  sortUnmetConditions,
} from "i18n";
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
