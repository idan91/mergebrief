import { createContext, useContext, type ReactNode } from "react";

import {
  LINE_WIDTH_BUCKET_EDGES,
  SLICE_CONTEXT_ROWS,
  type ChunkLayoutBody,
  type ChunkLayoutCounts,
} from "brief-core/chunk-layout";
import type { BriefChunk } from "../types";
import { isUnattributedRemainderChunk } from "../utils/remainder";

/**
 * The stored counts by chunk id, and the Unattributed remainder's by file:
 * a remainder card's id is derived on this page, its file is not.
 */
export interface StoredChunkCounts {
  readonly chunks: ReadonlyMap<string, ChunkLayoutCounts>;
  readonly files: ReadonlyMap<string, ChunkLayoutCounts>;
}

/**
 * What the page knows about a card's size before its code lands: the
 * worker's stored counts, and whether the code is still on its way. A brief
 * without stored counts renders from the page's own estimate.
 */
export interface ChunkLayoutState {
  readonly counts: StoredChunkCounts | undefined;
  /** True while the diff request is in flight; false once it landed or failed. */
  readonly codePending: boolean;
}

const ChunkLayoutContext = createContext<ChunkLayoutState | undefined>(
  undefined,
);

export interface ChunkLayoutProviderProps {
  state: ChunkLayoutState | undefined;
  children: ReactNode;
}

export function ChunkLayoutProvider({
  state,
  children,
}: ChunkLayoutProviderProps) {
  return (
    <ChunkLayoutContext.Provider value={state}>
      {children}
    </ChunkLayoutContext.Provider>
  );
}

/** Undefined outside a provider: the local path reads a file-backed diff with the brief. */
export function useChunkLayout(): ChunkLayoutState | undefined {
  return useContext(ChunkLayoutContext);
}

export function buildChunkLayoutCounts(
  body: ChunkLayoutBody | undefined,
): StoredChunkCounts | undefined {
  if (body === undefined) {
    return undefined;
  }
  return {
    chunks: new Map(Object.entries(body.chunks)),
    files: new Map(Object.entries(body.files)),
  };
}

/** A card's stored counts: a remainder card's by its file, any other's by its id. */
export function readStoredCounts(
  counts: StoredChunkCounts | undefined,
  chunk: BriefChunk,
): ChunkLayoutCounts | undefined {
  if (counts === undefined) {
    return undefined;
  }
  if (isUnattributedRemainderChunk(chunk)) {
    return counts.files.get(chunk.file);
  }
  return counts.chunks.get(chunk.id);
}

/**
 * The counts a card reserves its height from while its code is pending: the
 * stored ones, else an estimate from the chunk's own line counts and ranges.
 */
export function readReservedCounts(
  layout: ChunkLayoutState | undefined,
  chunk: BriefChunk,
): ChunkLayoutCounts | undefined {
  if (layout === undefined || !layout.codePending) {
    return undefined;
  }
  return readStoredCounts(layout.counts, chunk) ?? estimateRangeCounts(chunk);
}

/** What a card is sized from: its stored counts, else its pending reservation. */
export function readCardCounts(
  layout: ChunkLayoutState | undefined,
  chunk: BriefChunk,
): ChunkLayoutCounts | undefined {
  return (
    readStoredCounts(layout?.counts, chunk) ?? readReservedCounts(layout, chunk)
  );
}

/**
 * The slice a chunk's ranges imply, a lower bound: one hunk per range on the
 * busier side, its header and context around the changed lines, a deletion
 * paired with an addition in the split view, and no line long enough to wrap.
 */
function estimateRangeCounts(chunk: BriefChunk): ChunkLayoutCounts {
  const changedRows = chunk.loc.added + chunk.loc.deleted;
  const rangeCount = Math.max(
    chunk.addedRanges.length,
    chunk.removedRanges.length,
  );
  const hunkRows = changedRows === 0 ? 0 : Math.max(rangeCount, 1);
  const codeRows = changedRows + hunkRows * SLICE_CONTEXT_ROWS * 2;
  const rows = codeRows + hunkRows;
  const widthCounts = Array.from(
    { length: LINE_WIDTH_BUCKET_EDGES.length + 1 },
    () => 0,
  );
  widthCounts[0] = codeRows;

  return {
    rows,
    hunkRows,
    expandRows: 0,
    splitRows: rows - Math.min(chunk.loc.added, chunk.loc.deleted),
    lineWidths: { counts: widthCounts, overflowColumns: 0 },
  };
}
