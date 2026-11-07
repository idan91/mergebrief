import {
  SCROLL_ABORT_EVENTS,
  SCROLL_STEERING_PRESSES,
  SCROLL_STEERING_SELECTOR,
} from "./consts";

function isSteeringPress(event: Event): boolean {
  const pressed = event.target;
  if (!SCROLL_STEERING_PRESSES.has(event.type)) {
    return false;
  }
  if (!(pressed instanceof Element)) {
    return false;
  }
  return pressed.closest(SCROLL_STEERING_SELECTOR) !== null;
}

/**
 * The user's own input aborts the scroll: a late correction would yank them
 * away from wherever they moved. Capture phase, so a control that stops
 * propagation still ends it. Returns the remover, so a stale scroll's
 * listeners never survive into the next one and cancel it.
 */
export function armScrollAbort(cancelScroll: () => void): () => void {
  const abortScroll = (event: Event) => {
    if (!isSteeringPress(event)) {
      cancelScroll();
    }
  };
  for (const type of SCROLL_ABORT_EVENTS) {
    window.addEventListener(type, abortScroll, {
      capture: true,
      passive: true,
    });
  }
  return () => {
    for (const type of SCROLL_ABORT_EVENTS) {
      window.removeEventListener(type, abortScroll, { capture: true });
    }
  };
}
