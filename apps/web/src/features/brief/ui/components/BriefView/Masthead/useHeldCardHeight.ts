import { useEffect, useRef } from "react";

import { OPEN_BAR_SELECTOR } from "@web/components/CollapsibleBar/consts";
import type { HeldCardHeightRefs } from "./types";
import { computeCardMinHeight, writeCardMinHeight } from "./utils";

const OPEN_FOLD_ROW = `:scope > * > ${OPEN_BAR_SELECTOR}`;

/**
 * Holds the stats card at the height of the summary plus the stack's folds
 * at rest, so an opening fold grows below the card instead of stretching it.
 * Only a row of a group in the stack counts, never a bar inside a fold's
 * panel. Measures in the frame after a resize, never inside the observer
 * callback.
 */
export function useHeldCardHeight(): HeldCardHeightRefs {
  const gridRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    const summary = summaryRef.current;
    const stack = stackRef.current;
    const unmounted = grid === null || summary === null || stack === null;
    if (unmounted) {
      return;
    }

    let collapsedStackHeight: number | undefined;
    const update = () => {
      if (stack.querySelector(OPEN_FOLD_ROW) === null) {
        collapsedStackHeight = stack.getBoundingClientRect().height;
      }
      const rowGap = Number.parseFloat(getComputedStyle(grid).rowGap);
      const minHeight = computeCardMinHeight({
        summaryHeight: summary.getBoundingClientRect().height,
        rowGap: Number.isFinite(rowGap) ? rowGap : 0,
        collapsedStackHeight,
      });
      writeCardMinHeight(grid, minHeight);
    };

    update();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(summary);
    observer.observe(stack);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return { gridRef, summaryRef, stackRef };
}
