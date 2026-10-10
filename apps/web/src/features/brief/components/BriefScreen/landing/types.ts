import type { ValueOf } from "types/utils";

import type { ChunkWindowRegistry } from "../chunkWindows";
import type { ConversationLanding } from "../useConversationWiring/types";
import type { VerticalExtent } from "../utils";

export const LandTargetKinds = {
  CHUNK: "chunk",
  GROUP: "group",
  ROW: "row",
  RAIL: "rail",
  SECTION: "section",
} as const;

export interface ChunkLandTarget {
  kind: typeof LandTargetKinds.CHUNK;
  chunkId: string;
}

/** The group's section; focus goes to its heading. */
export interface GroupLandTarget {
  kind: typeof LandTargetKinds.GROUP;
  groupId: string;
}

/**
 * A row inside the chunk's own card; focus goes to a thread's disclosure or
 * to the line's row. A row that never renders concedes to its card.
 */
export interface RowLandTarget {
  kind: typeof LandTargetKinds.ROW;
  chunkId: string;
  row: ConversationLanding;
}

/** A revision rail's button, the first one outside a hidden pane. */
export interface RailLandTarget {
  kind: typeof LandTargetKinds.RAIL;
  chunkId: string;
  railKey: string;
}

/** A page section outside the chunk lists, by its element id. */
export interface SectionLandTarget {
  kind: typeof LandTargetKinds.SECTION;
  sectionId: string;
}

export type LandTarget =
  | ChunkLandTarget
  | GroupLandTarget
  | RowLandTarget
  | RailLandTarget
  | SectionLandTarget;

export const LandMotions = {
  INSTANT: "instant",
  SMOOTH: "smooth",
} as const;
export type LandMotion = ValueOf<typeof LandMotions>;

export const LandHistories = {
  PUSH: "push",
  REPLACE: "replace",
  NONE: "none",
} as const;
export type LandHistory = ValueOf<typeof LandHistories>;

/**
 * Where the target rests: its head at the viewport's top edge or under the
 * pinned stack, or, for a row, anywhere it reads in the band under the stack
 * (whole, top in the upper half), else its top a third of the way down.
 */
export const LandPlacements = {
  VIEWPORT_TOP: "viewport-top",
  UNDER_STACK: "under-stack",
  READING_BAND: "reading-band",
} as const;
export type LandPlacement = ValueOf<typeof LandPlacements>;

export interface LandOptions {
  motion: LandMotion;
  history: LandHistory;
  /** Ensure the target's chunk card is open before the scroll. */
  open?: boolean;
  /** Move focus onto the target once it is mounted, without scrolling. */
  focus?: boolean;
  /** Mark the target once it is mounted, so the eye finds it. */
  flash?: boolean;
  /** Defaults to the viewport's top edge. */
  placement?: LandPlacement;
}

export interface Landing {
  /** False when the landing could not be scheduled, so an arrival keeps its chance. */
  land: (target: LandTarget, options: LandOptions) => boolean;
}

export interface UseLandingInput {
  /** A landing in flight never outlives its brief. */
  briefId: string;
  /** Jump routing into windowed chunk lists; absent = mounted DOM only. */
  chunkWindows: ChunkWindowsPort | undefined;
  openChunk: (chunkId: string) => void;
}

export type ChunkWindowsPort = Pick<ChunkWindowRegistry, "scrollToChunk">;

export const LandingPhases = {
  DEFER: "defer",
  JUMP: "jump",
  SETTLE: "settle",
} as const;

export interface DeferState {
  phase: typeof LandingPhases.DEFER;
  framesLeft: number;
}

export interface JumpState {
  phase: typeof LandingPhases.JUMP;
}

export interface SettleState {
  phase: typeof LandingPhases.SETTLE;
  frames: number;
  stillFrames: number;
  hasMoved: boolean;
  /** A smooth scroll is still starting: stillness before it moves is not rest. */
  awaitStart: boolean;
  /** Undefined right after this landing scrolled: the next frame takes a fresh baseline. */
  lastScrollY: number | undefined;
  /** The target's document offset when last placed; undefined until the first placement. */
  placedOffset: number | undefined;
}

export type LandingState = DeferState | JumpState | SettleState;

/** The target as mounted and measured on one frame, viewport-relative. */
export interface MountedTarget extends VerticalExtent {
  /** Inside a hidden kept-warm pane: it has no box to land on. */
  hidden: boolean;
}

export interface LandingReading {
  target: MountedTarget | undefined;
  scrollY: number;
  viewportHeight: number;
  /** The pinned stack's height, landing gap excluded. */
  stackHeight: number;
}

export interface LandingRequest {
  placement: LandPlacement;
  /** The behaviour a near scroll uses, reduced motion already applied. */
  behavior: ScrollBehavior;
}

export const LandingActionKinds = {
  WAIT: "wait",
  SCROLL_INTO_VIEW: "scroll-into-view",
  SCROLL_TO: "scroll-to",
  ASK_WINDOWS: "ask-windows",
  SCROLL_BY: "scroll-by",
} as const;

export interface WaitAction {
  kind: typeof LandingActionKinds.WAIT;
}

export interface ScrollIntoViewAction {
  kind: typeof LandingActionKinds.SCROLL_INTO_VIEW;
  behavior: ScrollBehavior;
  block: ScrollLogicalPosition;
}

export interface ScrollToAction {
  kind: typeof LandingActionKinds.SCROLL_TO;
  top: number;
  behavior: ScrollBehavior;
}

/** Ask the windowed lists to scroll toward an unmounted chunk. */
export interface AskWindowsAction {
  kind: typeof LandingActionKinds.ASK_WINDOWS;
}

/** An instant correction onto the real element. */
export interface ScrollByAction {
  kind: typeof LandingActionKinds.SCROLL_BY;
  top: number;
}

export type LandingAction =
  | WaitAction
  | ScrollIntoViewAction
  | ScrollToAction
  | AskWindowsAction
  | ScrollByAction;

export interface LandingStep {
  action: LandingAction;
  /** Undefined ends the landing after the action. */
  next: LandingState | undefined;
}

/** The one flashed element: a new flash or a brief switch clears the last. */
export interface Flash {
  element: HTMLElement | undefined;
  frame: number | undefined;
  timer: number | undefined;
}

/** What one frame's action acts on. */
export interface LandingActionInput {
  element: HTMLElement | undefined;
  /** The chunk whose card holds the target; undefined outside the chunk lists. */
  chunkId: string | undefined;
  chunkWindows: ChunkWindowsPort | undefined;
}
