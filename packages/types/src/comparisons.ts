import type { ValueOf } from "./utils";

/** Which comparison baseline a mechanical marks sidecar is relative to. */
export const ComparisonBaselineLabels = {
  PREVIOUS_BRIEF: "previous-brief",
  CHECKPOINT: "checkpoint",
} as const;
export type ComparisonBaselineLabel = ValueOf<typeof ComparisonBaselineLabels>;
