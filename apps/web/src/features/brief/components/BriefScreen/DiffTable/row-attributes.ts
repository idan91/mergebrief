import type { LineCommentAnchor } from "@web/features/review/utils";
import { rowId } from "@web/features/review/utils";
import type {
  DiffRowAttributeSlot,
  DiffRowAttributes,
  SplitRow,
  SplitSide,
} from "@web/components/DiffRows/types";
import { rangeBetween } from "@web/utils/collections";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { BriefChunk } from "../../../types";
import type { DiffRowView } from "./diffRowView";
import type { DragSelection } from "./types";
import {
  buildLineAnchor,
  collectOwnerRowIds,
  collectSideIndexes,
  isSideFocusable,
  resolveSpanRangeOwner,
  mapToBaseIndexes,
} from "./utils";

export interface RowAttributesDeps {
  chunk: BriefChunk;
  rows: DiffLine[];
  baseRows: DiffLine[];
  baseIndexOf: readonly number[] | undefined;
  hasExpandedRows: boolean;
  pairs: SplitRow[];
  rowViews: readonly (DiffRowView | undefined)[];
  spanOwnerByRow: ReadonlyMap<number, string>;
  ownerChunkById: ReadonlyMap<string, BriefChunk>;
  composerDisabledReason: string | undefined;
  composerDisabledReasonId: string;
  expandedReasonId: string;
  drag: {
    dragStart: number | null;
    dragSide: SplitSide | undefined;
    beginDrag: (index: number, side: SplitSide | undefined) => void;
    moveDrag: (index: number, side: SplitSide | undefined) => void;
    clearDrag: () => void;
    markSelectingSide: (side: SplitSide) => void;
  };
  dragSelection: DragSelection;
  dragIndexes: ReadonlySet<number>;
  activeRowIds: ReadonlySet<string>;
  activeSpanIndexes: ReadonlySet<number>;
  activePlacement: SplitSide | undefined;
  openComposer: (anchor: LineCommentAnchor, hostChunkId: string) => void;
}

/**
 * The per-row attribute slot DiffRows calls: which rows can host a comment,
 * which are selected, and the pointer and keyboard handlers that turn a
 * gutter pick or drag into a comment anchor. Rebuilt per render, since it
 * closes over the drag in flight.
 */
export function buildRowAttributesFor(
  deps: RowAttributesDeps,
): DiffRowAttributeSlot {
  const {
    chunk,
    rows,
    baseRows,
    baseIndexOf,
    hasExpandedRows,
    pairs,
    rowViews,
    spanOwnerByRow,
    ownerChunkById,
    composerDisabledReason,
    composerDisabledReasonId,
    expandedReasonId,
    drag,
    dragSelection,
    dragIndexes,
    activeRowIds,
    activeSpanIndexes,
    activePlacement,
    openComposer,
  } = deps;

  // GitHub's rule: a range that stays on one side anchors on that side's
  // lines; a range that crosses sides is the unified span between the ends.
  function resolveAnchor(
    startIndex: number,
    startSide: SplitSide | undefined,
    endIndex: number,
    endSide: SplitSide | undefined,
  ): LineCommentAnchor | null {
    const sameSide = startSide !== undefined && startSide === endSide;
    const indexes = sameSide
      ? collectSideIndexes(pairs, startSide, startIndex, endIndex)
      : rangeBetween(startIndex, endIndex);
    const side = sameSide ? startSide : undefined;
    const baseIndexes = mapToBaseIndexes(indexes, baseIndexOf);
    if (baseIndexes !== undefined) {
      return buildLineAnchor(chunk.id, chunk.file, baseRows, baseIndexes, side);
    }

    // A range inside one sibling span anchors to the owner on the rendered
    // rows; row ids then belong to the owner's own table.
    const owner = resolveSpanRangeOwner(
      indexes,
      spanOwnerByRow,
      rowViews,
      ownerChunkById,
    );
    if (owner === undefined) return null;
    const anchor = buildLineAnchor(owner.id, chunk.file, rows, indexes, side);
    if (anchor === null) return null;

    return { ...anchor, rowIds: collectOwnerRowIds(owner, rows, indexes) };
  }

  function finishSelection(rowIndex: number, side?: SplitSide): void {
    // Read-only revision: composer entry is inert (the affordance itself is
    // aria-disabled with the reason, which guards the activation path).
    if (composerDisabledReason !== undefined) return;
    // Expanded context is not in the diff, so no comment can anchor to it.
    if (rowViews[rowIndex]?.isCommentable !== true) return;
    const startIndex = drag.dragStart ?? rowIndex;
    const startSide = drag.dragStart === null ? side : drag.dragSide;
    drag.clearDrag();

    const anchor = resolveAnchor(startIndex, startSide, rowIndex, side);
    if (anchor) openComposer(anchor, chunk.id);
  }

  function isSideSelected(
    view: DiffRowView | undefined,
    index: number,
    side: SplitSide | undefined,
  ): boolean {
    if (side === undefined) return view?.isSelected === true;
    const dragged =
      dragIndexes.has(index) &&
      (dragSelection.placement === undefined ||
        dragSelection.placement === side);
    const active =
      (activeRowIds.has(rowId(chunk.id, index)) ||
        activeSpanIndexes.has(index)) &&
      (activePlacement === undefined || activePlacement === side);

    return dragged || active;
  }

  return function buildRowAttributes(
    line: DiffLine,
    index: number,
    side?: SplitSide,
  ): DiffRowAttributes {
    const view = rowViews[index];
    const outsideDiff = view?.isCommentable !== true;
    const commentable = composerDisabledReason === undefined && !outsideDiff;
    const attributes: DiffRowAttributes = {
      commentable,
      focusable: isSideFocusable(line, side),
      revision: view?.revMark,
      selected: isSideSelected(view, index, side),
      onKeyDown: (event) => {
        if (event.key === "Enter") finishSelection(index, side);
      },
      onMouseDown: (event) => {
        // Range anchoring starts from a comment anchor, the line-number
        // gutter or the +/− sign column, never the code text, which stays
        // natively selectable.
        if (
          !(event.target instanceof Element) ||
          event.target.closest("[data-comment-anchor]") === null
        ) {
          if (side !== undefined) drag.markSelectingSide(side);
          return;
        }
        if (!commentable) return;
        // Anchoring intent: drop any stale text selection, preventDefault
        // keeps it alive otherwise, and it would trip the mouseup
        // suppression guard.
        window.getSelection()?.removeAllRanges();
        event.preventDefault();
        drag.beginDrag(index, side);
      },
      onMouseEnter: () => {
        if (drag.dragStart !== null) drag.moveDrag(index, side);
      },
      onMouseUp: (event) => {
        // A gutter-initiated drag is unambiguous comment intent (the gutter
        // mousedown cleared any selection).
        if (drag.dragStart !== null) {
          finishSelection(index, side);
          return;
        }
        // Plain mouseup: composer entry is anchor-only (gutter or sign
        // column), the code text is reserved for selection, so a
        // double-click word-select never pops the composer. Keyboard entry
        // stays row-level (Enter).
        if (
          !(event.target instanceof Element) ||
          event.target.closest("[data-comment-anchor]") === null
        ) {
          return;
        }
        // A text-selection drag released over the gutter: if either endpoint
        // of a non-collapsed selection touches this table, the reviewer was
        // selecting text.
        const selection = window.getSelection();
        const table = event.currentTarget.closest("table");
        if (
          selection &&
          !selection.isCollapsed &&
          table !== null &&
          (table.contains(selection.anchorNode) ||
            table.contains(selection.focusNode))
        ) {
          return;
        }
        finishSelection(index, side);
      },
    };
    if (composerDisabledReason !== undefined) {
      attributes.describedById = composerDisabledReasonId;
      attributes.disabled = true;
    } else if (outsideDiff) {
      // The reason renders once the table holds spliced rows; a row that
      // arrived in the diff itself carries the state alone.
      if (hasExpandedRows) attributes.describedById = expandedReasonId;
      attributes.disabled = true;
    }

    return attributes;
  };
}
