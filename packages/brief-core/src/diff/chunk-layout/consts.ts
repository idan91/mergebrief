import { DiffLineKinds, type DiffLineKind } from "types";
import { RowRunKinds, type RowRunKind } from "./types";

export const HUNK_HEADER =
  /^@@ -(?<oldStart>\d+)(?:,(?<oldCount>\d+))? \+(?<newStart>\d+)(?:,(?<newCount>\d+))? @@/;

export const DIFF_FILE_HEADER = /^diff --git a\/(?<pre>.+?) b\/(?<post>.+)$/;

/** Rows of surrounding diff a chunk's slice keeps on each side of a changed row. */
export const SLICE_CONTEXT_ROWS = 2;

/** Upper edges, in columns, of the line-width histogram's closed buckets. */
export const LINE_WIDTH_BUCKET_EDGES = [
  40, 80, 120, 160, 200, 240, 320, 480,
] as const;

/** The code cell sets no `tab-size`, so a tab advances to the browser's default stop. */
export const TAB_STOP_COLUMNS = 8;

/** A chunk's whole `rowRuns`: runs of a kind letter and a length of at least one. */
export const CHUNK_ROW_RUNS = /^(?:[hcarne][1-9]\d*)*$/;

/** One of a chunk's row runs, read in order. */
export const ROW_RUN = /(?<kind>[hcarne])(?<length>\d+)/g;

/** The row run each sliced row's kind draws as. */
export const ROW_RUN_KIND_BY_LINE_KIND: Readonly<
  Record<DiffLineKind, RowRunKind>
> = {
  [DiffLineKinds.HUNK]: RowRunKinds.HUNK,
  [DiffLineKinds.CTX]: RowRunKinds.CONTEXT,
  [DiffLineKinds.ADD]: RowRunKinds.ADDED,
  [DiffLineKinds.DEL]: RowRunKinds.REMOVED,
  [DiffLineKinds.NOTE]: RowRunKinds.NOTE,
};
