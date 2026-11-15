import { useCallback, useEffect, useRef, type RefCallback } from "react";

import {
  findLineStep,
  readLineStop,
  revealLineStop,
  syncTabStop,
} from "./line-stops";

/**
 * One Tab stop per diff table, bound through the table body's ref. The tab
 * index and the listeners live on the DOM, not in the render: moving the
 * stop then renders no row, and a table is hundreds.
 */
export function useLineStops(): RefCallback<HTMLTableSectionElement> {
  const body = useRef<HTMLTableSectionElement | null>(null);
  const tabStop = useRef<HTMLElement | undefined>(undefined);

  // Every render: rows mount, leave and trade places on any of them, and a
  // new row arrives off the Tab order.
  useEffect(() => {
    if (body.current !== null) {
      tabStop.current = syncTabStop(body.current, tabStop.current);
    }
  });

  return useCallback((element: HTMLTableSectionElement) => {
    body.current = element;

    // A Tab press moves focus in its own task, before any timer; a focus a
    // script moves on its own never follows one, so it keeps its scroll.
    let tabPressed = false;
    const noteTabPress = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }
      tabPressed = true;
      setTimeout(() => {
        tabPressed = false;
      }, 0);
    };
    const holdFocusedStop = (event: FocusEvent) => {
      const stop = readLineStop(event.target);
      if (stop === undefined) {
        return;
      }
      tabStop.current = syncTabStop(element, stop);
      if (tabPressed) {
        revealLineStop(stop);
      }
    };
    const stepBetweenStops = (event: KeyboardEvent) => {
      // A modified arrow belongs to the reader's assistive tech or the
      // browser's own selection chords.
      const modified =
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
      const stop = readLineStop(event.target);
      if (modified || stop === undefined) {
        return;
      }
      const next = findLineStep(element, stop, event.key);
      if (next !== undefined) {
        event.preventDefault();
        next.focus({ preventScroll: true });
        revealLineStop(next);
      }
    };

    const page = element.ownerDocument;
    page.addEventListener("keydown", noteTabPress, { capture: true });
    element.addEventListener("focusin", holdFocusedStop);
    element.addEventListener("keydown", stepBetweenStops);
    return () => {
      page.removeEventListener("keydown", noteTabPress, { capture: true });
      element.removeEventListener("focusin", holdFocusedStop);
      element.removeEventListener("keydown", stepBetweenStops);
      body.current = null;
      tabStop.current = undefined;
    };
  }, []);
}
