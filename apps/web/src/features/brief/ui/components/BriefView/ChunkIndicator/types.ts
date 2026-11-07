export const ChunkPositionKinds = {
  /** Above the first chunk, or nothing to place the reader at. */
  OVERVIEW: "overview",
  CHUNK: "chunk",
  /** Changes-only runs no scroll-spy, so the indicator names the scope and counts nothing. */
  CHANGES: "changes",
} as const;

export interface OverviewPosition {
  kind: typeof ChunkPositionKinds.OVERVIEW;
}

export interface ChangesPosition {
  kind: typeof ChunkPositionKinds.CHANGES;
}

export interface CountedPosition {
  kind: typeof ChunkPositionKinds.CHUNK;
  current: number;
  total: number;
}

export type ChunkPosition =
  | OverviewPosition
  | ChangesPosition
  | CountedPosition;

export interface ContentStart {
  /** The page has scrolled past where the chunks begin. */
  started: boolean;
  /** A chunk jump on a page too short to scroll counts as starting the content. */
  markJumped: () => void;
}
