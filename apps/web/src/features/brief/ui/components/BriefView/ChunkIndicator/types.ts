export const ChunkPositionKinds = {
  /** Above the first chunk, or nothing to place the reader at. */
  OVERVIEW: "overview",
  CHUNK: "chunk",
  /** Between chunks: no chunk is current, so the indicator counts without a position. */
  BETWEEN: "between",
  /** Changes-only runs no scroll-spy, so the indicator names the scope and counts nothing. */
  CHANGES: "changes",
} as const;

export interface OverviewPosition {
  kind: typeof ChunkPositionKinds.OVERVIEW;
}

export interface ChangesPosition {
  kind: typeof ChunkPositionKinds.CHANGES;
}

export interface BetweenPosition {
  kind: typeof ChunkPositionKinds.BETWEEN;
  total: number;
}

export interface CountedPosition {
  kind: typeof ChunkPositionKinds.CHUNK;
  current: number;
  total: number;
}

export type ChunkPosition =
  | OverviewPosition
  | ChangesPosition
  | BetweenPosition
  | CountedPosition;

export interface ContentStart {
  /** The page has scrolled past where the chunks begin. */
  started: boolean;
  /** A chunk jump on a page too short to scroll counts as starting the content. */
  markJumped: () => void;
}
