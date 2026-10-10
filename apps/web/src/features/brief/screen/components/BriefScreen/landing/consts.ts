import { LandPlacements, type LandPlacement } from "./types";

/** Frames to wait for a window-jumped target to mount (~1.5s at 60Hz). */
export const MOUNT_POLL_FRAMES = 90;

/** Frames a landed target stays watched (~5s at 60Hz): a windowed list's late measurements move it. */
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
  [LandPlacements.READING_BAND]: 0,
};

export const PLACEMENT_BLOCKS: Record<LandPlacement, ScrollLogicalPosition> = {
  [LandPlacements.VIEWPORT_TOP]: "start",
  [LandPlacements.UNDER_STACK]: "start",
  [LandPlacements.READING_BAND]: "center",
};

export const FLASH_MS = 1600;

/**
 * A styling hook written imperatively, since the card's `data-state` is
 * React-owned. Removed after `FLASH_MS`, on a brief switch and on unmount;
 * the card, row and under-row stylesheets animate on it.
 */
export const LANDING_FLASH_ATTR = "data-landing-flash";
