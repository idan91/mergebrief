import type { LineRange } from "brief-core/types";
import type { ValueOf } from "types";
import type { ExpansionGap } from "brief-core/chunk-layout";
import type { DiffLine } from "@web/utils/diffTokens/types";

/**
 * What one hunk edge has expanded: the union the height model reads, the
 * ranges each click read (the query cache holds their lines) and, once a
 * read reached it, where the file ends.
 */
export interface EdgeExpansion {
  range: LineRange;
  ranges: readonly LineRange[];
  totalLines?: number;
}

/**
 * What a rendered row is to its chunk: one of the chunk's own diff rows,
 * where comments, marks and threads are keyed, or context the reader
 * expanded, which has no place in the diff.
 */
export const RowRefKinds = {
  BASE: "base",
  EXPANDED: "expanded",
} as const;
/** @public */
export type RowRefKind = ValueOf<typeof RowRefKinds>;

export interface BaseRowRef {
  kind: typeof RowRefKinds.BASE;
  /** The row's index in the chunk's `diff`. */
  baseIndex: number;
}

export interface ExpandedRowRef {
  kind: typeof RowRefKinds.EXPANDED;
}

export type RowRef = BaseRowRef | ExpandedRowRef;

export interface ResolveExpansionRangeParams {
  gap: ExpansionGap;
  /** Head-file lines this edge has already taken. */
  expanded?: LineRange;
  /** Lines the other edge of the same gap already read; this edge stops there. */
  blocked?: readonly LineRange[];
}

export const FileRangeResultKinds = {
  READY: "ready",
  TOO_LARGE: "too-large",
  NOT_TEXT: "not-text",
  NOT_FOUND: "not-found",
  UNAVAILABLE: "unavailable",
} as const;
export type FileRangeResultKind = ValueOf<typeof FileRangeResultKinds>;

/** Why an edge cannot expand; the file-range read's refusals, curated. */
export type ExpandFailure = Exclude<
  FileRangeResultKind,
  typeof FileRangeResultKinds.READY
>;

/** A file-range read that answered, its wire range taken as head-file lines. */
export interface FileRangeReady {
  kind: typeof FileRangeResultKinds.READY;
  range: LineRange;
  totalLines: number;
}

export interface FileRangeRefusal {
  kind: ExpandFailure;
}

export type FileRangeRead = FileRangeReady | FileRangeRefusal;

/** Head-file lines with their text, as a file-range read returned them. */
export interface FileRangeSlice extends LineRange {
  lines: readonly string[];
}

export interface SpliceExpandedRowsParams {
  diff: readonly DiffLine[];
  gap: ExpansionGap;
  slice: FileRangeSlice;
  /** The file's whole diff; absent falls back to the slice's lines with the edge offset. */
  fileRows?: readonly DiffLine[];
  /** The last gap line the sibling read covers; the gap closes together. */
  coveredTo?: number;
}

/** One edge's read, ready to splice. */
export interface ExpansionApplication {
  gap: ExpansionGap;
  slice: FileRangeSlice;
  fileRows?: readonly DiffLine[];
  coveredTo?: number;
}

/** A gap of the base rows and what the store holds for its edge. */
export interface StoredEdge {
  gap: ExpansionGap;
  edgeKey: string;
  expansion: EdgeExpansion;
}

/** An edge as the table renders it: placed by the spliced rows. */
export interface ExpandableEdge {
  /** The file's line count once any read on the file has reported it. */
  fileEnd?: number;
  /** Insertion index into the SPLICED rows. */
  rowIndex: number;
  /** The base-row gap the store and the read are keyed on. */
  gap: ExpansionGap;
  edgeKey: string;
  expansion: EdgeExpansion | undefined;
  /** What the other edge of the same gap already took; this edge stops there. */
  sibling?: LineRange;
}

export interface SpliceStoredEdgesParams {
  rows: readonly DiffLine[];
  edges: readonly StoredEdge[];
  lines: ReadonlyMap<number, string>;
  fileRows?: readonly DiffLine[] | undefined;
}

/** Where an expansion range's rows come from: the file's diff and the chunk's own rows. */
export interface ExpansionRowSources {
  fileRows: readonly DiffLine[];
  range: LineRange;
  /** The gap's first line: a deletion anchored just above it rides the first read. */
  gapStart: number;
  /** The chunk's own rows; a deletion they carry is never repeated. */
  base: readonly DiffLine[];
}

export interface CollectExpansionRowsParams extends ExpansionRowSources {
  slice: FileRangeSlice;
}

/** The head-file lines one click asks the file-range read for. */
export interface ExpanderStep {
  range: LineRange;
  /** The click takes the whole remainder of the gap. */
  takesAll: boolean;
}
