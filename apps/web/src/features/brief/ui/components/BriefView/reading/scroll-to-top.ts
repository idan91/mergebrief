import { prefersReducedMotion } from "@web/utils/motion";
import type { ChunkWindowRegistry } from "./chunk-windows";

/** Input that hands the scroll back to the reader. */
const READER_INPUT_EVENTS = [
  "wheel",
  "touchstart",
  "keydown",
  "pointerdown",
] as const;

/** A stop this close to the top is the header regrowing, not the reader. */
const SHORT_MISS_PX = 120;

/**
 * Scrolls the page to its top. Cards mount above the fold on the way up, and
 * a window compensating for one cancels the smooth scroll, so every window
 * holds compensation until the page reaches the top, the scroll ends, or the
 * reader takes over. A scroll that ends just short of the top finishes with a
 * jump.
 */
export function scrollPageToTop(registry: ChunkWindowRegistry): void {
  if (window.scrollY <= 0) {
    return;
  }
  if (prefersReducedMotion()) {
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }

  registry.holdScrollCompensation(true);
  const listening = new AbortController();
  const listenerOptions = { passive: true, signal: listening.signal };
  const release = () => {
    listening.abort();
    registry.holdScrollCompensation(false);
  };
  window.addEventListener(
    "scroll",
    () => {
      if (window.scrollY <= 0) {
        release();
      }
    },
    listenerOptions,
  );
  // The header regrowing near the top shifts the page under the browser's
  // own scroll anchoring, which can end the smooth scroll a few px short. A
  // scrollbar drag sends none of the reader events, so a scroll that ends
  // further down was the reader's and stays where it ended.
  window.addEventListener(
    "scrollend",
    () => {
      release();
      const shortOfTop = window.scrollY > 0 && window.scrollY <= SHORT_MISS_PX;
      if (shortOfTop) {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    },
    listenerOptions,
  );
  for (const type of READER_INPUT_EVENTS) {
    window.addEventListener(type, release, listenerOptions);
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}
