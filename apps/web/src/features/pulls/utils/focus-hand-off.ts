const MAIN_CONTENT_ID = "main-content";

/**
 * The ref callback for a control a poll or its own click can unmount. React
 * runs the cleanup while the element is still in the document, so the active
 * element is read directly: focus the element held moves to the main
 * landmark instead of the document. Module-level on purpose: a new callback
 * per render would run the cleanup on every render.
 */
export function handOffFocusOnRemoval(
  element: HTMLElement | null,
): (() => void) | undefined {
  if (element === null) {
    return undefined;
  }
  return () => {
    if (element.contains(document.activeElement)) {
      document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true });
    }
  };
}
