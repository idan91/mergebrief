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

export const LINE_DIFF_TIMEOUT_MS = 2_000;

/** Line-diff time one span may spend in total; past it the remaining files take the fallback. */
export const SPAN_LINE_DIFF_BUDGET_MS = 5_000;

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
