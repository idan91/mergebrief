import { useCallback, useEffect, useRef, type RefCallback } from "react";

import { findLineStep, readLineStop, syncTabStop } from "./line-stops";

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

    const holdFocusedStop = (event: FocusEvent) => {
      const stop = readLineStop(event.target);
      if (stop !== undefined) {
        tabStop.current = syncTabStop(element, stop);
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
        next.focus();
      }
    };

    element.addEventListener("focusin", holdFocusedStop);
    element.addEventListener("keydown", stepBetweenStops);
    return () => {
      element.removeEventListener("focusin", holdFocusedStop);
      element.removeEventListener("keydown", stepBetweenStops);
      body.current = null;
      tabStop.current = undefined;
    };
  }, []);
}
