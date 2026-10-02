/** Frames to await a landing target across a windowed jump's whole flight
 * (mount happens as the smooth scroll approaches; ~1.5s at 60Hz). */
export const LANDING_POLL_FRAMES = 90;
/** Consecutive still frames that count as "the row's scroll stopped". */
export const ROW_SETTLE_FRAMES = 3;
/** How long a landed target stays watched for drift: the chunk scroll
 * re-aims while cards measure, and the list's late measurements move the
 * page after it. */
export const LANDING_SETTLE_MS = 5000;
/** How long a landed target keeps its flash attribute. */
export const LANDING_FLASH_MS = 1600;
