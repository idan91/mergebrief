import { AnchorWarnings, type AnchorWarning } from "brief-core/types";
import type { TranslationKey } from "i18n";

/** The catalog line each anchor warning reads as. */
export const ANCHOR_WARNING_KEYS = {
  [AnchorWarnings.SPAN_UNAVAILABLE]:
    "brief.details.anchorWarning.spanUnavailable",
  [AnchorWarnings.HUNKS_UNPAIRED]: "brief.details.anchorWarning.hunksUnpaired",
} as const satisfies Record<AnchorWarning, TranslationKey>;
