import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useAnnouncer } from "@web/hooks/useAnnouncer";
import { isFocusLost, MAIN_CONTENT_ID } from "@web/utils/main-content";

/**
 * What a document load does for free and a router move does not: says the
 * new page's name, and gives focus somewhere to be when the control that was
 * clicked left with the old page. A change of search on one page is not a
 * move, and neither is the first load.
 */
export function RouteArrival() {
  const pathname = useRouterState({
    select: (state) => state.resolvedLocation?.pathname,
  });
  const { text, announce } = useAnnouncer();
  const arrivedAt = useRef(pathname);

  useEffect(() => {
    const moved = arrivedAt.current !== undefined && pathname !== undefined;
    const samePage = pathname === arrivedAt.current;
    arrivedAt.current = pathname ?? arrivedAt.current;
    if (!moved || samePage) {
      return;
    }

    announce(document.title);
    if (isFocusLost(document.activeElement)) {
      const main = document.getElementById(MAIN_CONTENT_ID);
      main?.focus({ preventScroll: true });
    }
  }, [announce, pathname]);

  return (
    <div
      aria-live="polite"
      className="sr-only"
      data-testid="route-arrival"
      role="status"
    >
      {text}
    </div>
  );
}
