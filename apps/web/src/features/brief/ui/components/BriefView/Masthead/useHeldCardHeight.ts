import { useLayoutEffect, useRef } from "react";

import {
  BAR_PANEL_SELECTOR,
  OPEN_BAR_ATTRIBUTE,
  OPEN_BAR_SELECTOR,
} from "@web/components/CollapsibleBar/consts";
import type { HeldCardHeightRefs } from "./types";
import {
  computeCardMinHeight,
  computeStackOffset,
  writeCardMinHeight,
  writeHeld,
  writeStackOffset,
} from "./utils";

const OPEN_FOLD_PANEL = `:scope > * > ${OPEN_BAR_SELECTOR} > ${BAR_PANEL_SELECTOR}`;

function measureOpenPanels(stack: HTMLElement): number {
  let height = 0;
  for (const panel of stack.querySelectorAll(OPEN_FOLD_PANEL)) {
    height += panel.getBoundingClientRect().height;
  }
  return height;
}

/**
 * While a fold is open, holds the stats card at the height of the summary
 * plus the stack's closed folds, so the fold grows below the card instead of
 * stretching it, and keeps the stack where a taller card rested it. At rest
 * the stylesheet does both alone, so nothing waits on a measurement. The
 * closed height is the stack's height less its open panels. The grid is
 * marked held before the card is measured: a card still stretched by the
 * open fold would read as an offset. Only a group's own rows count as folds.
 */
export function useHeldCardHeight(): HeldCardHeightRefs {
  const gridRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const summary = summaryRef.current;
    const card = cardRef.current;
    const stack = stackRef.current;
    const unmounted = grid === null || summary === null || stack === null;
    if (unmounted) {
      return;
    }

    const update = () => {
      const stackHeight = stack.getBoundingClientRect().height;
      const openPanelsHeight = measureOpenPanels(stack);
      const rowGap = Number.parseFloat(getComputedStyle(grid).rowGap);
      const heights = {
        summaryHeight: summary.getBoundingClientRect().height,
        rowGap: Number.isFinite(rowGap) ? rowGap : 0,
        collapsedStackHeight: stackHeight - openPanelsHeight,
      };

      const minHeight = computeCardMinHeight(heights);
      writeCardMinHeight(grid, minHeight);
      writeHeld(grid, openPanelsHeight > 0);

      const cardHeight = card?.getBoundingClientRect().height ?? 0;
      const offset = computeStackOffset({ ...heights, cardHeight });
      writeStackOffset(grid, offset);
    };

    update();
    let frame = 0;
    // Measures in the frame after a resize, never inside the callback.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(summary);
    observer.observe(stack);
    if (card !== null) {
      observer.observe(card);
    }
    // A fold opening or closing is handled before the next paint: a frame
    // spent waiting on the resize would show the card stretched by the fold.
    const folds = new MutationObserver(update);
    folds.observe(stack, {
      attributes: true,
      attributeFilter: [OPEN_BAR_ATTRIBUTE],
      subtree: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      folds.disconnect();
    };
  }, []);

  return { gridRef, summaryRef, cardRef, stackRef };
}
