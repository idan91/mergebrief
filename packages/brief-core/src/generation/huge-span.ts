import type { Result } from "types/utils";

/** One ratio gates both the delta and the revision-narrative fallback. */
export const DEFAULT_HUGE_SPAN_RATIO = 0.65;

const RATIO_OUT_OF_RANGE = "must be a number above 0 and at most 1";

export type HugeSpanRatioResult = Result<number, string>;

/** Unset and empty both mean the default: compose passes an unset variable
 * through as an empty string. */
export function parseHugeSpanRatio(
  raw: string | undefined,
): HugeSpanRatioResult {
  const unset = raw === undefined || raw.trim() === "";
  if (unset) {
    return { ok: true, value: DEFAULT_HUGE_SPAN_RATIO };
  }

  const ratio = Number(raw);
  const inRange = Number.isFinite(ratio) && ratio > 0 && ratio <= 1;
  if (!inRange) {
    return { ok: false, error: RATIO_OUT_OF_RANGE };
  }

  return { ok: true, value: ratio };
}

/** Incremental changed lines over whole-PR changed lines, at or above the
 * ratio, is too big to summarize incrementally. */
export function isHugeSpan(
  incrementalChangedLines: number,
  wholePrChangedLines: number,
  ratio: number = DEFAULT_HUGE_SPAN_RATIO,
): boolean {
  if (wholePrChangedLines <= 0) {
    return false;
  }
  return incrementalChangedLines / wholePrChangedLines >= ratio;
}
