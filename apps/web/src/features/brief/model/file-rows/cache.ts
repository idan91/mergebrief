import type { DiffLine } from "@web/utils/diffTokens/types";
import {
  parseUnifiedDiffPatch,
  sliceChunkDiff,
  type ChunkRanges,
} from "brief-core/chunk-layout";

import type { BriefChunk, UnattributedFile } from "../types";
import type { BriefViewModel } from "../utils/view-model";

/**
 * A PR's per-file patches, parsed into rows on first read and kept for the
 * page's life. Chunk slicing and hunk-edge expansion both read a file's
 * rows, so one parse serves both.
 */
export interface FileRowsCache {
  isEmpty: boolean;
  getFileRows(path: string): DiffLine[] | undefined;
  /**
   * The chunk with its rows sliced from its file on first read, the same
   * object on every call. A chunk whose rows are already lazy (attached, or
   * forwarded from its remainder entry), or whose file the diff lacks, comes
   * back as itself.
   */
  attachChunkRows(chunk: BriefChunk): BriefChunk;
  /** The same for an unattributed remainder entry. */
  attachEntryRows(entry: UnattributedFile): UnattributedFile;
}

interface SliceableEntry extends ChunkRanges {
  file: string;
  diff?: DiffLine[];
}

/**
 * The entry with its `diff` sliced on first read and kept: a 3000-file brief
 * holds thousands of chunks and the page draws a few dozen, so neither the
 * parse nor the slice runs for a card nobody reads. A write replaces the
 * slice, as the remainder's own rows do.
 */
function attachLazySlice<Entry extends SliceableEntry>(
  entry: Entry,
  readFileRows: () => readonly DiffLine[],
): Entry {
  const lazy: Entry = { ...entry };
  let sliced: DiffLine[] | undefined;
  Object.defineProperty(lazy, "diff", {
    enumerable: true,
    configurable: true,
    get: () => {
      sliced ??= sliceChunkDiff(readFileRows(), entry);
      return sliced;
    },
    set: (next: DiffLine[] | undefined) => {
      sliced = next;
    },
  });
  return lazy;
}

function createRowsAttacher<Entry extends SliceableEntry>(
  patches: ReadonlyMap<string, string>,
  getFileRows: (path: string) => DiffLine[] | undefined,
): (entry: Entry) => Entry {
  const attached = new WeakMap<Entry, Entry>();

  return (entry) => {
    const ownRows = Object.getOwnPropertyDescriptor(entry, "diff");
    const rowsAreLazy = ownRows !== undefined && !("value" in ownRows);
    if (rowsAreLazy || !patches.has(entry.file)) {
      return entry;
    }
    const known = attached.get(entry);
    if (known !== undefined) {
      return known;
    }

    const lazy = attachLazySlice(entry, () => getFileRows(entry.file) ?? []);
    attached.set(entry, lazy);
    return lazy;
  };
}

/** The chunks with their rows attached; the same array while no diff has landed. */
export function attachChunkListRows(
  chunks: BriefChunk[],
  fileRows: FileRowsCache | undefined,
): BriefChunk[];
export function attachChunkListRows(
  chunks: readonly BriefChunk[],
  fileRows: FileRowsCache | undefined,
): readonly BriefChunk[];
export function attachChunkListRows(
  chunks: readonly BriefChunk[],
  fileRows: FileRowsCache | undefined,
): readonly BriefChunk[] {
  if (fileRows === undefined) {
    return chunks;
  }
  return chunks.map((chunk) => fileRows.attachChunkRows(chunk));
}

/**
 * The model with every group's chunks carrying their rows, for a reader that
 * resolves lines across the whole brief; the same model while no diff has
 * landed.
 */
export function attachModelRows(
  model: BriefViewModel,
  fileRows: FileRowsCache | undefined,
): BriefViewModel {
  if (fileRows === undefined) {
    return model;
  }
  const groups = model.groups.map((group) => ({
    ...group,
    chunks: attachChunkListRows(group.chunks, fileRows),
  }));
  return { ...model, groups };
}

export function createFileRowsCache(
  patches: ReadonlyMap<string, string>,
): FileRowsCache {
  const parsed = new Map<string, DiffLine[]>();

  function getFileRows(path: string): DiffLine[] | undefined {
    const known = parsed.get(path);
    if (known !== undefined) {
      return known;
    }
    const patch = patches.get(path);
    if (patch === undefined) {
      return undefined;
    }

    const rows = parseUnifiedDiffPatch(patch);
    parsed.set(path, rows);
    return rows;
  }

  return {
    isEmpty: patches.size === 0,
    getFileRows,
    attachChunkRows: createRowsAttacher<BriefChunk>(patches, getFileRows),
    attachEntryRows: createRowsAttacher<UnattributedFile>(patches, getFileRows),
  };
}
