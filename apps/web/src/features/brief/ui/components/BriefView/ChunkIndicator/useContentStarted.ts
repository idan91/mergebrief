import { useEffect, useState } from "react";

import {
  readNumericCssVar,
  STICKY_STACK_HEIGHT_VAR,
} from "@web/utils/css-vars";
import { CONTENT_START_ATTR } from "../utils";
import type { ContentStart } from "./types";
import { isScrolledToEnd, pageScrolls } from "./utils";

/**
 * Whether the page has scrolled past where the chunks begin: the content
 * start sentinel sits above the pinned stack's bottom edge, or the page has
 * scrolled to its end, as far as a short brief lets the sentinel go. Read on
 * every scroll event, not observed: an instant jump of more than a viewport
 * carries the sentinel over a short viewport without ever intersecting it.
 * Listens only on a phone, where the bar it feeds shows; the line is read
 * again each time `phone` flips, as the pinned stack changes shape with it.
 */
export function useContentStarted(phone: boolean): ContentStart {
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!phone) {
      return;
    }
    const sentinel = document.querySelector(`[${CONTENT_START_ATTR}]`);
    if (!sentinel) {
      return;
    }
    const line = readNumericCssVar(STICKY_STACK_HEIGHT_VAR);
    const read = () => {
      const pastSentinel = sentinel.getBoundingClientRect().top <= line;
      setStarted(pastSentinel || isScrolledToEnd());
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [phone]);

  // A page that scrolls lets the jump's own scroll decide.
  const markJumped = () => {
    if (!pageScrolls()) {
      setStarted(true);
    }
  };

  return { started, markJumped };
}
