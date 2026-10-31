import type { DiffLineKind, ValueOf } from "types";
import type { LineRange } from "../../types";

/** One row of a parsed unified diff, numbered on the sides it exists on. */
export interface ParsedDiffLine {
  kind: DiffLineKind;
  content: string;
  oldLine?: number;
  newLine?: number;
}

/** The two paths a `diff --git` header names, git's quoting decoded and its `a/` and `b/` dropped. */
export interface DiffHeaderPaths {
  pre: string;
  post: string;
}

/** A patch line naming one side's path after `lead`; `side` is the prefix git writes before it. */
export interface PatchPathLine {
  lead: string;
  side: string;
}

/** The changed lines a chunk claims in its file. */
export interface ChunkRanges {
  addedRanges: readonly LineRange[];
  removedRanges: readonly LineRange[];
}

/** What a file's first hunk header says about the file as a whole. */
export const FileStatuses = {
  NEW: "new",
  DELETED: "deleted",
} as const;
export type FileStatus = ValueOf<typeof FileStatuses>;

/** The changed lines a brief places in one file: an unattributed file's ranges. */
export interface FileLayoutSource extends ChunkRanges {
  file: string;
}

/** What a brief-wide count needs of a chunk: its id, its file and its ranges. */
export interface ChunkLayoutSource extends FileLayoutSource {
  id: string;
}

/** The cards a brief draws: its chunks and its unattributed remainder files. */
export interface BriefLayoutSource {
  chunks: readonly ChunkLayoutSource[];
  unattributed: readonly FileLayoutSource[];
}

export const ExpansionDirections = {
  UP: "up",
  DOWN: "down",
} as const;
export type ExpansionDirection = ValueOf<typeof ExpansionDirections>;

/**
 * Where expanded context enters a chunk's rows. A chunk's diff is SLICED, so
 * a gap is not always a hunk boundary: the edge names the insertion point in
 * the rows the chunk actually carries, which a hunk index cannot.
 */
export interface ExpansionEdge {
  /** Insertion index into the chunk's `diff`. */
  rowIndex: number;
  direction: ExpansionDirection;
}

/** One edge of one gap in a chunk's rows, in head-file line numbers. */
export interface ExpansionGap {
  edge: ExpansionEdge;
  /** First missing line, inclusive. */
  start: number;
  /** Last missing line, inclusive; absent where the gap runs to end of file. */
  end?: number;
  /** `oldLine - newLine` in force at this edge. */
  offset: number;
}

/**
 * Code rows by display width. `counts[i]` holds the rows narrower than
 * `LINE_WIDTH_BUCKET_EDGES[i]` and at least the edge before it; the last
 * entry holds every row at or past the widest edge.
 */
export interface LineWidthHistogram {
  counts: number[];
  /** Summed width of the rows in the last, open-ended bucket. */
  overflowColumns: number;
}

/** One run's kind in a chunk rowRuns: a sliced row's kind, or an expand control's own row. */
export const RowRunKinds = {
  HUNK: "h",
  CONTEXT: "c",
  ADDED: "a",
  REMOVED: "r",
  NOTE: "n",
  EXPAND: "e",
} as const;
export type RowRunKind = ValueOf<typeof RowRunKinds>;

/** Rows of one kind in a row, in the order the card draws them. */
export interface RowRun {
  kind: RowRunKind;
  length: number;
}

/** What a chunk's card draws, counted from its sliced rows. */
export interface ChunkLayoutCounts {
  /** Sliced rows, hunk headers and notes included. */
  rows: number;
  /** Hunk header rows; each one is also an expand control. */
  hunkRows: number;
  /** Expand controls drawn as a row of their own, not on a hunk header. */
  expandRows: number;
  /** Rows the split view paints: a deletion run and the additions after it pair up. */
  splitRows: number;
  lineWidths: LineWidthHistogram;
  /**
   * The rows the split view paints, by their wider side: a paired row is as
   * tall as its taller cell. Absent where no pair makes it differ from
   * `lineWidths`, which it then equals.
   */
  splitLineWidths?: LineWidthHistogram;
  /**
   * The card's rows as runs of one kind, `<kind><length>` each, with an
   * expand control's own row a run before the row it opens above: the
   * shape a skeleton draws before the code lands, and never code text.
   * The worker always stores it; counts the page estimates have none.
   */
  rowRuns?: string;
}

/**
 * The brief's counts by chunk id, and its unattributed remainder's by file
 * path: a remainder card's id is derived by the reader, its file is not.
 * An entry whose file the diff did not carry is absent.
 */
export interface ChunkLayoutBody {
  chunks: Record<string, ChunkLayoutCounts>;
  files: Record<string, ChunkLayoutCounts>;
}
