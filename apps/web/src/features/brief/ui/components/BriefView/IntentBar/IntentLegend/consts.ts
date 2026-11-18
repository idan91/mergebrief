import type { TranslationKey } from "i18n";

export interface IntentLegendRow {
  labelKey: TranslationKey;
  definitionKey: TranslationKey;
  alarm: boolean;
}

/** One row per bucket, in the bar's count order. */
export const INTENT_LEGEND_ROWS: readonly IntentLegendRow[] = [
  {
    labelKey: "brief.intent.bucketAccomplished",
    definitionKey: "brief.intent.legendAccomplished",
    alarm: false,
  },
  {
    labelKey: "brief.intent.bucketMaskedFixes",
    definitionKey: "brief.intent.legendMaskedFixes",
    alarm: true,
  },
  {
    labelKey: "brief.intent.bucketDeviations",
    definitionKey: "brief.intent.legendDeviations",
    alarm: true,
  },
  {
    labelKey: "brief.intent.bucketStatedButMissing",
    definitionKey: "brief.intent.legendStatedButMissing",
    alarm: false,
  },
  {
    labelKey: "brief.intent.bucketDoneButUnstated",
    definitionKey: "brief.intent.legendDoneButUnstated",
    alarm: false,
  },
];
