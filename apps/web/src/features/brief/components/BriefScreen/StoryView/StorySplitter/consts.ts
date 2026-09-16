import { SPLIT_MIN_WIDTH_PX } from "../useSplitWidth";

// The four sizes track styles/_layout.scss.
export const STORY_CARD_FLOOR_PX = 360;
export const STORY_CARD_CEILING_PX = 750;
export const STORY_DIFF_FLOOR_PX = SPLIT_MIN_WIDTH_PX;
export const STORY_DIFF_HEADROOM_PX = 2;

export const STORY_CARD_KEYBOARD_STEP_PX = 16;

/** Pointer travel before a press counts as a resize rather than a click. */
export const STORY_DRAG_SLOP_PX = 2;

/** The custom property on `.main` the card track reads; base.scss clamps it. */
export const STORY_CARD_TRACK_PROPERTY = "--story-card-track";

/**
 * Behavioural attribute on `.main` while a handle is being dragged. Every
 * splitter's observers hold their measurement while it is present and flush
 * when it drops. Nothing styles on it: the handle's own `data-state` does.
 */
export const STORY_DRAG_ATTR = "data-story-drag";
