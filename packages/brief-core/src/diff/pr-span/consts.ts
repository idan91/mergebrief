import type { HunkSpan } from "../remap";

/** GitHub's compare diff stops at 300 files; past it the span cannot be whole. */
export const MAX_SPAN_CHANGED_FILES = 300;

/** An unconfirmed base-rename candidate splits into two changed files. */
export const FILES_PER_BASE_RENAME_CANDIDATE = 2;

/** A blob past this size takes the patch-level fallback instead of a line diff. */
export const MAX_LINE_DIFF_BYTES = 1_000_000;

/** The most UTF-8 bytes one UTF-16 code unit encodes to. */
export const UTF8_BYTES_PER_UNIT = 3;

export const LINE_DIFF_MAX_EDIT_LENGTH = 20_000;

/** A crash-only stop: the work bound caps a file's diff far below it on any working host, so machine speed never picks the text. */
export const LINE_DIFF_TIMEOUT_MS = 30_000;

/** Blob lines, both heads summed, one span may line-diff in path order: caps the passes no work charge covers, about 0.5 s of CPU at the bound. */
export const SPAN_LINE_DIFF_MAX_LINES = 1_000_000;

/** Weighted UTF-16 units, both heads summed, one span may read for line diffs in path order: caps every pass over the text and the text held. */
export const SPAN_LINE_DIFF_MAX_CHARS = 40_000_000;

/** V8 holds text with a unit above U+00FF two bytes a unit, and jsdiff compares it up to this many times slower. */
export const WIDE_TEXT_CHAR_WEIGHT = 5;

export const WIDE_TEXT_UNIT = /[\u0100-\uffff]/;

/** jsdiff spends as long comparing one line as comparing about this many characters of it. */
export const LINE_DIFF_CHARS_PER_LINE = 1_000;

/**
 * Compare cost, weighted characters plus `LINE_DIFF_CHARS_PER_LINE` per line,
 * times edit length one span may spend in line diffs. The charge is jsdiff's
 * worst case, so the worst shapes spend about 0.024 ns of CPU a unit: about
 * 1.2 s for the whole bound, far short of `LINE_DIFF_TIMEOUT_MS`.
 */
export const SPAN_LINE_DIFF_MAX_WORK = 50_000_000_000;

/** The share of the work left one file's diff may spend, so a file that passes it leaves the rest for later files. */
export const LINE_DIFF_MAX_WORK_SHARE = 0.5;

export const LINE_DIFF_CONTEXT_LINES = 3;

/** Blob reads in flight at once. */
export const BLOB_READ_CONCURRENCY = 8;

/** The trailing stretch's window: every line below the last run demotes. */
export const REST_OF_FILE_LINES = Number.MAX_SAFE_INTEGER;

/** A span that moves nothing and overlaps no range: a hop entry saying the file is unchanged. */
export const IDENTITY_SPAN: HunkSpan = {
  oldStart: 0,
  oldLines: 0,
  newStart: 0,
  newLines: 0,
};

export const INDEX_LINE = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$/;

export const MODE_LINES = /^(?:new mode|new file mode) (\d+)$/;

export const NEW_FILE_LINE = /^new file mode \d+$/;

export const DELETED_FILE_LINE = /^deleted file mode \d+$/;

export const BINARY_LINES = /^(?:Binary files |GIT binary patch)/;

export const NO_NEWLINE_MARKER = "\\";
