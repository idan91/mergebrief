/** Frames to await a landing target across a windowed jump's whole flight
 * (mount happens as the smooth scroll approaches; ~1.5s at 60Hz). */
export const LANDING_POLL_FRAMES = 90;
/** Consecutive still frames that count as "the row's scroll stopped". */
export const ROW_SETTLE_FRAMES = 3;
// A smooth scroll can take a few frames to start; stillness before it has
// moved is not a settled scroll. Past this many frames it is not coming.
export const ROW_SCROLL_START_FRAMES = 12;
/** How long a landed target keeps its flash attribute. */
export const LANDING_FLASH_MS = 1600;
