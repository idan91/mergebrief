import { type RefObject, useEffect, useState } from "react";

import type { DiffView, SplitSide } from "@web/components/DiffRows/types";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { DragMode, RangeDrag } from "./types";

export interface DragSelectionInput {
  /** The row model a drag belongs to; a change under it ends the drag. */
  chunkDiff: DiffLine[] | undefined;
  resolvedView: DiffView;
  tableRef: RefObject<HTMLTableElement | null>;
}

/**
 * The range-anchoring drag in flight, if any. A text selection begun on one
 * side rides the table as an attribute set by hand, because a state write
 * on the pointer-down of a text selection would re-render every row.
 */
export function useDragSelection({
  chunkDiff,
  resolvedView,
  tableRef,
}: DragSelectionInput) {
  const [inFlight, setInFlight] = useState<RangeDrag | undefined>(undefined);
  const dragging = inFlight !== undefined;

  const clearDrag = () => {
    setInFlight(undefined);
  };

  // The row model a drag was resolved against can change under it: the view
  // toggle is a keyboard shortcut and can fire mid-drag, and a revision
  // switch rebuilds the rows. Either way the drag goes with the model it
  // belonged to, rather than anchoring a comment on rows it never covered.
  useEffect(() => {
    setInFlight(undefined);
    tableRef.current?.removeAttribute("data-selecting");
  }, [chunkDiff, resolvedView, tableRef]);

  // Reset the drag when the mouse is released anywhere. Without this, releasing
  // outside a commentable row leaves the selection highlight stuck on.
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const reset = () => {
      setInFlight(undefined);
    };
    window.addEventListener("mouseup", reset);
    return () => window.removeEventListener("mouseup", reset);
  }, [dragging]);

  useEffect(() => {
    const release = () => tableRef.current?.removeAttribute("data-selecting");
    window.addEventListener("mouseup", release);
    return () => window.removeEventListener("mouseup", release);
  }, [tableRef]);

  const beginDrag = (
    index: number,
    side: SplitSide | undefined,
    mode: DragMode,
  ) => {
    setInFlight({
      mode,
      start: index,
      startSide: side,
      current: index,
      currentSide: side,
    });
  };
  // Entering the other cell of the row the pointer is already on keeps the
  // same state, so the table does not re-render.
  const moveDrag = (index: number, side: SplitSide | undefined) => {
    setInFlight((drag) => {
      if (drag === undefined) {
        return undefined;
      }
      if (drag.current === index && drag.currentSide === side) {
        return drag;
      }
      return { ...drag, current: index, currentSide: side };
    });
  };
  const markSelectingSide = (side: SplitSide) => {
    tableRef.current?.setAttribute("data-selecting", side);
  };

  return {
    inFlight,
    beginDrag,
    moveDrag,
    clearDrag,
    markSelectingSide,
  };
}
