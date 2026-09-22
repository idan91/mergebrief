const OVERLAY_SELECTOR =
  '[role="menu"], [aria-expanded="true"], [role="dialog"]';

/** A key pressed inside an open menu or dialog belongs to it, never to the page. */
export function isInsideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OVERLAY_SELECTOR) !== null;
}
