import type { Result } from "types/utils";
import { countHunks, estimateTokens } from "./size";
import {
  BYTES_PER_TOKEN,
  SINGLE_CALL_MAX_HUNKS,
  SINGLE_CALL_MAX_DIFF_TOKENS,
} from "./size/consts";

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

function exceedsInputLimit(text: string): boolean {
  const tokens = estimateTokens(text, BYTES_PER_TOKEN.DIFF);
  return tokens > SINGLE_CALL_MAX_DIFF_TOKENS;
}

/**
 * A span whose one call would exceed the single-call hunk or input limit. The
 * whole request reads at the diff rate; the span diff is checked alone first
 * so an oversized span is never rendered into a prompt.
 */
export function exceedsCallLimits(
  spanDiff: string,
  renderRequest: () => string,
): boolean {
  if (countHunks(spanDiff) > SINGLE_CALL_MAX_HUNKS) {
    return true;
  }
  if (exceedsInputLimit(spanDiff)) {
    return true;
  }

  return exceedsInputLimit(renderRequest());
}
