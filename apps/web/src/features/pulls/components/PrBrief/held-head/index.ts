import type { TFunction } from "i18next";

import type { HeldConditionSplit } from "@web/utils/unmet-conditions/types";

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
