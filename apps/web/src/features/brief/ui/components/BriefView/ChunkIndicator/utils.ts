import type { TFunction } from "i18next";

import type { ViewParam } from "../../../../model/comparison/compare-state";
import {
  CONTENT_START_ATTR,
  readNumericCssVar,
  STICKY_STACK_HEIGHT_VAR,
} from "../utils";
import { ChunkPositionKinds, type ChunkPosition } from "./types";

export interface ChunkPositionInput {
  /** The chunks on the page, in reading order; a filter shortens it. */
  chunkIds: readonly string[];
  activeChunkId: string | undefined;
  scope: ViewParam;
  /** The page has scrolled past where the chunks begin. */
  pastContentStart: boolean;
  /** No chunk is on screen, so none is current. */
  betweenChunks?: boolean;
}

/** The page has scrolled past where the chunks begin, read once. */
export function readContentStarted(): boolean {
  const sentinel = document.querySelector(`[${CONTENT_START_ATTR}]`);
  if (sentinel === null) {
    return false;
  }
  const line = readNumericCssVar(STICKY_STACK_HEIGHT_VAR);
  const pastSentinel = sentinel.getBoundingClientRect().top <= line;
  return pastSentinel || isScrolledToEnd();
}

/** A fractional scroll offset can stop the page just short of its height. */
const PAGE_END_SLACK_PX = 1;

/** The page is taller than the viewport, so a jump moves it. */
export function pageScrolls(): boolean {
  const scrollRoom = document.documentElement.scrollHeight - window.innerHeight;
  return scrollRoom > PAGE_END_SLACK_PX;
}

/** Scrolled to the page's end: as far as a short brief lets the sentinel go. */
export function isScrolledToEnd(): boolean {
  const viewportBottom = window.scrollY + window.innerHeight;
  const pageEnd = document.documentElement.scrollHeight - PAGE_END_SLACK_PX;
  const reachedEnd = window.scrollY > 0 && viewportBottom >= pageEnd;
  return reachedEnd;
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
  if (input.betweenChunks === true) {
    return { kind: ChunkPositionKinds.BETWEEN, total: input.chunkIds.length };
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
  if (position.kind === ChunkPositionKinds.BETWEEN) {
    return t("brief.mobile.chunkTotal", { count: position.total });
  }
  return t("brief.mobile.chunkPosition", {
    current: position.current,
    total: position.total,
  });
}
