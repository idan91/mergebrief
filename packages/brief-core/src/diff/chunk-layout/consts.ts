import { DiffLineKinds, type DiffLineKind } from "types";
import { RowRunKinds, type PatchPathLine, type RowRunKind } from "./types";

export const HUNK_HEADER =
  /^@@ -(?<oldStart>\d+)(?:,(?<oldCount>\d+))? \+(?<newStart>\d+)(?:,(?<newCount>\d+))? @@/;

export const DIFF_FILE_HEADER_LEAD = "diff --git ";

export const PRE_SIDE_PREFIX = "a/";
export const POST_SIDE_PREFIX = "b/";

/** The lines before a patch's first hunk that name the file's path at base. */
export const PRE_PATH_LINES: readonly PatchPathLine[] = [
  { lead: "rename from ", side: "" },
  { lead: "copy from ", side: "" },
  { lead: "--- ", side: PRE_SIDE_PREFIX },
];

/** The lines before a patch's first hunk that name the file's path at head. */
export const POST_PATH_LINES: readonly PatchPathLine[] = [
  { lead: "rename to ", side: "" },
  { lead: "copy to ", side: "" },
  { lead: "+++ ", side: POST_SIDE_PREFIX },
];

/** git ends a `---` or `+++` line with a TAB when its path holds a space. */
export const FILE_LINE_TRAILER = "\t";

export const HUNK_LEAD = "@@";

/** git quotes a path holding a quote, a backslash, a control or a non-ASCII character. */
export const GIT_QUOTE = '"';

/** One escape inside a git-quoted path: an octal byte or a backslashed character. */
export const GIT_ESCAPE = /\\(?:([0-3][0-7]{2})|(.))/gs;

/** The letter escapes git writes; any other backslashed character stands for itself. */
export const GIT_CHAR_ESCAPES: Readonly<Record<string, string>> = {
  a: "\u0007",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

export const OCTAL_RADIX = 8;

/** A header line holding one of these is no header: a CRLF diff stays one file, as before. */
export const LINE_TERMINATOR = /[\r\u2028\u2029]/;

/** A line or direction control: a decoded path holding one keeps git's quoted spelling, so it cannot break or reorder the line it is printed on. */
export const LINE_OR_DIRECTION_CONTROL =
  // oxlint-disable-next-line no-control-regex -- the class names the control range on purpose
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

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
