import {
  CALLOUT_ROOT_SELECTOR,
  CALLOUT_WARM_MS,
  PARKED_TABINDEX_ATTRIBUTE,
} from "./consts";
import type { ContentTabStopState } from "./types";

let openCallouts = 0;
let warmUntil = 0;

/** Marks one callout on screen; the returned function marks it gone. */
export function holdCalloutsWarm(): () => void {
  openCallouts += 1;
  return () => {
    openCallouts -= 1;
    warmUntil = Date.now() + CALLOUT_WARM_MS;
  };
}

/** Whether a callout is on screen, or left just now: the next skips its delay. */
export function areCalloutsWarm(): boolean {
  const anyOnScreen = openCallouts > 0;
  const leftJustNow = Date.now() < warmUntil;
  return anyOnScreen || leftJustNow;
}

/** Whether an event target or focused node sits inside any open callout. */
export function isInsideCallout(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(CALLOUT_ROOT_SELECTOR) !== null
  );
}

/** Whether focus moved into or out of the container, floating-ui's park test. */
export function crossesFocusBoundary(
  container: Element,
  event: FocusEvent,
): boolean {
  const other = event.relatedTarget;
  return !(other instanceof Node) || !container.contains(other);
}

/**
 * Adds or drops the scroller's tab stop. While the portal is parked the change
 * goes into the parked value, so floating-ui never restores a stale one and a
 * new stop waits for focus to return, as floating-ui would have parked it.
 */
export function setContentTabStop(
  content: HTMLElement,
  { tabStop, portalParked }: ContentTabStopState,
): void {
  if (content.hasAttribute(PARKED_TABINDEX_ATTRIBUTE)) {
    content.setAttribute(PARKED_TABINDEX_ATTRIBUTE, tabStop ? "0" : "");
    return;
  }

  if (tabStop && portalParked) {
    content.setAttribute(PARKED_TABINDEX_ATTRIBUTE, "0");
    content.setAttribute("tabindex", "-1");
  } else if (tabStop) {
    content.setAttribute("tabindex", "0");
  } else {
    content.removeAttribute("tabindex");
  }
}

/**
 * Calls `onResize` when the scroller or any of its children resizes, children
 * added after the first call included. Returns the teardown.
 */
export function observeContentSize(
  content: HTMLElement,
  onResize: () => void,
): () => void {
  const resizes = new ResizeObserver(onResize);
  function observeChildren() {
    for (const child of Array.from(content.children)) {
      resizes.observe(child);
    }
  }
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.removedNodes)) {
        if (node instanceof Element) {
          resizes.unobserve(node);
        }
      }
    }
    observeChildren();
    onResize();
  });

  resizes.observe(content);
  observeChildren();
  mutations.observe(content, { childList: true });
  return () => {
    resizes.disconnect();
    mutations.disconnect();
  };
}
