import { LandPlacements, type LandPlacement } from "./types";

/** Frames to wait for a window-jumped target to mount (~1.5s at 60Hz). */
export const MOUNT_POLL_FRAMES = 90;

/**
 * Frames a landed target stays watched (~5s at 60Hz): a windowed list's
 * late measurements move the page after the target has landed.
 */
export const WATCH_FRAMES = 300;

/** Consecutive still frames that count as "scroll stopped". */
export const SETTLE_FRAMES = 3;

/** Below this landing miss, no correction: a nudge would read as jitter. */
export const CORRECTION_THRESHOLD_PX = 8;

/** A placed target within this of its placed document offset has stayed put: sub-pixel drift is not a move. */
export const PLACED_DRIFT_PX = 1;

/** Past this many viewports away a jump is instant: measurement adjustments cancel a smooth one. */
export const FAR_JUMP_VIEWPORTS = 3;

/** An under-stack landing waits for the focus pill to mount before it measures. */
export const PLACEMENT_DEFER_FRAMES: Record<LandPlacement, number> = {
  [LandPlacements.VIEWPORT_TOP]: 0,
  [LandPlacements.UNDER_STACK]: 2,
};
