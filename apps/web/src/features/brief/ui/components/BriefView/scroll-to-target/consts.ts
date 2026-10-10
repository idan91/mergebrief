export const FLASH_MS = 1600;

/**
 * A styling hook written imperatively, since the card's `data-state` is
 * React-owned. Removed after `FLASH_MS`, on a brief switch and on unmount;
 * the card, row and under-row stylesheets animate on it.
 */
export const SCROLL_FLASH_ATTR = "data-scroll-flash";
