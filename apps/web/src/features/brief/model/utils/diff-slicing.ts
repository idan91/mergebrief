import { sliceChunkDiff } from "brief-core/chunk-layout";
import { type DiffLine, DiffRowOrigins } from "@web/utils/diffTokens/types";
import type { Brief } from "../types";
import type { FileRowsCache } from "../file-rows/cache";

/**
 * The brief with each chunk's rows sliced from its file. Pure: a brief whose
 * files the cache does not hold comes back as the same object.
 */
export function attachSlicedDiffs(
  brief: Brief,
  fileRows: FileRowsCache,
): Brief {
  if (fileRows.isEmpty) {
    return brief;
  }

  const withDiffs: Brief = {
    ...brief,
    chunks: brief.chunks.map((chunk) => {
      const rows = fileRows.getFileRows(chunk.file);
      if (rows === undefined) {
        return chunk;
      }
      return { ...chunk, diff: sliceChunkDiff(rows, chunk) };
    }),
  };

  if (brief.unattributed !== undefined) {
    withDiffs.unattributed = brief.unattributed.map((entry) => {
      const rows = fileRows.getFileRows(entry.file);
      if (rows === undefined) {
        return entry;
      }
      return { ...entry, diff: sliceChunkDiff(rows, entry) };
    });
  }

  return withDiffs;
}

/**
 * The delta with every chunk's and remainder entry's rows sliced from the
 * span diff, baseline to head, and tagged as guest rows: a guest row's new
 * line is head's and its old line is the baseline's, so a del row has no
 * line at head and the guest resolver refuses a comment on it. Pure: a
 * delta whose files the cache does not hold comes back as the same object.
 */
export function attachSpanDiffs(delta: Brief, spanRows: FileRowsCache): Brief {
  const attached = attachSlicedDiffs(delta, spanRows);
  if (attached === delta) {
    return delta;
  }

  const asGuest: Brief = {
    ...attached,
    chunks: attached.chunks.map(tagGuestRows),
  };
  if (attached.unattributed !== undefined) {
    asGuest.unattributed = attached.unattributed.map(tagGuestRows);
  }

  return asGuest;
}

function tagGuestRows<Entry extends { diff?: DiffLine[] }>(
  entry: Entry,
): Entry {
  if (entry.diff === undefined) {
    return entry;
  }

  return { ...entry, diff: entry.diff.map(toGuestRow) };
}

function toGuestRow(row: DiffLine): DiffLine {
  return { ...row, origin: DiffRowOrigins.GUEST };
}
