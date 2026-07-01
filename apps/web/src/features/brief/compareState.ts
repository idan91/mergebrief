import type { BriefTimelinePoint } from "./timeline";

/**
 * @description The **View** control (ADR 0024 plan step 6): `full` renders the
 * whole Brief; `changes` renders only the selected comparison span. Deliberately
 * distinct from the pre-existing `ViewMode` (Story/Concerns display density) —
 * this is the "Full Brief vs Changes Only" axis the plan introduces.
 */
export type ViewParam = "full" | "changes";

/**
 * @description The **Compare** control (ADR 0024 plan step 6). Canonical
 * values match the marks artifact's `baselineLabel` for `previous-brief`;
 * `last-review` is the user-facing name for the `checkpoint` baseline.
 */
export type CompareParam = "previous-brief" | "last-review" | "off";

export interface BriefSearch {
  view: ViewParam;
  compare: CompareParam;
}

/**
 * @description Raw View/Compare search params as parsed from the URL —
 * `undefined` means the key was absent (or held an unrecognized value),
 * distinct from an explicit `off`/`full`. Only this "nothing chosen yet"
 * state triggers the product-aware fresh-arrival default (plan: session-only
 * persistence, defaults recompute per arrival).
 */
export interface BriefSearchParams {
  view?: ViewParam;
  compare?: CompareParam;
}

export interface ComparisonAvailability {
  previousBrief: boolean;
  lastReview: boolean;
}

export const PREVIOUS_BRIEF_UNAVAILABLE_TITLE =
  "No previous Brief for this revision";
export const LAST_REVIEW_UNAVAILABLE_TITLE =
  "No submitted review checkpoint yet";

export function parseViewParam(value: unknown): ViewParam | undefined {
  return value === "full" || value === "changes" ? value : undefined;
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
): ComparisonAvailability {
  return {
    previousBrief: Boolean(point?.comparisons.previousBrief),
    lastReview: Boolean(point?.comparisons.lastReview),
  };
}

/**
 * Product default comparison precedence (ADR 0024 Product Model): **Your last
 * review** wins whenever its marks exist, even if the Delta narrative failed —
 * falling back to Previous Brief would silently switch the user's baseline,
 * which is worse than a missing summary. This one rule backs both explicit
 * `changes + off` normalization and (separately) the fresh-arrival default
 * below.
 */
export function defaultComparison(
  availability: ComparisonAvailability,
): CompareParam {
  if (availability.lastReview) return "last-review";
  if (availability.previousBrief) return "previous-brief";
  return "off";
}

function isAvailable(
  compare: CompareParam,
  availability: ComparisonAvailability,
): boolean {
  if (compare === "off") return true;
  if (compare === "previous-brief") return availability.previousBrief;
  return availability.lastReview;
}

/**
 * Normalize an explicit View/Compare pair against what's actually available
 * for the selected timeline point (ADR 0024 plan step 6). Two invalid shapes
 * collapse deterministically instead of erroring, since URL state is
 * user-editable and shareable:
 *
 * - An unavailable Compare baseline can never stay selected — it falls back
 *   to `off`.
 * - `changes + off` has no product meaning: Changes Only picks the product
 *   default comparison; if none is available, Changes Only itself is
 *   unavailable and the state falls back to `full + off`.
 */
export function normalizeBriefSearch(
  search: BriefSearch,
  availability: ComparisonAvailability,
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
 * Resolve the raw URL params into the active, normalized View/Compare state
 * for the selected timeline point.
 *
 * - Both keys absent (fresh arrival, e.g. a brand-new deep link with no
 *   selection made yet): apply the product-aware default. Only a known
 *   personal baseline (**Your last review**) earns `Changes Only` by default
 *   for a *returning* reviewer; **Previous Brief** stays directly selectable
 *   but is never force-defaulted for a first-time reviewer on a non-first
 *   Brief (plan: "do not force it as the default").
 * - Otherwise (any explicit selection present): normalize it.
 */
export function resolveBriefSearch(
  params: BriefSearchParams,
  availability: ComparisonAvailability,
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
  availability: ComparisonAvailability,
): BriefSearch {
  return normalizeBriefSearch({ view, compare: current.compare }, availability);
}

/** Next normalized state after the user picks a Compare option. */
export function withCompare(
  current: BriefSearch,
  compare: CompareParam,
  availability: ComparisonAvailability,
): BriefSearch {
  return normalizeBriefSearch({ view: current.view, compare }, availability);
}

/** Whether a Compare option is selectable for the current availability. */
export function isCompareAvailable(
  compare: CompareParam,
  availability: ComparisonAvailability,
): boolean {
  return isAvailable(compare, availability);
}

/** Short, honest reason a Compare option is disabled — exact plan copy. */
export function compareUnavailableTitle(
  compare: "previous-brief" | "last-review",
): string {
  return compare === "previous-brief"
    ? PREVIOUS_BRIEF_UNAVAILABLE_TITLE
    : LAST_REVIEW_UNAVAILABLE_TITLE;
}
