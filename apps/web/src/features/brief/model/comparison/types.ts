import type { StoredRevisionNarrative } from "brief-core/artifact";
import type { ValueOf } from "types/utils";

import type { Brief, ComparisonMarks } from "../types";
import type { ComparisonQuery } from "./comparison-query";

/**
 * @description The **Compare** control. Canonical values match the marks artifact's `baselineLabel` for `previous-brief`;
 * `last-review` is the user-facing name for the `checkpoint` baseline.
 */
export const CompareParams = {
  PREVIOUS_BRIEF: "previous-brief",
  LAST_REVIEW: "last-review",
  OFF: "off",
} as const;
export type CompareParam = ValueOf<typeof CompareParams>;

/**
 * Where the screen's comparison data comes from: each route supplies one.
 * Availability is slot presence; marks, narrative and delta fetch through
 * the slot descriptors. Absent offers no baseline.
 */
export interface BriefComparisonPlan {
  readonly previousBrief?: {
    readonly marks: ComparisonQuery<ComparisonMarks>;
    /** Present when a narrative artifact exists to fetch (may be a skip stub). */
    readonly narrative?: ComparisonQuery<StoredRevisionNarrative>;
    /** Live raw span diff baseline → head (Changes Only "Show raw diff"). */
    readonly rawDiff?: ComparisonQuery<string>;
  };
  /** The personal checkpoint comparison, offered iff marks exist. */
  readonly lastReview?: {
    readonly marks: ComparisonQuery<ComparisonMarks>;
    /** Absent = marks-only tier: the worker skipped the delta core. */
    readonly delta?: ComparisonQuery<Brief>;
    /** The span was too large to summarize, so no delta will come. */
    readonly deltaSkipped?: true;
    /** Live raw span diff checkpoint → head. */
    readonly rawDiff?: ComparisonQuery<string>;
  };
}
