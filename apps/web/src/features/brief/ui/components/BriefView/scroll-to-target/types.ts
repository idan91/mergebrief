import type { ValueOf } from "types/utils";

import type { LineTarget } from "../../../../model/utils/line-owner";
import type { ChunkWindowRegistry } from "../reading/chunk-windows";
import type { ScopeExitOptions } from "../types";
import type { ScrollMotion, ScrollPlacement } from "./engine/types";

export const ScrollTargetKinds = {
  CHUNK: "chunk",
  GROUP: "group",
  ROW: "row",
  RAIL: "rail",
  SECTION: "section",
} as const;
/** @public */
export type ScrollTargetKind = ValueOf<typeof ScrollTargetKinds>;

/** A thread's own row, addressable wherever the thread renders. */
export interface ThreadScrollTarget {
  rowId: string;
  threadId: number;
}

export type ConversationScrollTarget = ThreadScrollTarget | LineTarget;

export interface ChunkScrollTarget {
  kind: typeof ScrollTargetKinds.CHUNK;
  chunkId: string;
}

/** The group's section; focus goes to its heading. */
export interface GroupScrollTarget {
  kind: typeof ScrollTargetKinds.GROUP;
  groupId: string;
}

/**
 * A row inside the chunk's own card; focus goes to a thread's disclosure or
 * to the line's row. A row that never renders concedes to its card.
 */
export interface RowScrollTarget {
  kind: typeof ScrollTargetKinds.ROW;
  chunkId: string;
  row: ConversationScrollTarget;
}

/** A revision rail's button, the first one outside a hidden pane. */
export interface RailScrollTarget {
  kind: typeof ScrollTargetKinds.RAIL;
  chunkId: string;
  railKey: string;
}

/** A page section outside the chunk lists, by its element id. */
export interface SectionScrollTarget {
  kind: typeof ScrollTargetKinds.SECTION;
  sectionId: string;
}

export type ScrollTarget =
  | ChunkScrollTarget
  | GroupScrollTarget
  | RowScrollTarget
  | RailScrollTarget
  | SectionScrollTarget;

export const ScrollHistories = {
  PUSH: "push",
  REPLACE: "replace",
  NONE: "none",
} as const;
export type ScrollHistory = ValueOf<typeof ScrollHistories>;

export interface ScrollTargetOptions {
  motion: ScrollMotion;
  /**
   * How a scroll to target asked in Changes scope leaves it: push for a
   * gesture, replace for an arrival. None never leaves and scrolls to the
   * target where it is.
   */
  history: ScrollHistory;
  /** Ensure the target's chunk card is open before the scroll. */
  open?: boolean;
  /** Move focus onto the target once it is mounted, without scrolling. */
  focus?: boolean;
  /** Mark the target once it is mounted, so the eye finds it. */
  flash?: boolean;
  /** Defaults to the viewport's top edge. */
  placement?: ScrollPlacement;
}

export interface ScrollToTarget {
  /** False when the scroll could not be scheduled, so an arrival keeps its chance. */
  scrollToTarget: (
    target: ScrollTarget,
    options: ScrollTargetOptions,
  ) => boolean;
}

/** False when the scroll could not be scheduled; see `ScrollToTarget`. */
export type JumpToChunkFromConversation = (
  chunkId: string,
  target?: ConversationScrollTarget,
  behavior?: ScrollBehavior,
  history?: ScrollHistory,
) => boolean;

export interface UseScrollToTargetInput {
  /** A scroll in flight or parked never outlives its brief. */
  briefId: string;
  /** Jump routing into windowed chunk lists; absent = mounted DOM only. */
  chunkWindows: ChunkWindowsPort | undefined;
  openChunk: (chunkId: string) => void;
  /** Changes scope renders no story pane: a scroll that leaves it parks until it renders. */
  inChangesScope: boolean;
  /** Route-owned; absent, a scroll that must leave Changes scope is refused. */
  exitChangesScope: ((options: ScopeExitOptions) => void) | undefined;
}

/** The one scroll waiting for the story pane. */
export interface ParkedScroll {
  target: ScrollTarget;
  options: ScrollTargetOptions;
}

export type ChunkWindowsPort = Pick<ChunkWindowRegistry, "scrollToChunk">;

/** The one flashed element: a new flash or a brief switch clears the last. */
export interface Flash {
  element: HTMLElement | undefined;
  frame: number | undefined;
  timer: number | undefined;
}

/** What one frame's action acts on. */
export interface ScrollActionInput {
  element: HTMLElement | undefined;
  /** The chunk whose card holds the target; undefined outside the chunk lists. */
  chunkId: string | undefined;
  chunkWindows: ChunkWindowsPort | undefined;
}
