import { useLayoutEffect } from "react";

import { FLOATING_PORTAL_SELECTOR } from "./consts";
import {
  crossesFocusBoundary,
  observeContentSize,
  setContentTabStop,
} from "./utils";

/**
 * Makes the callout's scroller a tab stop while it holds more than it shows,
 * or while it holds focus, so a shrinking body never drops focus on the page.
 * Re-measured whenever the height cap or the content resizes. Null does nothing.
 */
export function useContentTabStop(content: HTMLElement | null): void {
  useLayoutEffect(() => {
    if (!content) {
      return undefined;
    }

    const portalNode = content.closest(FLOATING_PORTAL_SELECTOR);
    const portal = portalNode instanceof HTMLElement ? portalNode : undefined;
    let portalParked = false;
    const sync = () => {
      const overflows = content.scrollHeight > content.clientHeight;
      const focused = content.ownerDocument.activeElement === content;
      setContentTabStop(content, {
        tabStop: overflows || focused,
        portalParked,
      });
    };
    const notePortalFocus = (event: FocusEvent) => {
      if (portal && crossesFocusBoundary(portal, event)) {
        portalParked = event.type === "focusout";
      }
    };

    sync();
    content.addEventListener("blur", sync);
    // Capture phase, as floating-ui parks: a descendant cannot hide a crossing.
    portal?.addEventListener("focusin", notePortalFocus, true);
    portal?.addEventListener("focusout", notePortalFocus, true);
    const stopObserving = observeContentSize(content, sync);
    return () => {
      stopObserving();
      content.removeEventListener("blur", sync);
      portal?.removeEventListener("focusin", notePortalFocus, true);
      portal?.removeEventListener("focusout", notePortalFocus, true);
      setContentTabStop(content, { tabStop: false, portalParked: false });
    };
  }, [content]);
}
