import { useLayoutEffect, type RefObject } from "react";

/** One reading of a watched element: laid out at all, and pinned if so. */
interface StuckReading {
  shown: boolean;
  pinned: boolean;
}

type StuckListener = (reading: StuckReading) => void;

interface StuckWatch {
  listener: StuckListener;
  offsetPx: number | undefined;
  reading: StuckReading | undefined;
}

interface OffsetObserver {
  observer: IntersectionObserver;
  targets: Set<Element>;
}

/** Stretches the observed area far below the fold, so only the sticky top
 * can clip an element and a partial view there always means pinned. */
const BELOW_FOLD_MARGIN_PX = 100_000;
const PIN_THRESHOLDS = [0, 1];
const STUCK_ATTRIBUTE = "data-stuck";
const MOTION_ATTRIBUTE = "data-motion";
const MOTION_ON = "on";
const NOT_STICKY: StuckReading = { shown: true, pinned: false };
/** Disarms motion, so the next reading paints in place. */
const UNSEEN: StuckReading = { shown: false, pinned: false };

const watches = new Map<Element, StuckWatch>();
const observersByOffset = new Map<number, OffsetObserver>();
let offsetWatcher: MutationObserver | undefined;

function readStickyOffset(element: Element): number | undefined {
  const style = getComputedStyle(element);
  if (style.position !== "sticky") {
    return undefined;
  }
  const offset = Number.parseFloat(style.top);
  return Number.isFinite(offset) ? offset : undefined;
}

// Shown means laid out and inside the watched area. The observer always
// reports a crossing in or out, so an element scrolled past and then hidden
// (a kept-warm pane, a display: none toolbar) has already read unseen.
function readEntry(entry: IntersectionObserverEntry): StuckReading {
  const line = entry.rootBounds?.top;
  const { top, height } = entry.boundingClientRect;
  const shown = entry.isIntersecting && height > 0;
  const pinned = shown && line !== undefined && top < line;
  return { shown, pinned };
}

// The same reading the observer will deliver, taken now so a remount or a
// first mount already pinned paints pinned before the observer's first task.
function readNow(element: Element, offsetPx: number): StuckReading {
  const line = offsetPx + 1;
  const { top, bottom, height } = element.getBoundingClientRect();
  const shown = height > 0 && bottom > line;
  const pinned = shown && top < line;
  return { shown, pinned };
}

function reportReading(watch: StuckWatch, reading: StuckReading): void {
  const previous = watch.reading;
  const unchanged =
    previous !== undefined &&
    previous.shown === reading.shown &&
    previous.pinned === reading.pinned;
  if (unchanged) {
    return;
  }
  watch.reading = reading;
  watch.listener(reading);
}

function handleEntries(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    const watch = watches.get(entry.target);
    if (watch !== undefined) {
      reportReading(watch, readEntry(entry));
    }
  }
}

function buildRootMargin(offsetPx: number): string {
  const line = -(offsetPx + 1);
  return `${String(line)}px 0px ${String(BELOW_FOLD_MARGIN_PX)}px 0px`;
}

function getOffsetObserver(offsetPx: number): OffsetObserver {
  const existing = observersByOffset.get(offsetPx);
  if (existing !== undefined) {
    return existing;
  }
  const created: OffsetObserver = {
    observer: new IntersectionObserver(handleEntries, {
      rootMargin: buildRootMargin(offsetPx),
      threshold: PIN_THRESHOLDS,
    }),
    targets: new Set(),
  };
  observersByOffset.set(offsetPx, created);
  return created;
}

function releaseOffset(element: Element, offsetPx: number): void {
  const group = observersByOffset.get(offsetPx);
  if (group === undefined) {
    return;
  }
  group.targets.delete(element);
  group.observer.unobserve(element);
  if (group.targets.size === 0) {
    group.observer.disconnect();
    observersByOffset.delete(offsetPx);
  }
}

function placeWatch(
  element: Element,
  watch: StuckWatch,
  offsetPx: number | undefined,
): void {
  const stickinessChanged =
    (watch.offsetPx === undefined) !== (offsetPx === undefined);
  if (watch.offsetPx !== undefined) {
    releaseOffset(element, watch.offsetPx);
  }
  watch.offsetPx = offsetPx;
  const resetsReading = stickinessChanged && watch.reading !== undefined;
  if (resetsReading) {
    reportReading(watch, UNSEEN);
  }
  if (offsetPx === undefined) {
    reportReading(watch, NOT_STICKY);
    return;
  }
  const group = getOffsetObserver(offsetPx);
  group.targets.add(element);
  group.observer.observe(element);
}

function refreshOffsets(): void {
  for (const [element, watch] of watches) {
    const offsetPx = readStickyOffset(element);
    if (offsetPx !== watch.offsetPx) {
      placeWatch(element, watch, offsetPx);
    }
  }
}

// The pinned stack's parts publish their heights on the root's inline style;
// a media query moves an offset without touching it, hence the resize.
function startOffsetWatch(): void {
  offsetWatcher = new MutationObserver(refreshOffsets);
  offsetWatcher.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });
  window.addEventListener("resize", refreshOffsets);
}

function stopOffsetWatch(): void {
  offsetWatcher?.disconnect();
  offsetWatcher = undefined;
  window.removeEventListener("resize", refreshOffsets);
}

function watchStuck(element: Element, listener: StuckListener): () => void {
  if (watches.size === 0) {
    startOffsetWatch();
  }
  const watch: StuckWatch = {
    listener,
    offsetPx: undefined,
    reading: undefined,
  };
  watches.set(element, watch);
  placeWatch(element, watch, readStickyOffset(element));
  if (watch.offsetPx !== undefined) {
    reportReading(watch, readNow(element, watch.offsetPx));
  }

  return () => {
    if (watch.offsetPx !== undefined) {
      releaseOffset(element, watch.offsetPx);
    }
    watches.delete(element);
    if (watches.size === 0) {
      stopOffsetWatch();
    }
  };
}

/**
 * Marks the sticky element `ref` holds with `data-stuck` while it is pinned at
 * its computed sticky top, read first before paint and then by one shared
 * IntersectionObserver per top. `data-motion="on"` arms two frames after the
 * first shown reading and drops while the element is hidden, which keeps its
 * last mark, so a page loaded scrolled or a pane shown again never animates
 * into place. The marks skip React state, so a reading re-renders nothing.
 * The element must stay mounted for the caller's lifetime.
 */
export function useStuckAttributes(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    let frame: number | undefined;
    let armed = false;

    function cancelArming(): void {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
    }

    function armMotion(target: HTMLElement): void {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = undefined;
          armed = true;
          target.setAttribute(MOTION_ATTRIBUTE, MOTION_ON);
        });
      });
    }

    const stopWatching = watchStuck(element, (next) => {
      if (!next.shown) {
        cancelArming();
        armed = false;
        element.removeAttribute(MOTION_ATTRIBUTE);
        return;
      }
      element.toggleAttribute(STUCK_ATTRIBUTE, next.pinned);
      const armingOrArmed = armed || frame !== undefined;
      if (!armingOrArmed) {
        armMotion(element);
      }
    });

    return () => {
      cancelArming();
      stopWatching();
    };
  }, [ref]);
}
