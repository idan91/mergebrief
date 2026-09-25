/**
 * Comparison marks: the mechanical baseline→head changed-line ranges per file,
 * parsed straight from a unified diff, with no model call. Covers both the
 * previous-brief and the per-reviewer checkpoint span, keyed by
 * `(baselineSha, headSha)`, so both baselines share one artifact shape. Wraps
 * `revchanges.ts`'s parser rather than duplicating it.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileDiff } from "./file-diff";
import {
  changedRangesFromFileDiffs,
  parseChangedRanges,
  type RevisionChangeFile,
} from "./revchanges";

/** Which comparison baseline these marks are relative to. */
export type ComparisonBaselineLabel = "previous-brief" | "checkpoint";

/** Per-file marks, structurally identical to a `RevisionChangeFile`. */
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

/**
 * Build marks from a raw unified diff, or from per-file patches a caller has
 * already split with `splitDiffByFile` for another sidecar, so the same diff
 * text is never scanned twice.
 */
export function buildComparisonMarks(
  headSha: string,
  baselineSha: string,
  baselineLabel: ComparisonBaselineLabel,
  baselineIndex: number | null,
  diff: string | FileDiff[],
): ComparisonMarks {
  return {
    baselineSha,
    headSha,
    baselineLabel,
    baselineIndex,
    files:
      typeof diff === "string"
        ? parseChangedRanges(diff)
        : changedRangesFromFileDiffs(diff),
  };
}

/**
 * Marks sidecar filename: `<stem>_<baselineLabel>_<base8>-<head8>.comparison.json`.
 * Span-keyed AND label-keyed so a checkpoint coinciding with prevHead cannot
 * clobber the previous-brief marks. No "..", which is hostile to globbing.
 */
export function comparisonMarksName(
  stem: string,
  marks: Pick<ComparisonMarks, "baselineSha" | "headSha" | "baselineLabel">,
): string {
  const base8 = marks.baselineSha.slice(0, 8);
  const head8 = marks.headSha.slice(0, 8);
  return `${stem}_${marks.baselineLabel}_${base8}-${head8}.comparison.json`;
}

/**
 * Write the marks sidecar for one `(baselineSha, headSha)` span under `outDir`.
 * The single writer for the rule that whoever fetches a compare diff writes the
 * marks. Callers never catch failures: a marks failure means comparison data is
 * unavailable and must surface loudly. Returns the written path.
 */
export async function writeComparisonMarks(
  outDir: string,
  stem: string,
  marks: ComparisonMarks,
  log: (msg: string) => void,
): Promise<string> {
  const file = join(outDir, comparisonMarksName(stem, marks));
  await writeFile(file, `${JSON.stringify(marks, null, 2)}\n`);
  const baseline =
    marks.baselineLabel === "previous-brief" && marks.baselineIndex !== null
      ? `_${marks.baselineIndex}`
      : marks.baselineLabel;
  log(`wrote ${file} (${marks.files.length} files changed since ${baseline})`);
  return file;
}
