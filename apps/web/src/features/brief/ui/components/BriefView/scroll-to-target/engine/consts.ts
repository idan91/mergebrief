import { ScrollPlacements, type ScrollPlacement } from "./types";

/** Frames to wait for a window-jumped target to mount (~1.5s at 60Hz). */
export const MOUNT_POLL_FRAMES = 90;

/** Frames a placed target stays watched (~5s at 60Hz): a windowed list's late measurements move it. */
export const WATCH_FRAMES = 300;

/** Consecutive still frames that count as "scroll stopped". */
export const SETTLE_FRAMES = 3;

/** Below this miss, no correction: a nudge would read as jitter. */
export const CORRECTION_THRESHOLD_PX = 8;

/** A placed target within this of its placed document offset has stayed put: sub-pixel drift is not a move. */
export const PLACED_DRIFT_PX = 1;

/** Past this many viewports away a jump is instant: measurement adjustments cancel a smooth one. */
export const FAR_JUMP_VIEWPORTS = 3;

/** An under-stack scroll waits for the focus pill to mount before it measures. */
export const PLACEMENT_DEFER_FRAMES: Record<ScrollPlacement, number> = {
  [ScrollPlacements.VIEWPORT_TOP]: 0,
  [ScrollPlacements.UNDER_STACK]: 2,
  [ScrollPlacements.READING_BAND]: 0,
};

export const PLACEMENT_BLOCKS: Record<ScrollPlacement, ScrollLogicalPosition> =
  {
    [ScrollPlacements.VIEWPORT_TOP]: "start",
    [ScrollPlacements.UNDER_STACK]: "start",
    [ScrollPlacements.READING_BAND]: "center",
  };

/** Air between a placed card's head and the pinned stack, where every under-stack scroll aims. */
export const CHUNK_SCROLL_GAP_PX = 40;

// A smooth scroll action can take a few frames to start; stillness before
// it has moved is not rest. Past this many frames it is not coming.
export const SCROLL_START_FRAMES = 12;

/** User inputs that abort an in-flight scroll to target; a click or drag in the target card counts. */
export const SCROLL_ABORT_EVENTS = [
  "wheel",
  "touchstart",
  "keydown",
  "pointerdown",
] as const;

/** Air between a corrected head and the pinned stack. */
export const ROW_SCROLL_GAP_PX = 16;
/** Where a corrected row's top rests, as a share of the band below the stack. */
export const ROW_SCROLL_BAND_SHARE = 1 / 3;
