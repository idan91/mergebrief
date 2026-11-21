import type { TFunction } from "i18next";
import { GenerationStatuses } from "types";
import { UnmetConditionKinds } from "types/trigger-conditions";

import { isNoLongerOpen } from "@web/features/pulls/utils";
import {
  describeUnmetReasons,
  splitUnmetConditions,
} from "@web/utils/unmet-conditions";
import type { HeldCondition } from "@web/utils/unmet-conditions/types";
import type { InboxGeneration, InboxItem } from "../../../../types";
import type { HeldReason } from "./types";

/** One line for an unmet item: an `any` group by its size, a lone member as itself. */
function describeLead(
  t: TFunction,
  condition: HeldCondition,
): string | undefined {
  if (condition.kind !== UnmetConditionKinds.ANY) {
    return describeUnmetReasons(t, condition)[0];
  }
  const [only, ...others] = condition.conditions;
  if (only !== undefined && others.length === 0) {
    return describeUnmetReasons(t, only)[0];
  }
  return t("home.inbox.held.anyGroup", { count: condition.conditions.length });
}

/**
 * What the row's second line says about an open pull request's held head:
 * the first item someone must act on, else the first wait, and how many
 * more there are. Nothing for any other head, nor for a list this bundle
 * read only in part, whose lead or count may be wrong.
 */
export function readHeldReason(
  t: TFunction,
  generation: InboxGeneration | undefined,
  state: InboxItem["state"],
): HeldReason | undefined {
  const held = generation?.status === GenerationStatuses.HELD;
  if (!held || isNoLongerOpen(state)) {
    return undefined;
  }
  if (generation.unmetConditionsPartial === true) {
    return undefined;
  }

  const unmet = generation.unmetConditions ?? [];
  const split = splitUnmetConditions(unmet);
  const lead = split.needs[0] ?? split.waits[0];
  if (lead === undefined) {
    return undefined;
  }
  const text = describeLead(t, lead);
  if (text === undefined) {
    return undefined;
  }
  return { text, more: unmet.length - 1 };
}
