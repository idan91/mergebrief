import type { ValueOf } from "types/utils";

import type { ChunkWindowRegistry } from "../chunkWindows";
import type { ConversationLanding } from "../useConversationWiring/types";

export const LandTargetKinds = {
  CHUNK: "chunk",
  GROUP: "group",
  ROW: "row",
  RAIL: "rail",
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

export interface RowLandTarget {
  kind: typeof LandTargetKinds.ROW;
  chunkId: string;
  row: ConversationLanding;
}

export interface RailLandTarget {
  kind: typeof LandTargetKinds.RAIL;
  chunkId: string;
  railKey: string;
}

export type LandTarget =
  | ChunkLandTarget
  | GroupLandTarget
  | RowLandTarget
  | RailLandTarget;

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

/** Where the target's head rests: the viewport's top edge, or under the pinned stack. */
export const LandPlacements = {
  VIEWPORT_TOP: "viewport-top",
  UNDER_STACK: "under-stack",
} as const;
export type LandPlacement = ValueOf<typeof LandPlacements>;

export interface LandOptions {
  motion: LandMotion;
  history: LandHistory;
  /** Ensure the target's chunk card is open before the scroll. */
  open?: boolean;
  /** Move focus onto the target once it is mounted, without scrolling. */
  focus?: boolean;
  flash?: boolean;
  /** Defaults to the viewport's top edge. */
  placement?: LandPlacement;
}

export interface Landing {
  /** False when the landing could not be scheduled, so an arrival keeps its chance. */
  land: (target: LandTarget, options: LandOptions) => boolean;
  /** Drops the landing in flight: its deferred jump, its watch and its listeners. */
  cancel: () => void;
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

/** The target as mounted and measured on one frame. */
export interface MountedTarget {
  /** Viewport-relative top of the target's box. */
  top: number;
  /** Inside a hidden kept-warm pane: it has no box to land on. */
  hidden: boolean;
}

export interface LandingReading {
  target: MountedTarget | undefined;
  scrollY: number;
  viewportHeight: number;
  /** Viewport offset of the line under the pinned stack, landing gap included. */
  underStackTop: number;
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
