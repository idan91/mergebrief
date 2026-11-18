import type { ValueOf } from "types/utils";

export const ScrollMotions = {
  INSTANT: "instant",
  SMOOTH: "smooth",
} as const;
export type ScrollMotion = ValueOf<typeof ScrollMotions>;

/**
 * Where the target rests: its head at the viewport's top edge or under the
 * pinned stack, or, for a row, anywhere it reads in the band under the stack
 * (whole, top in the upper half), else its top a third of the way down.
 */
export const ScrollPlacements = {
  VIEWPORT_TOP: "viewport-top",
  UNDER_STACK: "under-stack",
  READING_BAND: "reading-band",
} as const;
export type ScrollPlacement = ValueOf<typeof ScrollPlacements>;

export const ScrollPhases = {
  DEFER: "defer",
  JUMP: "jump",
  SETTLE: "settle",
} as const;
/** @public */
export type ScrollPhase = ValueOf<typeof ScrollPhases>;

export interface DeferState {
  phase: typeof ScrollPhases.DEFER;
  framesLeft: number;
}

export interface JumpState {
  phase: typeof ScrollPhases.JUMP;
}

export interface SettleState {
  phase: typeof ScrollPhases.SETTLE;
  frames: number;
  stillFrames: number;
  hasMoved: boolean;
  /** A smooth scroll action is still starting: stillness before it moves is not rest. */
  awaitStart: boolean;
  /** Undefined right after a scroll action moved the page: the next frame takes a fresh baseline. */
  lastScrollY: number | undefined;
  /** The target's document offset when last placed; undefined until the first placement. */
  placedOffset: number | undefined;
}

export type ScrollState = DeferState | JumpState | SettleState;

export interface VerticalExtent {
  top: number;
  bottom: number;
}

/** The target as mounted and measured on one frame, viewport-relative. */
export interface MountedTarget extends VerticalExtent {
  /** Inside a hidden kept-warm pane: it has no box to scroll to. */
  hidden: boolean;
}

export interface ScrollReading {
  target: MountedTarget | undefined;
  scrollY: number;
  viewportHeight: number;
  /** The pinned stack's height, scroll gap excluded. */
  stackHeight: number;
  /** Air an under-stack placement leaves between a head and the stack. */
  scrollGap: number;
}

export interface ScrollRequest {
  placement: ScrollPlacement;
  /** The behaviour a near scroll uses, reduced motion already applied. */
  behavior: ScrollBehavior;
}

export const ScrollActionKinds = {
  WAIT: "wait",
  SCROLL_INTO_VIEW: "scroll-into-view",
  SCROLL_TO: "scroll-to",
  ASK_WINDOWS: "ask-windows",
  SCROLL_BY: "scroll-by",
} as const;
/** @public */
export type ScrollActionKind = ValueOf<typeof ScrollActionKinds>;

export interface WaitAction {
  kind: typeof ScrollActionKinds.WAIT;
}

export interface ScrollIntoViewAction {
  kind: typeof ScrollActionKinds.SCROLL_INTO_VIEW;
  behavior: ScrollBehavior;
  block: ScrollLogicalPosition;
}

export interface ScrollToAction {
  kind: typeof ScrollActionKinds.SCROLL_TO;
  top: number;
  behavior: ScrollBehavior;
}

/** Ask the windowed lists to scroll toward an unmounted chunk. */
export interface AskWindowsAction {
  kind: typeof ScrollActionKinds.ASK_WINDOWS;
}

/** An instant correction onto the real element. */
export interface ScrollByAction {
  kind: typeof ScrollActionKinds.SCROLL_BY;
  top: number;
}

export type ScrollAction =
  | WaitAction
  | ScrollIntoViewAction
  | ScrollToAction
  | AskWindowsAction
  | ScrollByAction;

export interface ScrollStep {
  action: ScrollAction;
  /** Undefined ends the scroll to target after this scroll action. */
  next: ScrollState | undefined;
}
