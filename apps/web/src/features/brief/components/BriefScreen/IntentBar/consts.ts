import type { TranslationKey } from "i18n";

import type { IntentCheck } from "../../../types";

/** Neutral one-liner shown when the intent source is not checkable. */
export const UNAVAILABLE_REASON_KEY: Record<
  Exclude<IntentCheck["specificity"], "precise">,
  TranslationKey
> = {
  broad: "brief.intent.reasonBroad",
  none: "brief.intent.reasonNone",
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
