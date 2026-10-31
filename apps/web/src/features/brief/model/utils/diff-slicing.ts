import { sliceChunkDiff, type ChunkRanges } from "brief-core/chunk-layout";
import { type DiffLine, DiffRowOrigins } from "@web/utils/diffTokens/types";
import type { Brief } from "../types";
import type { FileRowsCache } from "../file-rows/cache";

interface SliceableEntry extends ChunkRanges {
  file: string;
  diff?: DiffLine[];
}

/**
 * The entry with its `diff` sliced on first read and kept: a 3000-file brief
 * holds thousands of chunks and the page draws a few dozen, so slicing every
 * one when the code lands froze the page for over a second. A write replaces
 * the slice, as the remainder's own rows do.
 */
function attachLazySlice<Entry extends SliceableEntry>(
  entry: Entry,
  rows: readonly DiffLine[],
): Entry {
  const lazy: Entry = { ...entry };
  let sliced: DiffLine[] | undefined;
  Object.defineProperty(lazy, "diff", {
    enumerable: true,
    configurable: true,
    get: () => {
      sliced ??= sliceChunkDiff(rows, entry);
      return sliced;
    },
    set: (next: DiffLine[] | undefined) => {
      sliced = next;
    },
  });
  return lazy;
}

/**
 * Gives `target` the `diff` of `source` without reading it: a remainder
 * chunk built from an unattributed entry keeps the entry's slice lazy.
 */
export function forwardDiff(
  target: { diff?: DiffLine[] },
  source: { diff?: DiffLine[] },
): void {
  Object.defineProperty(target, "diff", {
    enumerable: true,
    configurable: true,
    get: () => source.diff,
    set: (next: DiffLine[] | undefined) => {
      if (next === undefined) {
        delete source.diff;
        return;
      }
      source.diff = next;
    },
  });
}

/**
 * The brief with each chunk's rows sliced from its file, on first read.
 * Pure: a brief whose files the cache does not hold comes back as the same
 * object.
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
      return rows === undefined ? chunk : attachLazySlice(chunk, rows);
    }),
  };

  if (brief.unattributed !== undefined) {
    withDiffs.unattributed = brief.unattributed.map((entry) => {
      const rows = fileRows.getFileRows(entry.file);
      return rows === undefined ? entry : attachLazySlice(entry, rows);
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
