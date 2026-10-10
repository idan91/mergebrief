import { SCROLL_ABORT_EVENTS } from "./consts";

/**
 * The user's own input aborts the scroll: a late correction would yank them
 * away from wherever they moved. Capture phase, so a control that stops
 * propagation still ends it. Returns the remover, so a stale scroll's
 * listeners never survive into the next one and cancel it.
 */
export function armScrollAbort(cancelScroll: () => void): () => void {
  for (const type of SCROLL_ABORT_EVENTS) {
    window.addEventListener(type, cancelScroll, {
      capture: true,
      once: true,
      passive: true,
    });
  }
  return () => {
    for (const type of SCROLL_ABORT_EVENTS) {
      window.removeEventListener(type, cancelScroll, { capture: true });
    }
  };
}
