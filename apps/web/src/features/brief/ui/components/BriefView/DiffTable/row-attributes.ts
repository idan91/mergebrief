import type { KeyboardEvent, MouseEvent, SyntheticEvent } from "react";
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
import type { RowRef } from "../../../../model/expansion/types";
import type { BriefChunk, GuestRowReason } from "../../../../model/types";
import type { GuestRowsInput } from "../../../utils/guest-rows";
import type { DiffRowView } from "./diffRowView";
import { REANCHOR_HINT_ID } from "../consts";
import { COMMENT_ANCHOR_SELECTOR, SELECT_ANCHOR_SELECTOR } from "./consts";
import { deriveRowIntent } from "./gestures";
import {
  type DragMode,
  DragModes,
  type DragSelection,
  type LineRowState,
  type RangeDrag,
  type ReasonRowState,
  type RowDragState,
  type RowEffect,
  RowEffects,
  type RowGesture,
  RowGestureKinds,
  type RowMouseEnter,
  type RowState,
  RowStateKinds,
  type RowTarget,
  RowTargets,
} from "./types";
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
  rowRefs: readonly RowRef[] | undefined;
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
    inFlight: RangeDrag | undefined;
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

/** One end of a range: a rendered row, and its side in split view. */
interface RangeEnd {
  index: number;
  side: SplitSide | undefined;
}

/** The row a gesture landed on. */
interface RowContext extends RangeEnd {
  view: DiffRowView | undefined;
}

type RowEffectRunner = (row: RowContext, opener: HTMLElement) => void;

type GestureHandlers = Required<
  Pick<
    DiffRowAttributes,
    "onKeyDown" | "onMouseDown" | "onMouseEnter" | "onMouseUp"
  >
>;

const MOUSE_ENTER: RowMouseEnter = { kind: RowGestureKinds.MOUSE_ENTER };

function isInside(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/** A row's own button wins, then the numbers, then the sign. */
function readRowTarget(target: EventTarget | null): RowTarget {
  if (isInside(target, BUTTON_SELECTOR)) {
    return RowTargets.BUTTON;
  }
  if (isInside(target, SELECT_ANCHOR_SELECTOR)) {
    return RowTargets.NUMBERS;
  }
  if (isInside(target, COMMENT_ANCHOR_SELECTOR)) {
    return RowTargets.SIGN;
  }

  return RowTargets.CODE;
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

function readKeyGesture(event: KeyboardEvent<HTMLElement>): RowGesture {
  return {
    kind: RowGestureKinds.KEY_DOWN,
    key: event.key,
    shift: event.shiftKey,
    target: readRowTarget(event.target),
  };
}

function readPressGesture(event: MouseEvent<HTMLElement>): RowGesture {
  return {
    kind: RowGestureKinds.MOUSE_DOWN,
    shift: event.shiftKey,
    target: readRowTarget(event.target),
  };
}

function readReleaseGesture(event: MouseEvent<HTMLElement>): RowGesture {
  return {
    kind: RowGestureKinds.MOUSE_UP,
    primary: event.button === 0,
    shift: event.shiftKey,
    target: readRowTarget(event.target),
    textSelected: hasTextSelectionIn(event.currentTarget),
  };
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
    rowRefs,
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
    const baseIndexes = mapToBaseIndexes(indexes, rowRefs);
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
    if (owner === undefined) {
      return null;
    }
    const anchor = buildLineAnchor(owner.id, chunk.file, rows, indexes, side);
    if (anchor === null) {
      return null;
    }

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

  /** Where a range ending on this row starts: the drag's start, else here. */
  function resolveRangeStart(
    rowIndex: number,
    side: SplitSide | undefined,
  ): RangeEnd {
    const inFlight = drag.inFlight;
    if (inFlight === undefined) {
      return { index: rowIndex, side };
    }

    return { index: inFlight.start, side: inFlight.startSide };
  }

  function finishSelection(rowIndex: number, side?: SplitSide): void {
    // Read-only revision: composer entry is inert (the affordance itself is
    // aria-disabled with the reason, which guards the activation path).
    if (composerDisabledReason !== undefined) {
      return;
    }
    // Expanded context is not in the diff, so no comment can anchor to it.
    if (rowViews[rowIndex]?.isCommentable !== true) {
      return;
    }
    const start = resolveRangeStart(rowIndex, side);
    drag.clearDrag();

    const anchor = resolveAnchor(start.index, start.side, rowIndex, side);
    if (anchor) {
      openComposer(anchor, chunk.id);
    }
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
      guest === undefined ? mapToBaseIndexes(picked, rowRefs) : undefined;
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
      rowRefs,
    );
  }

  function finishLineSelection(rowIndex: number, side?: SplitSide): void {
    const start = resolveRangeStart(rowIndex, side);
    drag.clearDrag();

    const selection = buildSelection(start.index, start.side, rowIndex, side);
    if (selection !== null) {
      selectLines(selection);
    }
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
    if (selection !== null) {
      selectLines(selection);
    }
  }

  function isLineSelected(index: number, side: SplitSide | undefined): boolean {
    if (composerOpen || !selectionIndexes.has(index)) {
      return false;
    }
    if (side === undefined || selectionPlacement === undefined) {
      return true;
    }

    return selectionPlacement === side;
  }

  function isSideSelected(
    view: DiffRowView | undefined,
    index: number,
    side: SplitSide | undefined,
  ): boolean {
    if (isLineSelected(index, side)) {
      return true;
    }
    if (side === undefined) {
      return view?.isSelected === true;
    }
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

  function readDragState(index: number): RowDragState | undefined {
    const inFlight = drag.inFlight;
    if (inFlight === undefined) {
      return undefined;
    }

    return { mode: inFlight.mode, startedHere: inFlight.start === index };
  }

  function readLineState(row: RowContext, commentable: boolean): LineRowState {
    return {
      kind: RowStateKinds.LINE,
      drag: readDragState(row.index),
      composerOpen,
      hasSelection: selectionIndexes.size > 0,
      reanchorArmed,
      lineSelected: isLineSelected(row.index, row.side),
      commentable,
      split: row.side !== undefined,
    };
  }

  function readReasonState(
    row: RowContext,
    reasonOpen: boolean,
  ): ReasonRowState {
    return {
      kind: RowStateKinds.REASON,
      drag: readDragState(row.index),
      composerOpen,
      hasSelection: selectionIndexes.size > 0,
      reasonOpen,
    };
  }

  const effectRunners: Record<RowEffect, RowEffectRunner> = {
    [RowEffects.DROP_TEXT_SELECTION]: () => {
      window.getSelection()?.removeAllRanges();
    },
    [RowEffects.BEGIN_SELECT_DRAG]: ({ index, side }) => {
      drag.beginDrag(index, side, DragModes.SELECT);
    },
    [RowEffects.BEGIN_COMMENT_DRAG]: ({ index, side }) => {
      drag.beginDrag(index, side, DragModes.COMMENT);
    },
    [RowEffects.MOVE_DRAG]: ({ index, side }) => {
      drag.moveDrag(index, side);
    },
    [RowEffects.CLEAR_DRAG]: () => {
      drag.clearDrag();
    },
    [RowEffects.MARK_SELECTING_SIDE]: ({ side }) => {
      if (side !== undefined) {
        drag.markSelectingSide(side);
      }
    },
    [RowEffects.SELECT_RANGE]: ({ index, side }) => {
      finishLineSelection(index, side);
    },
    [RowEffects.EXTEND_SELECTION]: ({ index, side }) => {
      extendLineSelection(index, side);
    },
    [RowEffects.CLEAR_SELECTION]: () => {
      clearLineSelection();
    },
    [RowEffects.COMMENT_RANGE]: ({ index, side }) => {
      finishSelection(index, side);
    },
    [RowEffects.COMMENT_SELECTION]: ({ side }) => {
      openComposerOnSelection(side);
    },
    [RowEffects.TOGGLE_REASON]: ({ view }, opener) => {
      if (view !== undefined) {
        toggleReasonRow(view.id, opener);
      }
    },
    [RowEffects.CLOSE_REASON]: () => {
      closeReasonRow();
    },
  };

  function handleGesture(
    gesture: RowGesture,
    state: RowState,
    row: RowContext,
    event: SyntheticEvent<HTMLElement>,
  ): void {
    const intent = deriveRowIntent(gesture, state);
    if (intent.preventDefault) {
      event.preventDefault();
    }
    if (intent.stopPropagation) {
      event.stopPropagation();
    }
    for (const effect of intent.effects) {
      effectRunners[effect](row, event.currentTarget);
    }
  }

  /** A row's pointer and key handlers; the state is read as a gesture lands. */
  function buildGestureHandlers(
    row: RowContext,
    readState: () => RowState,
  ): GestureHandlers {
    return {
      onKeyDown: (event) => {
        handleGesture(readKeyGesture(event), readState(), row, event);
      },
      onMouseDown: (event) => {
        handleGesture(readPressGesture(event), readState(), row, event);
      },
      onMouseEnter: (event) => {
        handleGesture(MOUSE_ENTER, readState(), row, event);
      },
      onMouseUp: (event) => {
        handleGesture(readReleaseGesture(event), readState(), row, event);
      },
    };
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
    const row: RowContext = { index, side, view };
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
      ...buildGestureHandlers(row, () => readReasonState(row, isOpen)),
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
    const row: RowContext = { index, side, view };
    const attributes: DiffRowAttributes = {
      commentable,
      focusable: isSideFocusable(line, side),
      revision: view?.revMark,
      selected: isSideSelected(view, index, side),
      ...buildGestureHandlers(row, () => readLineState(row, commentable)),
    };
    if (composerDisabledReason !== undefined) {
      attributes.describedById = composerDisabledReasonId;
      attributes.disabled = true;
    } else if (outsideDiff) {
      // The reason renders once the table holds spliced rows; a row that
      // arrived in the diff itself carries the state alone.
      if (hasExpandedRows) {
        attributes.describedById = expandedReasonId;
      }
      attributes.disabled = true;
    }
    if (reanchorArmed && commentable) {
      attributes.pick = DiffRowPicks.AVAILABLE;
    }

    return attributes;
  };
}
