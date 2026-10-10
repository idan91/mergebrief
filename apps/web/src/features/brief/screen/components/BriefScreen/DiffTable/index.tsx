import type { ReactNode } from "react";

import type { DigestThreadRow } from "@web/features/conversation/utils";
import { DiffRows } from "@web/components/DiffRows";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { type DiffLine, DiffLineKinds } from "@web/utils/diffTokens/types";
import { ComparisonCallout } from "./ComparisonCallout";
import {
  COMMENT_ANCHOR_ATTRIBUTES,
  GUEST_REASON_KEYS,
  NO_HIDDEN_THREADS,
  SELECT_ANCHOR_ATTRIBUTES,
} from "./consts";
import { DiffTableHead } from "./DiffTableHead";
import styles from "./DiffTable.module.scss";
import { ExpandControl } from "./ExpandControl";
import { ExpandRow } from "./ExpandRow";
import { RevisionGutterCell } from "./RevisionGutterCell";
import { RevisionTag } from "./RevisionTag";
import { LineLinkButton } from "./LineLinkButton";
import { SiblingSpanHeader } from "./SiblingSpanHeader";
import type { DiffTableProps, DiffViewportStyle } from "./types";
import { UnderRows } from "./UnderRows";
import { useDiffTableFacade } from "./useDiffTableFacade";
import {
  deriveSideRail,
  resolveBeforeRowEdges,
  resolveHunkRowEdges,
  resolveSpanLines,
  showsThreadOnGuestRow,
  showsThreadOnRow,
} from "./utils";
import { RailSides } from "./types";
import type { DiffSide } from "types/comments";

export function DiffTable(props: DiffTableProps) {
  const {
    chunk,
    comparisonSource,
    comparisonSkipReason,
    conversationThreadsByRow,
    conversationComposer,
    reviewCommentLabel,
    tokensByRow,
    tokensPending = false,
    fileThreads = NO_HIDDEN_THREADS,
    lineOwners,
    jumpToLine,
    deriveChunkUrl,
    guest,
  } = props;
  const table = useDiffTableFacade(props);
  const { t, rows, model, review, rowViews, railHover } = table;

  if (!chunk.diff || chunk.diff.length === 0) {
    return (
      <div className={styles["metadataDiff"]}>
        <span>{t("brief.diff.unavailable")}</span>
        <p>{t("brief.diff.noMatchingRaw")}</p>
      </div>
    );
  }

  function buildExpandRow(
    row: DiffLine,
    index: number,
    columnCount: number,
  ): ReactNode {
    if (row.kind !== DiffLineKinds.HUNK) {
      return null;
    }
    const own = resolveHunkRowEdges(table.edgesByRow, index);
    if (own.length === 0) {
      return null;
    }
    return (
      <ExpandControl
        columnCount={columnCount}
        edges={own}
        header={row.content}
        hiddenThreadLines={table.hiddenThreadLines}
        onAbandoned={table.handleAbandoned}
        onExpanded={table.handleExpanded}
        path={chunk.file}
      />
    );
  }

  function buildSpanHeader(index: number, columnCount: number): ReactNode {
    const frame = model.spanStarts.get(index);
    const owner =
      frame === undefined ? undefined : lineOwners?.owners.get(frame.owner);
    if (frame === undefined || owner === undefined) {
      return null;
    }
    const lines = resolveSpanLines(rows, frame.rows);
    return (
      <SiblingSpanHeader
        columnCount={columnCount}
        deriveChunkUrl={deriveChunkUrl}
        from={lines.from}
        jumpToLine={jumpToLine}
        owner={owner}
        side={lines.side}
        to={lines.to}
      />
    );
  }

  function buildRowBefore(
    row: DiffLine,
    index: number,
    columnCount: number,
  ): ReactNode {
    const header = buildSpanHeader(index, columnCount);
    const own = resolveBeforeRowEdges(
      table.edgesByRow,
      index,
      row,
      rows[index - 1],
    );
    if (header === null && own.length === 0) {
      return null;
    }
    // The control belongs to the gap above the row, the header to the rows
    // below it.
    return (
      <>
        {own.length === 0 ? null : (
          <ExpandRow
            columnCount={columnCount}
            edges={own}
            hiddenThreadLines={table.hiddenThreadLines}
            onAbandoned={table.handleAbandoned}
            onExpanded={table.handleExpanded}
            path={chunk.file}
          />
        )}
        {header}
      </>
    );
  }

  function buildTrailingRow(columnCount: number): ReactNode {
    const own = table.edgesByRow.get(rows.length) ?? [];
    if (own.length === 0) {
      return null;
    }
    return (
      <ExpandRow
        columnCount={columnCount}
        edges={own}
        hiddenThreadLines={table.hiddenThreadLines}
        onAbandoned={table.handleAbandoned}
        onExpanded={table.handleExpanded}
        path={chunk.file}
      />
    );
  }

  function buildGutterCell(_line: DiffLine, index: number): ReactNode {
    const partner = model.pairPartners.get(index);
    const other = partner === undefined ? undefined : rowViews[partner];
    const rail = deriveSideRail({
      side: RailSides.EDGE,
      own: rowViews[index],
      other,
      hasSeam: model.split,
      touchesOld: table.isOldSideRun,
    });
    return (
      <RevisionGutterCell
        run={table.overlayActive ? rail.run : undefined}
        isStart={rail.isStart}
        isEnd={rail.isEnd}
        chunk={chunk}
        onRailEnter={table.handleRailEnter}
        onRailLeave={table.handleRailLeave}
        spanned={model.spannedRows.has(index)}
      />
    );
  }

  /** The seam speaks for the new side: `index` is the pair's lead, the right cell when it has one. */
  function buildSeamCell(_line: DiffLine, index: number): ReactNode {
    const partner = model.pairPartners.get(index);
    const rightView = rowViews[index];
    const rail = deriveSideRail({
      side: RailSides.SEAM,
      own: rightView,
      other: partner === undefined ? undefined : rowViews[partner],
      hasSeam: true,
      touchesOld: table.isOldSideRun,
    });
    return (
      <RevisionGutterCell
        run={table.overlayActive ? rail.run : undefined}
        isStart={rail.isStart}
        isEnd={rail.isEnd}
        chunk={chunk}
        onRailEnter={table.handleRailEnter}
        onRailLeave={table.handleRailLeave}
        placement={RailSides.SEAM}
      />
    );
  }

  function buildNumberCellContent(
    _line: DiffLine,
    index: number,
    side: DiffSide,
  ): ReactNode {
    const glyph = table.selectionGlyph;
    if (glyph === undefined || table.lineSelection === null) {
      return null;
    }
    if (glyph.index !== index || glyph.side !== side) {
      return null;
    }
    return <LineLinkButton selection={table.lineSelection} />;
  }

  function buildCodeTrailer(_line: DiffLine, index: number): ReactNode {
    const view = rowViews[index];
    if (view === undefined || !view.isRevStart || !view.revRun) {
      return null;
    }
    return <RevisionTag run={view.revRun} />;
  }

  function resolveForeignThreads(
    line: DiffLine,
    baseIndex: number,
  ): DigestThreadRow[] {
    if (guest !== undefined) {
      return fileThreads.filter((row) => showsThreadOnGuestRow(row, line));
    }
    if (baseIndex < 0) {
      return fileThreads.filter((row) => showsThreadOnRow(row, line));
    }

    return conversationThreadsByRow?.get(baseIndex) ?? [];
  }

  function buildUnderRow(
    line: DiffLine,
    index: number,
    columnCount: number,
    sideColumns?: number,
  ): ReactNode {
    const view = rowViews[index];
    if (view === undefined) {
      return null;
    }
    const baseIndex = table.baseIndexOf?.[index] ?? index;
    // An expanded or guest row has no base index: its threads are the
    // file's whose line it now shows, a sibling's or a hidden one.
    const conversationRows = resolveForeignThreads(line, baseIndex);
    return (
      <UnderRows
        activeCommentAnchor={review.activeCommentAnchor}
        cancelComposer={review.cancelComposer}
        closesSpan={model.spanEnds.has(index)}
        composerSaving={review.composerSaving}
        conversationComposer={conversationComposer}
        conversationRows={conversationRows}
        deleteComment={review.deleteComment}
        expandedConversation={review.expandedConversation}
        layout={{ columnCount, sideColumns }}
        line={line}
        onCloseReasonRow={table.closeReasonRow}
        onToggleConversationThread={table.handleToggleConversationThread}
        postBlockedExternally={review.postBlockedExternally}
        postReviewComment={review.postReviewComment}
        postingCommentIds={review.postingCommentIds}
        reasonRowOpen={table.openReasonRowId === view.id}
        reviewCommentLabel={reviewCommentLabel}
        saveComment={review.saveComment}
        spanned={model.spannedRows.has(index)}
        toggleComment={review.toggleComment}
        updateComment={review.updateComment}
        view={view}
      />
    );
  }

  const viewportStyle: DiffViewportStyle = {
    "--diff-rows": model.split ? model.pairs.length : rows.length,
  };
  return (
    <>
      {/* The reason the commentable rows are inert (aria-describedby target).
          Visible rather than sr-only, so pointer users learn it too. */}
      {review.composerDisabledReason !== undefined ? (
        <p
          className={styles["composerDisabledNote"]}
          id={table.composerDisabledReasonId}
        >
          {review.composerDisabledReason}
        </p>
      ) : null}
      {table.hasExpandedRows ? (
        <ScreenReaderOnly as="p" id={table.expandedReasonId}>
          {t("brief.diff.expandOutsideDiff")}
        </ScreenReaderOnly>
      ) : null}
      {table.guestReasons.map((reason) => (
        <ScreenReaderOnly as="p" id={table.reasonIdFor(reason)} key={reason}>
          {t(GUEST_REASON_KEYS[reason])}
        </ScreenReaderOnly>
      ))}
      <div className={styles["viewport"]} style={viewportStyle}>
        <table
          className={styles["diff"]}
          ref={table.tableRef}
          data-view={model.resolvedView}
        >
          <DiffTableHead
            file={chunk.file}
            overlayActive={table.overlayActive}
            split={model.split}
          />
          <DiffRows
            rows={rows}
            view={model.resolvedView}
            pairs={model.pairs}
            tokensByRow={tokensByRow}
            emphasisByRow={model.emphasisByRow}
            tokensPending={tokensPending}
            anchorAttributes={COMMENT_ANCHOR_ATTRIBUTES}
            lineNumberAttributes={SELECT_ANCHOR_ATTRIBUTES}
            codeTrailer={buildCodeTrailer}
            lineNumberContent={buildNumberCellContent}
            gutterCell={buildGutterCell}
            seamCell={model.split ? buildSeamCell : undefined}
            rowAttributes={table.buildRowAttributes}
            underRow={buildUnderRow}
            fullRow={buildExpandRow}
            beforeRow={buildRowBefore}
            trailingRow={buildTrailingRow}
          />
        </table>
      </div>
      {railHover && (
        <ComparisonCallout
          anchor={railHover.el}
          key={railHover.key}
          onClose={() => table.handleRailLeave(railHover.el)}
          run={railHover.run}
          chunk={chunk}
          source={comparisonSource}
          skipReason={comparisonSkipReason}
        />
      )}
    </>
  );
}
