const OVERLAY_SELECTOR =
  '[role="menu"], [aria-expanded="true"], [role="dialog"]';

/** A key pressed inside an open menu or dialog belongs to it, never to the page. */
export function isInsideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OVERLAY_SELECTOR) !== null;
}

const MENU_OR_DIALOG_SELECTOR = '[role="menu"], [role="dialog"]';

/** A key pressed inside an open menu or dialog; an expanded disclosure button keeps the page's keys. */
export function isInsideMenuOrDialog(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(MENU_OR_DIALOG_SELECTOR) !== null
  );
}
