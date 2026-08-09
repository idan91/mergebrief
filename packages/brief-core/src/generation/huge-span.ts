/**
 * Huge-span fallback threshold: past a ~60-70% size heuristic, skip the
 * incremental call and fall back to the always-available full brief. One shared
 * knob for both the delta and revision-narrative fallbacks — they answer the
 * same question, and two knobs would drift.
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
