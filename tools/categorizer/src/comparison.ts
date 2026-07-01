/**
 * Comparison marks (ADR 0021 generalized by ADR 0024): the **mechanical**
 * baseline→head changed-line ranges per file, parsed straight from a unified
 * diff — no model call. Generalizes `RevisionChanges` (always
 * `baselineLabel: "previous-brief"`) to also cover the per-reviewer
 * `checkpoint→head` span, keyed by `(baselineSha, headSha)`, so FE line
 * highlighting and generated narrative-selection share one artifact shape
 * across both comparison baselines. Line-range parsing itself is unchanged —
 * this module wraps `revchanges.ts`'s mechanical parser rather than
 * duplicating it.
 */
import { parseChangedRanges, type RevisionChangeFile } from "./revchanges.js";

/** Which comparison baseline these marks are relative to. */
export type ComparisonBaselineLabel = "previous-brief" | "checkpoint";

/** Per-file marks — structurally identical to a `RevisionChangeFile`. */
export type ComparisonMarksFile = RevisionChangeFile;

export interface ComparisonMarks {
  baselineSha: string;
  headSha: string;
  baselineLabel: ComparisonBaselineLabel;
  /** Brief index of the baseline SHA; null when the baseline was never briefed
   * (e.g. a checkpoint that predates the first brief). */
  baselineIndex: number | null;
  files: ComparisonMarksFile[];
}

export function buildComparisonMarks(
  headSha: string,
  baselineSha: string,
  baselineLabel: ComparisonBaselineLabel,
  baselineIndex: number | null,
  diff: string,
): ComparisonMarks {
  return {
    baselineSha,
    headSha,
    baselineLabel,
    baselineIndex,
    files: parseChangedRanges(diff),
  };
}
