import type { TranslationKey } from "i18n";

import { Specificities, type IntentCheck } from "brief-core/types";
import type { IntentCountSpec } from "./utils";

/** Neutral one-liner shown when the intent source is not checkable. */
export const UNAVAILABLE_REASON_KEY: Record<
  Exclude<IntentCheck["specificity"], typeof Specificities.PRECISE>,
  TranslationKey
> = {
  [Specificities.BROAD]: "brief.intent.reasonBroad",
  [Specificities.NONE]: "brief.intent.reasonNone",
};

/**
 * A bucket past the threshold clamps to the visible count plus an in-place
 * "Show all N" expander; growth stays in place, nothing behind a scroll.
 */
export const CLAMP_THRESHOLD = 6;
export const CLAMP_VISIBLE = 5;

/**
 * Marks the alarm buckets. A label mark, never a color: the code-risk
 * palette here would make an epistemic caution read as a severity.
 */
export const ALARM_GLYPH = "◇";

/** The bar's element id: the mark-ready jump lands on it. One bar per page. */
export const INTENT_BAR_ID = "intent-bar";

/** The head's counts, in the order the body's buckets read. */
export const INTENT_COUNTS: readonly IntentCountSpec[] = [
  { field: "accomplished", labelKey: "brief.intent.accomplished" },
  {
    field: "claimedButUnachieved",
    labelKey: "brief.intent.claimedButUnachieved",
  },
  { field: "deviations", labelKey: "brief.intent.deviations" },
  { field: "statedButMissing", labelKey: "brief.intent.statedButMissing" },
  { field: "doneButUnstated", labelKey: "brief.intent.doneButUnstated" },
];
