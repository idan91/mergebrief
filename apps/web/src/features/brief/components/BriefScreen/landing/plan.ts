import { CHUNK_LANDING_GAP_PX, SCROLL_START_FRAMES } from "../consts";
import { deriveRowLandingCorrection } from "../utils";
import {
  CORRECTION_THRESHOLD_PX,
  FAR_JUMP_VIEWPORTS,
  MOUNT_POLL_FRAMES,
  PLACED_DRIFT_PX,
  PLACEMENT_BLOCKS,
  SETTLE_FRAMES,
  WATCH_FRAMES,
} from "./consts";
import {
  LandingActionKinds,
  LandingPhases,
  LandPlacements,
  type DeferState,
  type LandingAction,
  type LandingReading,
  type LandingRequest,
  type LandingState,
  type LandingStep,
  type MountedTarget,
  type SettleState,
  type WaitAction,
} from "./types";

const WAIT: WaitAction = { kind: LandingActionKinds.WAIT };
const STOP: LandingStep = { action: WAIT, next: undefined };

/**
 * One frame of a landing: given where it is and what is mounted and
 * measured now, the action to take and the state the next frame starts from.
 */
export function planLanding(
  state: LandingState,
  reading: LandingReading,
  request: LandingRequest,
): LandingStep {
  if (state.phase === LandingPhases.DEFER) {
    return planDefer(state);
  }
  if (state.phase === LandingPhases.JUMP) {
    return planJump(reading, request);
  }

  return planSettle(state, reading, request);
}

function deriveUnderStackTop(reading: LandingReading): number {
  return reading.stackHeight + CHUNK_LANDING_GAP_PX;
}

/** How far to scroll so the target rests where its placement puts it. */
function deriveCorrection(
  target: MountedTarget,
  reading: LandingReading,
  request: LandingRequest,
): number {
  if (request.placement === LandPlacements.READING_BAND) {
    return deriveRowLandingCorrection(
      target,
      reading.stackHeight,
      reading.viewportHeight,
    );
  }
  if (request.placement === LandPlacements.UNDER_STACK) {
    return target.top - deriveUnderStackTop(reading);
  }
  return target.top;
}

function planDefer(state: DeferState): LandingStep {
  if (state.framesLeft > 1) {
    return {
      action: WAIT,
      next: { phase: LandingPhases.DEFER, framesLeft: state.framesLeft - 1 },
    };
  }

  return { action: WAIT, next: { phase: LandingPhases.JUMP } };
}

function startSettle(awaitStart: boolean): SettleState {
  return {
    phase: LandingPhases.SETTLE,
    frames: 0,
    stillFrames: 0,
    hasMoved: false,
    awaitStart,
    lastScrollY: undefined,
    placedOffset: undefined,
  };
}

function planJump(
  reading: LandingReading,
  request: LandingRequest,
): LandingStep {
  const { target } = reading;
  if (target === undefined) {
    return {
      action: { kind: LandingActionKinds.ASK_WINDOWS },
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
        kind: LandingActionKinds.SCROLL_INTO_VIEW,
        behavior: "instant",
        block,
      },
      next: startSettle(false),
    };
  }
  if (request.placement !== LandPlacements.UNDER_STACK) {
    return {
      action: {
        kind: LandingActionKinds.SCROLL_INTO_VIEW,
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
      kind: LandingActionKinds.SCROLL_TO,
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
  return (
    placedOffset !== undefined &&
    Math.abs(offset - placedOffset) <= PLACED_DRIFT_PX
  );
}

/**
 * Wait for the target to mount and the scroll to rest, then place it. The
 * watch keeps running: a later rest re-places a target a reflow moved, and
 * a scroll that leaves the placed target where it was is someone else's.
 */
function planSettle(
  state: SettleState,
  reading: LandingReading,
  request: LandingRequest,
): LandingStep {
  const frames = state.frames + 1;
  const { target } = reading;
  const placed = state.placedOffset !== undefined;
  if (target === undefined) {
    if (placed || frames >= MOUNT_POLL_FRAMES) {
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
  if (moved && stayedPlaced) {
    return STOP;
  }

  const hasMoved = state.hasMoved || moved;
  const started = !state.awaitStart || hasMoved || frames > SCROLL_START_FRAMES;
  const stillFrames = moved || !started ? 0 : state.stillFrames + 1;
  const next: SettleState = {
    ...state,
    frames,
    stillFrames,
    hasMoved,
    lastScrollY: reading.scrollY,
  };
  let action: LandingAction = WAIT;
  if (stillFrames >= SETTLE_FRAMES && !stayedPlaced) {
    next.placedOffset = offset;
    const delta = deriveCorrection(target, reading, request);
    if (Math.abs(delta) > CORRECTION_THRESHOLD_PX) {
      action = { kind: LandingActionKinds.SCROLL_BY, top: delta };
      next.lastScrollY = undefined;
    }
  }

  if (frames >= WATCH_FRAMES) {
    return { action, next: undefined };
  }
  return { action, next };
}
