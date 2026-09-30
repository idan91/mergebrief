import type {
  LineCommentAnchor,
  LineSelection,
} from "@web/features/review/utils";
import { rowId } from "@web/features/review/utils";
import {
  type DiffRowAttributeSlot,
  type DiffRowAttributes,
  DiffRowPicks,
  type SplitRow,
  type SplitSide,
  SplitSides,
} from "@web/components/DiffRows/types";
import { rangeBetween } from "@web/utils/collections";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { BriefChunk, GuestRowReason } from "../../../types";
import type { GuestRowsInput } from "../../../utils/guest-rows";
import type { DiffRowView } from "./diffRowView";
import { REANCHOR_HINT_ID } from "../consts";
import { COMMENT_ANCHOR_SELECTOR, SELECT_ANCHOR_SELECTOR } from "./consts";
import { type DragMode, DragModes, type DragSelection } from "./types";
import {
  buildGuestLineSelection,
  buildLineAnchor,
  buildLineSelection,
  collectGuestRowIds,
  collectNewSideIndexes,
  collectOwnerRowIds,
  compareAscending,
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
  /** Present when every row is a guest row: anchors and selections name the owner. */
  guest: GuestRowsInput | undefined;
  /** The id of the always-rendered text stating a guest row's reason. */
  reasonIdFor: (reason: GuestRowReason) => string;
  openReasonRowId: string | null;
  toggleReasonRow: (rowId: string, opener: HTMLElement) => void;
  closeReasonRow: () => void;
  composerDisabledReason: string | undefined;
  composerDisabledReasonId: string;
  expandedReasonId: string;
  drag: {
    dragStart: number | null;
    dragSide: SplitSide | undefined;
    dragMode: DragMode | undefined;
    beginDrag: (
      index: number,
      side: SplitSide | undefined,
      mode: DragMode,
    ) => void;
    moveDrag: (index: number, side: SplitSide | undefined) => void;
    clearDrag: () => void;
    markSelectingSide: (side: SplitSide) => void;
  };
  dragSelection: DragSelection;
  dragIndexes: ReadonlySet<number>;
  activeRowIds: ReadonlySet<string>;
  activeSpanIndexes: ReadonlySet<number>;
  activePlacement: SplitSide | undefined;
  composerOpen: boolean;
  openComposer: (anchor: LineCommentAnchor, hostChunkId: string) => void;
  /** Rendered indexes the live selection covers in this table, if it is here. */
  selectionIndexes: ReadonlySet<number>;
  selectionPlacement: SplitSide | undefined;
  /** A draft waits for its lines: every row pick places it, none selects. */
  reanchorArmed: boolean;
  /** A draft from another file waits for its lines: these rows stay inert. */
  reanchorElsewhere: boolean;
  selectLines: (selection: LineSelection) => void;
  clearLineSelection: () => void;
}

const BUTTON_SELECTOR = "button";
/** Either gutter anchor: the line numbers or the sign. */
const ANCHOR_SELECTOR = `${SELECT_ANCHOR_SELECTOR}, ${COMMENT_ANCHOR_SELECTOR}`;

function isInside(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/** A non-collapsed text selection with an end inside this row's table. */
function hasTextSelectionIn(row: Element): boolean {
  const selection = window.getSelection();
  const table = row.closest("table");
  if (selection === null || selection.isCollapsed || table === null) {
    return false;
  }

  return (
    table.contains(selection.anchorNode) || table.contains(selection.focusNode)
  );
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
    guest,
    reasonIdFor,
    openReasonRowId,
    toggleReasonRow,
    closeReasonRow,
    composerDisabledReason,
    composerDisabledReasonId,
    expandedReasonId,
    drag,
    dragSelection,
    dragIndexes,
    activeRowIds,
    activeSpanIndexes,
    activePlacement,
    composerOpen,
    openComposer,
    selectionIndexes,
    selectionPlacement,
    reanchorArmed,
    reanchorElsewhere,
    selectLines,
    clearLineSelection,
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
    if (guest !== undefined) {
      return resolveGuestAnchor(indexes, guest);
    }
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

  // A guest range comments on its head lines only, on the new side: a
  // deleted row between them is a baseline's and drops out of the range.
  function resolveGuestAnchor(
    indexes: number[],
    guestInput: GuestRowsInput,
  ): LineCommentAnchor | null {
    const picked = collectNewSideIndexes(rows, indexes);
    const owner = resolveSpanRangeOwner(
      picked,
      spanOwnerByRow,
      rowViews,
      ownerChunkById,
    );
    if (owner === undefined) {
      return null;
    }
    const anchor = buildLineAnchor(
      owner.id,
      chunk.file,
      rows,
      picked,
      SplitSides.RIGHT,
    );
    if (anchor === null) {
      return null;
    }

    return {
      ...anchor,
      rowIds: collectGuestRowIds(picked, guestInput.originOf, owner.id),
    };
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

  /** The side a gesture on `side` shares with the selection; none in unified. */
  function resolveSelectionSide(
    side: SplitSide | undefined,
  ): SplitSide | undefined {
    return side === undefined ? undefined : selectionPlacement;
  }

  /**
   * A gesture inside the live selection comments on all of it, on the side
   * the selection names rather than the side the rows would suggest; in
   * unified view that is the rows' own span. A selection over rows outside
   * the diff has nothing to comment on.
   */
  function openComposerOnSelection(side: SplitSide | undefined): void {
    if (composerDisabledReason !== undefined) {
      return;
    }
    const selected = [...selectionIndexes].toSorted(compareAscending);
    const picked =
      guest === undefined ? selected : collectNewSideIndexes(rows, selected);
    const first = picked[0];
    const last = picked.at(-1);
    if (first === undefined || last === undefined) {
      return;
    }
    if (picked.some((index) => rowViews[index]?.isCommentable !== true)) {
      return;
    }
    const placement = resolveSelectionSide(side);
    const baseIndexes =
      guest === undefined ? mapToBaseIndexes(picked, baseIndexOf) : undefined;
    const anchor =
      baseIndexes === undefined
        ? resolveAnchor(first, placement, last, placement)
        : buildLineAnchor(
            chunk.id,
            chunk.file,
            baseRows,
            baseIndexes,
            placement,
          );
    if (anchor !== null) {
      openComposer(anchor, chunk.id);
    }
  }

  function buildSelection(
    startIndex: number,
    startSide: SplitSide | undefined,
    endIndex: number,
    endSide: SplitSide | undefined,
  ): LineSelection | null {
    const sameSide = startSide !== undefined && startSide === endSide;
    const indexes = sameSide
      ? collectSideIndexes(pairs, startSide, startIndex, endIndex)
      : rangeBetween(startIndex, endIndex);
    const side = sameSide ? startSide : undefined;
    if (guest !== undefined) {
      const owner = resolveSpanRangeOwner(
        collectNewSideIndexes(rows, indexes),
        spanOwnerByRow,
        rowViews,
        ownerChunkById,
      );
      if (owner === undefined) {
        return null;
      }
      return buildGuestLineSelection(
        owner.id,
        chunk.file,
        rows,
        indexes,
        guest.originOf,
      );
    }

    return buildLineSelection(
      chunk.id,
      chunk.file,
      rows,
      indexes,
      side,
      baseIndexOf,
    );
  }

  function finishLineSelection(rowIndex: number, side?: SplitSide): void {
    const startIndex = drag.dragStart ?? rowIndex;
    const startSide = drag.dragStart === null ? side : drag.dragSide;
    drag.clearDrag();

    const selection = buildSelection(startIndex, startSide, rowIndex, side);
    if (selection !== null) selectLines(selection);
  }

  /** Shift: the range runs from the selection's first row to this one. */
  function extendLineSelection(rowIndex: number, side?: SplitSide): void {
    const first = [...selectionIndexes].toSorted(compareAscending)[0];
    if (first === undefined) {
      finishLineSelection(rowIndex, side);
      return;
    }
    const startSide = resolveSelectionSide(side) ?? side;
    const selection = buildSelection(first, startSide, rowIndex, side);
    if (selection !== null) selectLines(selection);
  }

  function isLineSelected(index: number, side: SplitSide | undefined): boolean {
    if (composerOpen || !selectionIndexes.has(index)) return false;
    if (side === undefined || selectionPlacement === undefined) return true;

    return selectionPlacement === side;
  }

  function isSideSelected(
    view: DiffRowView | undefined,
    index: number,
    side: SplitSide | undefined,
  ): boolean {
    if (isLineSelected(index, side)) return true;
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

  /**
   * A guest row GitHub cannot hold a comment on: focusable, described by
   * its reason, and Enter, Space or a primary click on the line numbers or
   * the sign toggles the reason row in the composer slot. The line numbers
   * still start and end a line selection drag, as on a commentable row, so
   * a range across an inert row keeps its head lines; the code text stays
   * reserved for text selection. Escape closes an open reason row, else
   * clears a live selection.
   */
  function buildReasonRowAttributes(
    view: DiffRowView,
    reason: GuestRowReason,
    line: DiffLine,
    index: number,
    side: SplitSide | undefined,
  ): DiffRowAttributes {
    const isOpen = openReasonRowId === view.id;
    const toggle = (opener: HTMLElement) => toggleReasonRow(view.id, opener);
    const reasonId = reasonIdFor(reason);
    const attributes: DiffRowAttributes = {
      commentable: false,
      disabled: true,
      describedById:
        composerDisabledReason === undefined
          ? reasonId
          : `${composerDisabledReasonId} ${reasonId}`,
      focusable: isSideFocusable(line, side),
      revision: view.revMark,
      selected: false,
      onKeyDown: (event) => {
        if (isInside(event.target, BUTTON_SELECTOR)) {
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          toggle(event.currentTarget);
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          if (event.shiftKey) {
            extendLineSelection(index, side);
          } else {
            toggle(event.currentTarget);
          }
          return;
        }
        if (event.key !== "Escape") {
          return;
        }
        if (isOpen) {
          event.stopPropagation();
          closeReasonRow();
        } else if (!composerOpen && selectionIndexes.size > 0) {
          event.stopPropagation();
          clearLineSelection();
        }
      },
      onMouseDown: (event) => {
        if (isInside(event.target, BUTTON_SELECTOR)) {
          return;
        }
        if (!isInside(event.target, ANCHOR_SELECTOR)) {
          if (selectionIndexes.size > 0) {
            clearLineSelection();
          }
          return;
        }
        window.getSelection()?.removeAllRanges();
        event.preventDefault();
        if (!isInside(event.target, SELECT_ANCHOR_SELECTOR)) {
          return;
        }
        if (event.shiftKey) {
          extendLineSelection(index, side);
          return;
        }
        drag.beginDrag(index, side, DragModes.SELECT);
      },
      onMouseEnter: () => {
        if (drag.dragStart !== null) {
          drag.moveDrag(index, side);
        }
      },
      onMouseUp: (event) => {
        if (isInside(event.target, BUTTON_SELECTOR)) {
          return;
        }
        // A press and release on this row's own numbers is a click, which
        // toggles; a drag from elsewhere finishes as the drag it is, and a
        // Shift click already extended the selection on the press.
        if (drag.dragStart !== null && drag.dragStart !== index) {
          if (drag.dragMode === DragModes.SELECT) {
            finishLineSelection(index, side);
          } else {
            finishSelection(index, side);
          }
          return;
        }
        drag.clearDrag();
        if (event.button !== 0 || event.shiftKey) {
          return;
        }
        if (!isInside(event.target, ANCHOR_SELECTOR)) {
          return;
        }
        if (hasTextSelectionIn(event.currentTarget)) {
          return;
        }
        toggle(event.currentTarget);
      },
    };
    return attributes;
  }

  return function buildRowAttributes(
    line: DiffLine,
    index: number,
    side?: SplitSide,
  ): DiffRowAttributes {
    const view = rowViews[index];
    if (view?.disabledReason !== undefined) {
      return buildReasonRowAttributes(
        view,
        view.disabledReason,
        line,
        index,
        side,
      );
    }
    if (reanchorElsewhere) {
      return {
        describedById: REANCHOR_HINT_ID,
        disabled: true,
        focusable: isSideFocusable(line, side),
        pick: DiffRowPicks.UNAVAILABLE,
        revision: view?.revMark,
        selected: false,
      };
    }
    const outsideDiff = view?.isCommentable !== true;
    const commentable = composerDisabledReason === undefined && !outsideDiff;
    const attributes: DiffRowAttributes = {
      commentable,
      focusable: isSideFocusable(line, side),
      revision: view?.revMark,
      selected: isSideSelected(view, index, side),
      onKeyDown: (event) => {
        // A button inside the row (the rail jump, a link glyph) owns its
        // own keys.
        if (isInside(event.target, BUTTON_SELECTOR)) {
          return;
        }
        if (event.key === "Enter") {
          if (isLineSelected(index, side) && !reanchorArmed) {
            openComposerOnSelection(side);
          } else {
            finishSelection(index, side);
          }
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          if (reanchorArmed) {
            finishSelection(index, side);
          } else if (event.shiftKey) {
            extendLineSelection(index, side);
          } else {
            finishLineSelection(index, side);
          }
          return;
        }
        // The row owns Escape only while it has a selection to clear and no
        // composer is open, so the composer's own Escape and the screen's
        // (focus mode) still reach the window.
        if (
          event.key === "Escape" &&
          !composerOpen &&
          selectionIndexes.size > 0
        ) {
          event.stopPropagation();
          clearLineSelection();
        }
      },
      onMouseDown: (event) => {
        // A button inside the row owns its gesture.
        if (isInside(event.target, BUTTON_SELECTOR)) {
          return;
        }
        // The line numbers start a selection, the +/− sign a comment range,
        // and the code text stays natively selectable and drops a live
        // selection.
        if (isInside(event.target, SELECT_ANCHOR_SELECTOR)) {
          window.getSelection()?.removeAllRanges();
          event.preventDefault();
          if (reanchorArmed) {
            drag.beginDrag(index, side, DragModes.COMMENT);
            return;
          }
          if (event.shiftKey) {
            extendLineSelection(index, side);
            return;
          }
          drag.beginDrag(index, side, DragModes.SELECT);
          return;
        }
        if (!isInside(event.target, COMMENT_ANCHOR_SELECTOR)) {
          if (selectionIndexes.size > 0) clearLineSelection();
          if (side !== undefined) drag.markSelectingSide(side);
          return;
        }
        if (!commentable) return;
        // Anchoring intent: drop any stale text selection, preventDefault
        // keeps it alive otherwise, and it would trip the mouseup
        // suppression guard.
        window.getSelection()?.removeAllRanges();
        event.preventDefault();
        // Inside the live selection the click is a comment on all of it;
        // the mouseup resolves it, no drag begins.
        if (isLineSelected(index, side)) return;
        drag.beginDrag(index, side, DragModes.COMMENT);
      },
      onMouseEnter: () => {
        if (drag.dragStart !== null) drag.moveDrag(index, side);
      },
      onMouseUp: (event) => {
        // An anchor-initiated drag is unambiguous intent (the mousedown
        // cleared any text selection): a selection from the numbers, a
        // comment from the sign.
        if (drag.dragStart !== null) {
          if (drag.dragMode === DragModes.SELECT) {
            finishLineSelection(index, side);
          } else {
            finishSelection(index, side);
          }
          return;
        }
        // A release on a button with no drag in flight is the button's click.
        if (isInside(event.target, BUTTON_SELECTOR)) {
          return;
        }
        // Plain mouseup: composer entry is sign-only, the code text is
        // reserved for selection, so a double-click word-select never pops
        // the composer. Keyboard entry stays row-level (Enter).
        if (!isInside(event.target, COMMENT_ANCHOR_SELECTOR)) return;
        // A text-selection drag released over the gutter: if either endpoint
        // of a non-collapsed selection touches this table, the reviewer was
        // selecting text.
        if (hasTextSelectionIn(event.currentTarget)) {
          return;
        }
        if (isLineSelected(index, side)) {
          openComposerOnSelection(side);
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
    if (reanchorArmed && commentable) {
      attributes.pick = DiffRowPicks.AVAILABLE;
    }

    return attributes;
  };
}
