import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import type { BriefTimelinePoint } from "../utils/timeline";

/**
 * @description The **View** control: `full` renders the whole Brief; `changes`
 * renders only the selected comparison span, the "Full Brief vs Changes
 * Only" axis.
 */
export type ViewParam = "full" | "changes";

/**
 * @description The **Compare** control. Canonical values match the marks artifact's `baselineLabel` for `previous-brief`;
 * `last-review` is the user-facing name for the `checkpoint` baseline.
 */
export type CompareParam = "previous-brief" | "last-review" | "off";

export interface BriefSearch {
  view: ViewParam;
  compare: CompareParam;
}

/**
 * Absent or unrecognized URL values differ from explicit off/full selections.
 * Only absence triggers fresh-arrival defaults; selections persist for the session.
 */
export interface BriefSearchParams {
  view?: ViewParam;
  compare?: CompareParam;
}

/**
 * Selectable options derived from ComparisonAvailability artifact ids.
 */
export interface CompareOptionFlags {
  previousBrief: boolean;
  lastReview: boolean;
}

export const PREVIOUS_BRIEF_UNAVAILABLE_TITLE_KEY: TranslationKey =
  "brief.compareTitles.previousBriefUnavailable";
export const LAST_REVIEW_UNAVAILABLE_TITLE_KEY: TranslationKey =
  "brief.compareTitles.lastReviewUnavailable";
export const LAST_REVIEW_PENDING_TITLE_KEY: TranslationKey =
  "brief.compareTitles.lastReviewPending";
export const LAST_REVIEW_BASELINE_UNAVAILABLE_TITLE_KEY: TranslationKey =
  "brief.compareTitles.lastReviewBaselineUnavailable";

/**
 * Honest reason copy for a checkpoint that EXISTS but cannot be compared.
 * Distinct from `LAST_REVIEW_UNAVAILABLE_TITLE_KEY`, which covers "never
 * submitted" (the field-absent case).
 */
export function lastReviewUnavailableReasonTitle(
  t: TFunction,
  reason: "pending" | "baseline-unavailable",
): string {
  return t(
    reason === "pending"
      ? LAST_REVIEW_PENDING_TITLE_KEY
      : LAST_REVIEW_BASELINE_UNAVAILABLE_TITLE_KEY,
  );
}

export function parseViewParam(value: unknown): ViewParam | undefined {
  return value === "full" || value === "changes" ? value : undefined;
}

/** Only a present param lands as a key; absent stays absent, never `undefined`. */
export function buildBriefSearchParams(
  view: ViewParam | undefined,
  compare: CompareParam | undefined,
): BriefSearchParams {
  const search: BriefSearchParams = {};

  if (view !== undefined) search.view = view;
  if (compare !== undefined) search.compare = compare;

  return search;
}

export function parseCompareParam(value: unknown): CompareParam | undefined {
  return value === "previous-brief" ||
    value === "last-review" ||
    value === "off"
    ? value
    : undefined;
}

/** Comparison availability for a timeline point's Compare control. */
export function comparisonAvailability(
  point: BriefTimelinePoint | undefined,
): CompareOptionFlags {
  return {
    previousBrief: Boolean(point?.comparisons.previousBrief),
    lastReview: Boolean(point?.comparisons.lastReview),
  };
}

/**
 * Last-review marks take precedence even when their Delta narrative failed.
 * Falling back to Previous Brief would silently change the selected baseline.
 */
export function defaultComparison(
  availability: CompareOptionFlags,
): CompareParam {
  if (availability.lastReview) return "last-review";
  if (availability.previousBrief) return "previous-brief";
  return "off";
}

function isAvailable(
  compare: CompareParam,
  availability: CompareOptionFlags,
): boolean {
  if (compare === "off") return true;
  if (compare === "previous-brief") return availability.previousBrief;
  return availability.lastReview;
}

/**
 * User-editable URLs may name unavailable comparisons; normalize them to off.
 * Changes Only requires a comparison, falling back to full + off if none exists.
 */
export function normalizeBriefSearch(
  search: BriefSearch,
  availability: CompareOptionFlags,
): BriefSearch {
  const compare = isAvailable(search.compare, availability)
    ? search.compare
    : "off";

  if (search.view === "full") {
    return { view: "full", compare };
  }

  const activeCompare =
    compare === "off" ? defaultComparison(availability) : compare;
  if (activeCompare === "off") {
    return { view: "full", compare: "off" };
  }
  return { view: "changes", compare: activeCompare };
}

/**
 * Only a known personal baseline defaults returning reviewers to Changes Only.
 * Previous Brief remains selectable but never forces that fresh-arrival default.
 * Any explicit selection is normalized instead.
 */
export function resolveBriefSearch(
  params: BriefSearchParams,
  availability: CompareOptionFlags,
): BriefSearch {
  if (params.view === undefined && params.compare === undefined) {
    return availability.lastReview
      ? { view: "changes", compare: "last-review" }
      : { view: "full", compare: "off" };
  }
  return normalizeBriefSearch(
    { view: params.view ?? "full", compare: params.compare ?? "off" },
    availability,
  );
}

/** Next normalized state after the user picks a View, from the current state. */
export function withView(
  current: BriefSearch,
  view: ViewParam,
  availability: CompareOptionFlags,
): BriefSearch {
  return normalizeBriefSearch({ view, compare: current.compare }, availability);
}

/** Next normalized state after the user picks a Compare option. */
export function withCompare(
  current: BriefSearch,
  compare: CompareParam,
  availability: CompareOptionFlags,
): BriefSearch {
  return normalizeBriefSearch({ view: current.view, compare }, availability);
}

/** Whether a Compare option is selectable for the current availability. */
export function isCompareAvailable(
  compare: CompareParam,
  availability: CompareOptionFlags,
): boolean {
  return isAvailable(compare, availability);
}

/** Short, honest reason a Compare option is disabled. */
export function compareUnavailableTitle(
  t: TFunction,
  compare: "previous-brief" | "last-review",
): string {
  return t(
    compare === "previous-brief"
      ? PREVIOUS_BRIEF_UNAVAILABLE_TITLE_KEY
      : LAST_REVIEW_UNAVAILABLE_TITLE_KEY,
  );
}
