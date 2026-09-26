import { type RefObject, useEffect, useState } from "react";

import type { DiffView, SplitSide } from "@web/components/DiffRows/types";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { DragMode } from "./types";

export interface DragSelectionInput {
  /** The row model a drag belongs to; a change under it ends the drag. */
  chunkDiff: DiffLine[] | undefined;
  resolvedView: DiffView;
  tableRef: RefObject<HTMLTableElement | null>;
}

/**
 * The range-anchoring drag: where it started, where the pointer is, and the
 * side each end sits on in split view. A text selection begun on one side
 * rides the table as an attribute set by hand, because a state write on the
 * pointer-down of a text selection would re-render every row.
 */
export function useDragSelection({
  chunkDiff,
  resolvedView,
  tableRef,
}: DragSelectionInput) {
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  const [dragSide, setDragSide] = useState<SplitSide | undefined>(undefined);
  const [dragCurrentSide, setDragCurrentSide] = useState<SplitSide | undefined>(
    undefined,
  );
  const [dragMode, setDragMode] = useState<DragMode | undefined>(undefined);

  const clearDrag = () => {
    setDragStart(null);
    setDragCurrent(null);
    setDragSide(undefined);
    setDragCurrentSide(undefined);
    setDragMode(undefined);
  };

  // The row model a drag was resolved against can change under it: the view
  // toggle is a keyboard shortcut and can fire mid-drag, and a revision
  // switch rebuilds the rows. Either way the drag goes with the model it
  // belonged to, rather than anchoring a comment on rows it never covered.
  useEffect(() => {
    setDragStart(null);
    setDragCurrent(null);
    setDragSide(undefined);
    setDragCurrentSide(undefined);
    setDragMode(undefined);
    tableRef.current?.removeAttribute("data-selecting");
  }, [chunkDiff, resolvedView, tableRef]);

  // Reset the drag when the mouse is released anywhere. Without this, releasing
  // outside a commentable row leaves the selection highlight stuck on.
  useEffect(() => {
    if (dragStart === null) return;
    const reset = () => {
      setDragStart(null);
      setDragCurrent(null);
      setDragSide(undefined);
      setDragCurrentSide(undefined);
      setDragMode(undefined);
    };
    window.addEventListener("mouseup", reset);
    return () => window.removeEventListener("mouseup", reset);
  }, [dragStart]);

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
    setDragStart(index);
    setDragCurrent(index);
    setDragSide(side);
    setDragCurrentSide(side);
    setDragMode(mode);
  };
  const moveDrag = (index: number, side: SplitSide | undefined) => {
    setDragCurrent(index);
    setDragCurrentSide(side);
  };
  const markSelectingSide = (side: SplitSide) => {
    tableRef.current?.setAttribute("data-selecting", side);
  };

  return {
    dragStart,
    dragCurrent,
    dragSide,
    dragCurrentSide,
    dragMode,
    beginDrag,
    moveDrag,
    clearDrag,
    markSelectingSide,
  };
}
