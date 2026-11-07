import type { TFunction } from "i18next";

import type { ViewParam } from "../../../../model/comparison/compare-state";
import { ChunkPositionKinds, type ChunkPosition } from "./types";

export interface ChunkPositionInput {
  /** The chunks on the page, in reading order; a filter shortens it. */
  chunkIds: readonly string[];
  activeChunkId: string | undefined;
  scope: ViewParam;
  /** The page has scrolled past where the chunks begin. */
  pastContentStart: boolean;
}

/** Where the reader is, as the indicator says it. */
export function deriveChunkPosition(input: ChunkPositionInput): ChunkPosition {
  if (!input.pastContentStart) {
    return { kind: ChunkPositionKinds.OVERVIEW };
  }
  if (input.scope === "changes") {
    return { kind: ChunkPositionKinds.CHANGES };
  }

  const index =
    input.activeChunkId === undefined
      ? -1
      : input.chunkIds.indexOf(input.activeChunkId);
  if (index === -1) {
    return { kind: ChunkPositionKinds.OVERVIEW };
  }
  return {
    kind: ChunkPositionKinds.CHUNK,
    current: index + 1,
    total: input.chunkIds.length,
  };
}

/** The indicator's text for a position. */
export function describeChunkPosition(
  t: TFunction,
  position: ChunkPosition,
): string {
  if (position.kind === ChunkPositionKinds.OVERVIEW) {
    return t("brief.mobile.overview");
  }
  if (position.kind === ChunkPositionKinds.CHANGES) {
    return t("brief.mobile.changesOnly");
  }
  return t("brief.mobile.chunkPosition", {
    current: position.current,
    total: position.total,
  });
}
