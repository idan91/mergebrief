/**
 * Huge-span fallback threshold (ADR 0006 #7: "past a tunable ~60-70% size
 * heuristic, skip the [incremental] call and default to the always-available
 * full Brief"). ADR 0024 reuses the same knob for the Revision-narrative
 * fallback rather than introducing a second one — "both fallbacks answer 'is
 * this span too big to summarize incrementally?'; two knobs invite
 * unprincipled drift."
 *
 * DEVIATION FROM PLAN (flagged for the handoff): no such threshold existed in
 * code before this change — ADR 0006 documents the heuristic but the Delta
 * path has never implemented it. This module is the one shared knob the plan
 * asks for; it is wired into the Revision-narrative path (`index.ts`) in this
 * stage. Wiring it into `cli/delta.ts` as well is out of scope for this stage
 * (not requested by the plan's step 9 test list) and is left as follow-up.
 */
const DEFAULT_HUGE_SPAN_RATIO = 0.65;

/** Ratio (0, 1] of incremental-changed-lines / whole-PR-changed-lines at or
 * above which a span is "too big to summarize incrementally". Overridable via
 * `HUGE_SPAN_RATIO` for experimentation; falls back to the default on an
 * absent or out-of-range value. */
export function hugeSpanRatio(): number {
  const raw = process.env["HUGE_SPAN_RATIO"];
  if (raw == null) return DEFAULT_HUGE_SPAN_RATIO;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1
    ? parsed
    : DEFAULT_HUGE_SPAN_RATIO;
}

/**
 * True when the incremental span is at or past the huge-span threshold
 * relative to the whole-PR span. A whole-PR span of 0 changed lines never
 * counts as huge (there is nothing to compare against).
 */
export function isHugeSpan(
  incrementalChangedLines: number,
  wholePrChangedLines: number,
): boolean {
  if (wholePrChangedLines <= 0) return false;
  return incrementalChangedLines / wholePrChangedLines >= hugeSpanRatio();
}
