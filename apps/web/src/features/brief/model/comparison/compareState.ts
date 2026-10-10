import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import { CompareParams, type CompareParam } from "./types";

/**
 * @description The **View** control: `full` renders the whole Brief; `changes`
 * renders only the selected comparison span, the "Full Brief vs Changes
 * Only" axis.
 */
export type ViewParam = "full" | "changes";

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
  /** Rows unified or paired per hunk; absent means the viewer's default. */
  diff?: DiffView;
  /** Focus mode is on; absent means the page reads in full. */
  focus?: true;
}

/** The search params the Brief screen reads and writes on every route. */
export interface BriefAddressSearch extends BriefSearchParams {
  /** A chunk, or lines inside one, to land on; the screen parses it. */
  l?: string;
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

export function parseDiffParam(value: unknown): DiffView | undefined {
  return value === DiffViews.UNIFIED || value === DiffViews.SPLIT
    ? value
    : undefined;
}

export function parseFocusParam(value: unknown): true | undefined {
  return value === true || value === "true" ? true : undefined;
}

/** Only a present param lands as a key; absent stays absent, never `undefined`. */
export function buildBriefSearchParams(
  view: ViewParam | undefined,
  compare: CompareParam | undefined,
  diff?: DiffView,
  focus?: true,
): BriefSearchParams {
  const search: BriefSearchParams = {};

  if (view !== undefined) {
    search.view = view;
  }
  if (compare !== undefined) {
    search.compare = compare;
  }
  if (diff !== undefined) {
    search.diff = diff;
  }
  if (focus !== undefined) {
    search.focus = focus;
  }

  return search;
}

export function parseCompareParam(value: unknown): CompareParam | undefined {
  return value === CompareParams.PREVIOUS_BRIEF ||
    value === CompareParams.LAST_REVIEW ||
    value === CompareParams.OFF
    ? value
    : undefined;
}

/**
 * The screen's search vocabulary. Unrecognized or absent keys are omitted,
 * not defaulted, so the page can tell "nothing chosen yet" from a choice.
 */
export function parseBriefAddressSearch(
  search: Record<string, unknown>,
): BriefAddressSearch {
  const link = search["l"];
  const parsed: BriefAddressSearch = buildBriefSearchParams(
    parseViewParam(search["view"]),
    parseCompareParam(search["compare"]),
    parseDiffParam(search["diff"]),
    parseFocusParam(search["focus"]),
  );

  if (typeof link === "string" && link.length > 0) {
    parsed.l = link;
  }

  return parsed;
}

/**
 * Last-review marks take precedence even when their Delta narrative failed.
 * Falling back to Previous Brief would silently change the selected baseline.
 */
export function defaultComparison(
  availability: CompareOptionFlags,
): CompareParam {
  if (availability.lastReview) {
    return CompareParams.LAST_REVIEW;
  }
  if (availability.previousBrief) {
    return CompareParams.PREVIOUS_BRIEF;
  }
  return CompareParams.OFF;
}

function isAvailable(
  compare: CompareParam,
  availability: CompareOptionFlags,
): boolean {
  if (compare === CompareParams.OFF) {
    return true;
  }
  if (compare === CompareParams.PREVIOUS_BRIEF) {
    return availability.previousBrief;
  }
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
    : CompareParams.OFF;

  if (search.view === "full") {
    return { view: "full", compare };
  }

  const activeCompare =
    compare === CompareParams.OFF ? defaultComparison(availability) : compare;
  if (activeCompare === CompareParams.OFF) {
    return { view: "full", compare: CompareParams.OFF };
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
      ? { view: "changes", compare: CompareParams.LAST_REVIEW }
      : { view: "full", compare: CompareParams.OFF };
  }
  return normalizeBriefSearch(
    {
      view: params.view ?? "full",
      compare: params.compare ?? CompareParams.OFF,
    },
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
  compare: Exclude<CompareParam, typeof CompareParams.OFF>,
): string {
  return t(
    compare === CompareParams.PREVIOUS_BRIEF
      ? PREVIOUS_BRIEF_UNAVAILABLE_TITLE_KEY
      : LAST_REVIEW_UNAVAILABLE_TITLE_KEY,
  );
}

const LAST_REVIEW_FLIPS: readonly boolean[] = [false, true];

function resolvesLike(
  candidate: BriefSearchParams,
  params: BriefSearchParams,
  availability: CompareOptionFlags,
): boolean {
  const resolved = resolveBriefSearch(candidate, availability);
  const target = resolveBriefSearch(params, availability);
  return resolved.view === target.view && resolved.compare === target.compare;
}

function resolvesStably(
  candidate: BriefSearchParams,
  params: BriefSearchParams,
  availability: CompareOptionFlags,
): boolean {
  return LAST_REVIEW_FLIPS.every((lastReview) =>
    resolvesLike(candidate, params, { ...availability, lastReview }),
  );
}

/**
 * A default leaves a shared URL only when the rest still resolves to the
 * same state whether or not the last-review comparison is available: that
 * availability arrives on a poll and differs per revision. In practice
 * `view=full` leaves and `compare=off` stays, since a bare URL follows the
 * last review. `diff` leaves when it names the viewer's stored preference.
 */
export function stripDefaultSearch(
  params: BriefSearchParams,
  availability: CompareOptionFlags,
  storedDiff: DiffView,
): BriefSearchParams {
  const viewDroppable = params.view === "full";
  const compareDroppable = params.compare === CompareParams.OFF;
  const kept: BriefSearchParams = {};

  if (params.view !== undefined) {
    kept.view = params.view;
  }
  if (params.compare !== undefined) {
    kept.compare = params.compare;
  }

  const candidates: BriefSearchParams[] = [];
  if (viewDroppable && compareDroppable) {
    candidates.push({});
  }
  if (viewDroppable) {
    candidates.push(dropView(kept));
  }
  if (compareDroppable) {
    candidates.push(dropCompare(kept));
  }
  const stripped =
    candidates.find((candidate) =>
      resolvesStably(candidate, params, availability),
    ) ?? kept;

  if (params.diff !== undefined && params.diff !== storedDiff) {
    stripped.diff = params.diff;
  }

  return stripped;
}

function dropView(params: BriefSearchParams): BriefSearchParams {
  const rest: BriefSearchParams = {};
  if (params.compare !== undefined) {
    rest.compare = params.compare;
  }
  return rest;
}

function dropCompare(params: BriefSearchParams): BriefSearchParams {
  const rest: BriefSearchParams = {};
  if (params.view !== undefined) {
    rest.view = params.view;
  }
  return rest;
}
