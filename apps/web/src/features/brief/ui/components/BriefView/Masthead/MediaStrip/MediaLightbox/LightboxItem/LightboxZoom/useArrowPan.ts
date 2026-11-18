import { useEffect, type RefObject } from "react";

import { readPanOffset } from "../../utils";

/**
 * While `panning`, plain arrows scroll the viewport instead of stepping the
 * lightbox: this listener runs in the capture phase and claims the key, and
 * the step listener skips a claimed key. Instant, as every keyboard step is.
 */
export function useArrowPan(
  viewportRef: RefObject<HTMLElement | null>,
  panning: boolean,
): void {
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!panning || viewport === null) {
      return undefined;
    }
    function onKeyDown(event: KeyboardEvent): void {
      const offset = readPanOffset(event);
      if (offset === undefined || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      viewport?.scrollBy(offset);
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [panning, viewportRef]);
}
