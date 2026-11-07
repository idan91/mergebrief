import { prefersReducedMotion } from "@web/utils/motion";
import {
  CORRECTION_THRESHOLD_PX,
  FAR_JUMP_VIEWPORTS,
  MOUNT_POLL_FRAMES,
  PLACED_DRIFT_PX,
  PLACEMENT_BLOCKS,
  PLACEMENT_DEFER_FRAMES,
  ROW_SCROLL_BAND_SHARE,
  ROW_SCROLL_GAP_PX,
  SCROLL_START_FRAMES,
  SETTLE_FRAMES,
  WATCH_FRAMES,
} from "./consts";
import {
  ScrollActionKinds,
  ScrollMotions,
  ScrollPhases,
  ScrollPlacements,
  type DeferState,
  type MountedTarget,
  type ScrollAction,
  type ScrollMotion,
  type ScrollPlacement,
  type ScrollReading,
  type ScrollRequest,
  type ScrollState,
  type ScrollStep,
  type SettleState,
  type VerticalExtent,
  type WaitAction,
} from "./types";

const WAIT: WaitAction = { kind: ScrollActionKinds.WAIT };
const STOP: ScrollStep = { action: WAIT, next: undefined };

export function deriveScrollBehavior(motion: ScrollMotion): ScrollBehavior {
  if (motion === ScrollMotions.INSTANT) {
    return "instant";
  }
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Callers still speaking `ScrollBehavior`: "auto" defers to the page's smooth scrolling. */
export function deriveScrollMotion(behavior: ScrollBehavior): ScrollMotion {
  if (behavior === "instant") {
    return ScrollMotions.INSTANT;
  }
  return ScrollMotions.SMOOTH;
}

export function startScrollState(placement: ScrollPlacement): ScrollState {
  const framesLeft = PLACEMENT_DEFER_FRAMES[placement];
  if (framesLeft > 0) {
    return { phase: ScrollPhases.DEFER, framesLeft };
  }
  return { phase: ScrollPhases.JUMP };
}

/**
 * One frame of a scroll to target: given where it is and what is mounted and
 * measured now, the scroll action to take and the state the next frame starts from.
 */
export function planScrollFrame(
  state: ScrollState,
  reading: ScrollReading,
  request: ScrollRequest,
): ScrollStep {
  if (state.phase === ScrollPhases.DEFER) {
    return planDefer(state);
  }
  if (state.phase === ScrollPhases.JUMP) {
    return planJump(reading, request);
  }

  return planSettle(state, reading, request);
}

function deriveUnderStackTop(reading: ScrollReading): number {
  const underStackTop = reading.stackHeight + reading.scrollGap;
  return underStackTop;
}

/** How far to scroll so the target rests where its placement puts it. */
function deriveCorrection(
  target: MountedTarget,
  reading: ScrollReading,
  request: ScrollRequest,
): number {
  if (request.placement === ScrollPlacements.READING_BAND) {
    return deriveRowScrollCorrection(
      target,
      reading.stackHeight,
      reading.viewportHeight,
    );
  }
  if (request.placement === ScrollPlacements.UNDER_STACK) {
    const correction = target.top - deriveUnderStackTop(reading);
    return correction;
  }
  return target.top;
}

function planDefer(state: DeferState): ScrollStep {
  if (state.framesLeft > 1) {
    return {
      action: WAIT,
      next: { phase: ScrollPhases.DEFER, framesLeft: state.framesLeft - 1 },
    };
  }

  return { action: WAIT, next: { phase: ScrollPhases.JUMP } };
}

function startSettle(awaitStart: boolean): SettleState {
  return {
    phase: ScrollPhases.SETTLE,
    frames: 0,
    stillFrames: 0,
    hasMoved: false,
    awaitStart,
    lastScrollY: undefined,
    placedOffset: undefined,
  };
}

function planJump(reading: ScrollReading, request: ScrollRequest): ScrollStep {
  const { target } = reading;
  if (target === undefined) {
    return {
      action: { kind: ScrollActionKinds.ASK_WINDOWS },
      next: startSettle(false),
    };
  }
  if (target.hidden) {
    return STOP;
  }

  const block = PLACEMENT_BLOCKS[request.placement];
  const far =
    Math.abs(target.top) > reading.viewportHeight * FAR_JUMP_VIEWPORTS;
  if (far) {
    return {
      action: {
        kind: ScrollActionKinds.SCROLL_INTO_VIEW,
        behavior: "instant",
        block,
      },
      next: startSettle(false),
    };
  }
  if (request.placement !== ScrollPlacements.UNDER_STACK) {
    return {
      action: {
        kind: ScrollActionKinds.SCROLL_INTO_VIEW,
        behavior: request.behavior,
        block,
      },
      next: startSettle(true),
    };
  }

  const underStackTop = deriveUnderStackTop(reading);
  const top = Math.max(0, reading.scrollY + target.top - underStackTop);
  return {
    action: {
      kind: ScrollActionKinds.SCROLL_TO,
      top,
      behavior: request.behavior,
    },
    next: startSettle(true),
  };
}

function hasStayedPlaced(
  offset: number,
  placedOffset: number | undefined,
): boolean {
  const withinDrift =
    placedOffset !== undefined &&
    Math.abs(offset - placedOffset) <= PLACED_DRIFT_PX;
  return withinDrift;
}

/**
 * Wait for the target to mount and the page to rest, then place it. The
 * watch keeps running: a later rest re-places a target a reflow moved, and
 * a scroll that leaves the placed target where it was is someone else's.
 */
function planSettle(
  state: SettleState,
  reading: ScrollReading,
  request: ScrollRequest,
): ScrollStep {
  const frames = state.frames + 1;
  const { target } = reading;
  const placed = state.placedOffset !== undefined;
  if (target === undefined) {
    const stopsWaiting = placed || frames >= MOUNT_POLL_FRAMES;
    if (stopsWaiting) {
      return STOP;
    }
    return { action: WAIT, next: { ...state, frames } };
  }
  if (target.hidden) {
    return STOP;
  }

  const offset = reading.scrollY + target.top;
  const moved =
    state.lastScrollY !== undefined && reading.scrollY !== state.lastScrollY;
  const stayedPlaced = hasStayedPlaced(offset, state.placedOffset);
  const foreignScroll = moved && stayedPlaced;
  if (foreignScroll) {
    return STOP;
  }

  const hasMoved = state.hasMoved || moved;
  const started = !state.awaitStart || hasMoved || frames > SCROLL_START_FRAMES;
  const resting = !moved && started;
  const stillFrames = resting ? state.stillFrames + 1 : 0;
  const next: SettleState = {
    ...state,
    frames,
    stillFrames,
    hasMoved,
    lastScrollY: reading.scrollY,
  };
  let action: ScrollAction = WAIT;
  const placesNow = stillFrames >= SETTLE_FRAMES && !stayedPlaced;
  if (placesNow) {
    next.placedOffset = offset;
    const delta = deriveCorrection(target, reading, request);
    if (Math.abs(delta) > CORRECTION_THRESHOLD_PX) {
      action = { kind: ScrollActionKinds.SCROLL_BY, top: delta };
      next.lastScrollY = undefined;
    }
  }

  if (frames >= WATCH_FRAMES) {
    return { action, next: undefined };
  }
  return { action, next };
}

/**
 * How far to scroll so a target row reads, 0 when it already does. The band
 * runs from the pinned stack to the viewport bottom; a row is readable when
 * it is whole in the band with its top in the upper half. Any other row
 * moves so its top sits a third of the way down the band, so a scroll never
 * leaves the row at the viewport's edge. A row taller than the band can
 * never fit: its head goes under the stack, and counts as readable anywhere
 * in the band's upper half.
 */
export function deriveRowScrollCorrection(
  extent: VerticalExtent,
  stickyStackHeight: number,
  viewportHeight: number,
): number {
  const bandHeight = viewportHeight - stickyStackHeight;
  const bandMiddle = stickyStackHeight + bandHeight / 2;
  const rowHeight = extent.bottom - extent.top;

  if (rowHeight > bandHeight) {
    return deriveHeadScrollCorrection(
      extent,
      stickyStackHeight,
      bandMiddle,
      stickyStackHeight + ROW_SCROLL_GAP_PX,
    );
  }
  const readable =
    extent.top >= stickyStackHeight &&
    extent.top <= bandMiddle &&
    extent.bottom <= viewportHeight;
  if (readable) {
    return 0;
  }

  return extent.top - (stickyStackHeight + bandHeight * ROW_SCROLL_BAND_SHARE);
}

function deriveHeadScrollCorrection(
  extent: VerticalExtent,
  stickyStackHeight: number,
  bandMiddle: number,
  restingTop: number,
): number {
  const headReadable =
    extent.top >= stickyStackHeight && extent.top <= bandMiddle;
  if (headReadable) {
    return 0;
  }

  return extent.top - restingTop;
}
