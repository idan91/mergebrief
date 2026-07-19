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
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileDiff } from "./diff";
import {
  changedRangesFromFileDiffs,
  parseChangedRanges,
  type RevisionChangeFile,
} from "./revchanges";

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

/**
 * Build marks from a raw unified diff, or from per-file patches a caller has
 * already split with `splitDiffByFile` for another sidecar — so the same diff
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
    files: typeof diff === "string" ? parseChangedRanges(diff) : changedRangesFromFileDiffs(diff),
  };
}

/**
 * Marks sidecar filename (ADR 0024):
 * `<stem>_<baselineLabel>_<base8>-<head8>.comparison.json`. Span-keyed AND
 * label-keyed: a checkpoint that coincides with prevHead (the common
 * re-review case) must not clobber the previous-brief marks' metadata —
 * the FE discriminates on `baselineLabel`/`baselineIndex`. No ".." (hostile
 * to globbing); "-" separates the span SHAs instead. `revChangesName`
 * (output.ts) remains a back-compat alias for `previous-brief` spans only.
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
 * Write the marks sidecar for one `(baselineSha, headSha)` span under
 * `outDir` — the single writer behind the marks-emission rule (ADR 0024:
 * whoever fetches a compare diff for a baseline writes the marks sidecar).
 * Shared by the main generation path (`previous-brief`), `delta-cli`
 * (`checkpoint`), and, later, production Checkpoint pre-warming. Callers
 * never catch failures: a marks failure means comparison data is unavailable
 * and must surface loudly. Returns the written path.
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
    marks.baselineLabel === "previous-brief" && marks.baselineIndex != null
      ? `_${marks.baselineIndex}`
      : marks.baselineLabel;
  log(`wrote ${file} (${marks.files.length} files changed since ${baseline})`);
  return file;
}
