import { useTranslation } from "react-i18next";
import { useId, useMemo, useRef } from "react";

import type { LineSelection } from "@web/features/review/utils";

import { DiffViews } from "@web/components/DiffRows/types";
import type { ComparisonRun } from "../../../../model/comparison/runs";
import { isFullWidthDiffRow } from "@web/components/DiffRows/utils";
import type { DiffLine } from "@web/utils/diffTokens/types";
import {
  type DiffRowView,
  getDiffRowView,
  resolveStrandedRows,
} from "./diff-row-view";
import {
  EMPTY_EXPANDED_THREADS,
  NO_DIFF,
  NO_EDGES,
  NO_HIDDEN_THREADS,
} from "./consts";
import { buildRowAttributesFor } from "./row-attributes";
import type { DiffTableProps, DiffViewportStyle } from "./types";
import { useDiffTableComments } from "./useDiffTableComments";
import { useDiffTableModel } from "./useDiffTableModel";
import { useDragSelection } from "./useDragSelection";
import { useExpandLanding } from "./useExpandLanding";
import { useRailHover } from "./useRailHover";
import { useComposerHostUnmount } from "./useComposerHostUnmount";
import { useReasonRow } from "./useReasonRow";
import { RowRefKinds } from "../../../../model/expansion/types";
import {
  readReservedCounts,
  readStoredCounts,
  useChunkLayout,
} from "../../../../model/chunk-layout/useChunkLayout";
import { estimateReservedRowsHeight } from "../reading/chunk-height-model";
import { resolveChunkView } from "../utils";
import type { GuestRowReason } from "../../../../model/types";
import {
  buildExpandedRowView,
  buildGuestRowView,
  collectAnchoredIndexes,
  collectGuestReasons,
  resolveSelectionGlyph,
  collectDragBaseIndexes,
  collectOldSideRuns,
  collectThreadLines,
  fillUnifiedSpan,
  groupEdgesByRow,
  placementForAnchor,
  resolveDragSelection,
  resolvePlacement,
  resolveRowRef,
} from "./utils";

/**
 * Everything the table's JSX reads: the row model, the review-flow slice,
 * the drag, the expand landing, the rail hover, and the per-row views and
 * attribute slot built from them. The component keeps the markup only.
 */
export function useDiffTableFacade({
  tokensByRow,
  view: diffView = DiffViews.UNIFIED,
  chunk,
  comparisonView,
  addressedComments,
  conversationThreadsByRow,
  expansion: ownExpansion,
  hiddenThreads = NO_HIDDEN_THREADS,
  fileThreads = NO_HIDDEN_THREADS,
  lineOwners,
  guest,
}: DiffTableProps) {
  const { t } = useTranslation();
  const hiddenThreadLines = useMemo(
    () => collectThreadLines(hiddenThreads),
    [hiddenThreads],
  );
  const baseRows = chunk.diff ?? NO_DIFF;
  // A guest table's rows came from another diff already; it splices nothing.
  const expansion = guest === undefined ? ownExpansion : undefined;
  // Rendered rows are the spliced ones; comments, marks and threads stay
  // keyed on base indexes and translate through `rowRefs`.
  const rows = expansion?.rows ?? baseRows;
  const rowRefs = expansion?.rowRefs;
  const edges = expansion?.edges ?? NO_EDGES;
  const edgesByRow = useMemo(() => groupEdgesByRow(edges), [edges]);
  const hasExpandedRows =
    rowRefs?.some((ref) => ref.kind === RowRefKinds.EXPANDED) === true;
  const model = useDiffTableModel({
    rows,
    chunk,
    lineOwners,
    guest,
    hasExpandedRows,
    diffView,
    tokensByRow,
  });
  // The key is file-qualified because a bare chunk id can collide across
  // diff sources.
  const chunkKey = `${chunk.file}#${chunk.id}`;
  const review = useDiffTableComments({
    chunk,
    chunkKey,
    isGuest: model.isGuest,
    spanOwnerIds: model.spanOwnerIds,
    conversationThreadsByRow,
    fileThreads,
  });
  const tableRef = useRef<HTMLTableElement>(null);
  // Instance-scoped ids for the reasons the disabled rows point at.
  const composerDisabledReasonId = `${useId()}-composer-disabled`;
  const expandedReasonId = `${useId()}-outside-diff`;
  const guestReasonIdBase = useId();
  const reasonIdFor = (reason: GuestRowReason): string =>
    `${guestReasonIdBase}-reason-${reason}`;
  const guestReasons = useMemo(
    () => collectGuestReasons(model.guestByRow),
    [model.guestByRow],
  );
  const reasonRow = useReasonRow(rows);
  const drag = useDragSelection({
    chunkDiff: chunk.diff,
    resolvedView: model.resolvedView,
    tableRef,
  });
  const landing = useExpandLanding({
    rows,
    tableRef,
    announce: review.announce,
    t,
  });
  const rail = useRailHover();
  const oldSideRuns = useMemo(
    () => collectOldSideRuns(comparisonView.runs, baseRows),
    [baseRows, comparisonView.runs],
  );
  const isOldSideRun = (run: ComparisonRun): boolean => oldSideRuns.has(run);
  const { activeCommentAnchor, lineSelection } = review;
  useComposerHostUnmount(activeCommentAnchor !== null, review.cancelComposer);
  const unified = model.resolvedView === DiffViews.UNIFIED;
  const selectionIndexes = useMemo(() => {
    if (lineSelection === null) {
      return EMPTY_EXPANDED_THREADS;
    }
    const anchored = collectAnchoredIndexes(rows, lineSelection);
    return new Set(unified ? fillUnifiedSpan(rows, anchored) : anchored);
  }, [lineSelection, rows, unified]);
  const selectionPlacement =
    lineSelection === null
      ? undefined
      : resolvePlacement(lineSelection.side, lineSelection.startSide);
  const selectionGlyph = resolveSelectionGlyph(
    lineSelection,
    selectionIndexes,
    activeCommentAnchor !== null,
  );
  const selectLines = (selection: LineSelection) => {
    review.selectLines(selection);
    review.announceQuietly(
      selection.startLine === selection.endLine
        ? t("review.announce.lineSelected", { line: selection.startLine })
        : t("review.announce.linesSelected", {
            start: selection.startLine,
            end: selection.endLine,
          }),
    );
  };
  const clearLineSelection = () => {
    review.clearLineSelection();
    review.announceQuietly(t("review.announce.lineSelectionCleared"));
  };
  const activeSpanIndexes = useMemo(() => {
    if (
      activeCommentAnchor === null ||
      activeCommentAnchor.chunkId === chunk.id
    ) {
      return EMPTY_EXPANDED_THREADS;
    }
    return new Set(
      collectAnchoredIndexes(rows, activeCommentAnchor).filter((index) =>
        model.spanOwnerByRow.has(index),
      ),
    );
  }, [activeCommentAnchor, chunk.id, rows, model.spanOwnerByRow]);

  const dragSelection = resolveDragSelection(model.pairs, drag.inFlight);
  const dragIndexes = new Set(dragSelection.indexes);
  const dragBaseIndexes = collectDragBaseIndexes(dragIndexes, rowRefs);
  const activePlacement =
    activeCommentAnchor === null
      ? undefined
      : placementForAnchor(activeCommentAnchor);
  const activeRowIds = new Set(activeCommentAnchor?.rowIds ?? []);
  const strandedRowIds = resolveStrandedRows(chunk, review.comments);
  const overlayActive = comparisonView.runs.length > 0;

  function buildRowView(
    line: DiffLine,
    index: number,
  ): DiffRowView | undefined {
    if (isFullWidthDiffRow(line)) {
      return undefined;
    }
    if (model.isGuest) {
      return buildGuestRowView({
        line,
        index,
        hostId: chunk.id,
        resolution: model.guestByRow[index],
        comments: review.spanComments,
        activeCommentAnchor,
        dragIndexes,
        activeIndexes: activeSpanIndexes,
      });
    }
    const ref = resolveRowRef(rowRefs, index);
    if (ref.kind === RowRefKinds.EXPANDED) {
      return buildExpandedRowView({
        line,
        index,
        hostId: chunk.id,
        owner: model.spanOwnerByRow.get(index),
        commentable: model.commentableSpanRows.has(index),
        comments: review.spanComments,
        activeCommentAnchor,
        dragIndexes,
        activeIndexes: activeSpanIndexes,
      });
    }
    return getDiffRowView({
      line,
      index: ref.baseIndex,
      chunk,
      overlayActive,
      comparisonView,
      comments: review.comments,
      addressedComments,
      dragIndexes: dragBaseIndexes,
      activeRowIds,
      activeCommentAnchor,
      strandedRowIds,
    });
  }
  const rowViews = rows.map(buildRowView);

  const buildRowAttributes = buildRowAttributesFor({
    chunk,
    rows,
    baseRows,
    rowRefs,
    hasExpandedRows,
    pairs: model.pairs,
    rowViews,
    spanOwnerByRow: model.spanOwnerByRow,
    ownerChunkById: model.ownerChunkById,
    guest,
    reasonIdFor,
    openReasonRowId: reasonRow.openReasonRowId,
    toggleReasonRow: reasonRow.toggleReasonRow,
    closeReasonRow: reasonRow.closeReasonRow,
    composerDisabledReason: review.composerDisabledReason,
    composerDisabledReasonId,
    expandedReasonId,
    drag,
    dragSelection,
    dragIndexes,
    activeRowIds,
    activeSpanIndexes,
    activePlacement,
    composerOpen: activeCommentAnchor !== null,
    openComposer: review.openComposer,
    selectionIndexes,
    selectionPlacement,
    reanchorArmed: review.reanchorArmed,
    reanchorElsewhere: review.reanchorElsewhere,
    selectLines,
    clearLineSelection,
  });
  const handleToggleConversationThread = (threadId: number) =>
    review.toggleConversationThread(chunkKey, threadId);

  // A card waiting on its code draws skeleton rows in the view its table
  // will draw, sized from the stored counts. The reserved height doubles as
  // the off-screen intrinsic size, so a card the skeleton measured measures
  // the same once its code lands.
  const layout = useChunkLayout();
  const reserved = readReservedCounts(layout, chunk);
  const storedCounts = readStoredCounts(layout?.counts, chunk);
  const skeletonView = resolveChunkView(diffView, chunk, guest !== undefined);
  const diffRows = model.split ? model.pairs.length : rows.length;
  const viewportStyle: DiffViewportStyle = { "--diff-rows": diffRows };
  if (storedCounts !== undefined) {
    const reservedHeight = estimateReservedRowsHeight(
      storedCounts,
      model.resolvedView,
    );
    viewportStyle["--diff-reserved-size"] = `${String(reservedHeight)}px`;
  }

  return {
    t,
    rows,
    reserved,
    skeletonView,
    viewportStyle,
    rowRefs,
    hasExpandedRows,
    edgesByRow,
    hiddenThreadLines,
    model,
    review,
    tableRef,
    composerDisabledReasonId,
    expandedReasonId,
    guestReasons,
    reasonIdFor,
    openReasonRowId: reasonRow.openReasonRowId,
    closeReasonRow: reasonRow.closeReasonRow,
    rowViews,
    overlayActive,
    lineSelection,
    selectionGlyph,
    isOldSideRun,
    buildRowAttributes,
    handleExpanded: landing.handleExpanded,
    handleAbandoned: landing.handleAbandoned,
    railHover: rail.railHover,
    handleRailEnter: rail.handleRailEnter,
    handleRailLeave: rail.handleRailLeave,
    handleToggleConversationThread,
  };
}
