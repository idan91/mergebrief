import type { DiffLine } from "@web/utils/diffTokens/types";
import { useTranslation } from "react-i18next";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
  useRef,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { rangeBetween } from "@web/utils/collections";
import { CommentComposer } from "@web/features/review";
import { CommentThread } from "@web/features/review";
import { ThreadRowView } from "@web/features/conversation";
import { demotedSubmittedCommentIds } from "@web/features/conversation/utils";

// Row-level threads already sit AT their line, so the detail's jump is hidden.
const noJump = () => undefined;
import { AddressedDiffComment } from "@web/features/review";
import {
  CommentSides,
  createCommentAnchor,
  createSideAnchor,
  isLineCommentAnchor,
  rowId,
  type LineCommentAnchor,
} from "@web/features/review/utils";
import {
  useChunkReviewComments,
  useReviewActions,
  useReviewFlow,
} from "@web/features/review/session";
import { type ComparisonRun } from "../../../comparison/comparison";
import { ComparisonCallout } from "./ComparisonCallout/ComparisonCallout";
import { RevisionGutterCell } from "./RevisionGutterCell/RevisionGutterCell";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import {
  getDiffRowView,
  resolveStrandedRows,
  type DiffRowView,
} from "./diffRowView";
import { pairSplitRows } from "@web/components/DiffRows/pairSplitRows";
import {
  hasPairedSides,
  isFullWidthDiffRow,
} from "@web/components/DiffRows/utils";
import {
  type DiffRowAttributes,
  DiffViews,
  type SplitSide,
  SplitSides,
} from "@web/components/DiffRows/types";
import { DiffRows } from "@web/components/DiffRows/DiffRows";
import styles from "./DiffTable.module.scss";
import type {
  DiffTableProps,
  DiffViewportStyle,
  UnderRowLayout,
  UnderRowProps,
} from "./types";
import {
  COMMENT_ANCHOR_ATTRIBUTES,
  EMPTY_EXPANDED_THREADS,
  EMPTY_GAP,
  EMPTY_REVIEW_COMMENTS,
  NO_DIFF,
  NO_PAIRS,
} from "./consts";
import {
  buildPairPartners,
  collectSideIndexes,
  isSideFocusable,
  placementForAnchor,
  placementForThread,
  resolveDragSelection,
  spanForPlacement,
  unionRail,
} from "./utils";

export function DiffTable({
  tokensByRow,
  tokensPending = false,
  view: diffView = DiffViews.UNIFIED,
  chunk,
  comparisonView,
  comparisonSource,
  comparisonSkipReason,
  addressedComments,
  conversationThreadsByRow,
  conversationComposer,
  reviewCommentLabel,
  readOnlyReason,
}: DiffTableProps) {
  const { t } = useTranslation();
  const canPairSides = useMemo(
    () => hasPairedSides(chunk.diff ?? NO_DIFF),
    [chunk.diff],
  );
  const split = diffView === DiffViews.SPLIT && canPairSides;
  const resolvedView = split ? DiffViews.SPLIT : DiffViews.UNIFIED;

  const pairs = useMemo(
    () => (split ? pairSplitRows(chunk.diff ?? NO_DIFF) : NO_PAIRS),
    [chunk.diff, split],
  );
  const pairPartners = useMemo(() => buildPairPartners(pairs), [pairs]);
  const readOnly = readOnlyReason !== undefined;
  // Every stateful read below is chunk-scoped so this table re-renders for
  // ITS composer/posts only, never a sibling's.
  const {
    openComposer,
    cancelComposer,
    saveComment,
    deleteComment,
    toggleComment,
    toggleConversationThread,
    updateComment,
  } = useReviewActions();
  const chunkComments = useChunkReviewComments(chunk.id);
  const allComments = readOnly ? EMPTY_REVIEW_COMMENTS : chunkComments;
  // Server-backed wins: once a posted comment's own GitHub thread renders in
  // this chunk, the local submitted card demotes out of display. With no
  // conversation loaded there are no own threads, so local cards stay.
  const ownChunkThreads = useMemo(
    () =>
      [...(conversationThreadsByRow?.values() ?? [])]
        .flat()
        .filter((row) => row.isOwn)
        .map((row) => row.thread),
    [conversationThreadsByRow],
  );
  const comments = useMemo(() => {
    if (ownChunkThreads.length === 0) return allComments;
    const demoted = demotedSubmittedCommentIds(allComments, ownChunkThreads);
    return demoted.size === 0
      ? allComments
      : allComments.filter((comment) => !demoted.has(comment.id));
  }, [allComments, ownChunkThreads]);
  // Anchor-match selector: null (stable) unless the composer is on THIS chunk.
  const composerSaving = useReviewFlow((state) => state.composerSaving);
  const anchorForChunk = useReviewFlow((state) => {
    const anchor = state.composerAnchor;
    if (anchor === null || !isLineCommentAnchor(anchor)) return null;
    return anchor.chunkId === chunk.id ? anchor : null;
  });
  const activeCommentAnchor = readOnly ? null : anchorForChunk;
  /**
   * Why comment composition is disabled. When set, commentable rows stay
   * focusable but carry `aria-disabled` + an `aria-describedby` reason, and
   * selection/composer entry is inert.
   */
  const postureDisabledReason = useReviewFlow(
    (state) => state.composerDisabledReason,
  );
  const composerDisabledReason = readOnlyReason ?? postureDisabledReason;
  // Post a staged draft now; undefined hides the Post affordance entirely.
  const postComment = useReviewFlow((state) => state.postComment);
  const postReviewComment = readOnly ? undefined : postComment;
  // Wait-shaped reason every Post is blocked right now (submit in flight).
  const postBlockedExternally = useReviewFlow(
    (state) => state.postBlockedExternally,
  );
  // In-flight post-now ids scoped to THIS chunk's comments (the registry's
  // set covers the whole brief, so an unscoped read would re-render every
  // expanded table on any post).
  const postingCommentIds = useReviewFlow(
    useShallow((state) =>
      comments
        .filter((comment) => state.postingCommentIds.has(comment.id))
        .map((comment) => comment.id),
    ),
  );
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragSide, setDragSide] = useState<SplitSide | undefined>(undefined);
  const [dragCurrentSide, setDragCurrentSide] = useState<SplitSide | undefined>(
    undefined,
  );
  const tableRef = useRef<HTMLTableElement>(null);
  // Instance-scoped id for the read-only reason the disabled rows point at
  // (declared before the no-diff early return, for hooks order).
  const composerDisabledReasonId = `${useId()}-composer-disabled`;
  // Store-owned so it survives this card unmounting offscreen; the key is
  // file-qualified because a bare chunk id can collide across diff sources.
  const chunkKey = `${chunk.file}#${chunk.id}`;
  const expandedConversation =
    useReviewFlow((state) => state.expandedConversations.get(chunkKey)) ??
    EMPTY_EXPANDED_THREADS;
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  const [railHover, setRailHover] = useState<{
    run: ComparisonRun;
    el: HTMLElement;
  } | null>(null);

  useEffect(() => {
    if (!railHover) return;
    const close = () => setRailHover(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [railHover]);

  // The row model a drag was resolved against can change under it: the view
  // toggle is a window shortcut and can fire mid-drag, and a revision switch
  // rebuilds the rows. Either way the drag goes with the model it belonged
  // to, rather than anchoring a comment on rows it never covered.
  useEffect(() => {
    setDragStart(null);
    setDragCurrent(null);
    setDragSide(undefined);
    setDragCurrentSide(undefined);
    tableRef.current?.removeAttribute("data-selecting");
  }, [chunk.diff, resolvedView]);

  // Reset the drag when the mouse is released anywhere. Without this, releasing
  // outside a commentable row leaves the selection highlight stuck on.
  useEffect(() => {
    if (dragStart === null) return;
    const reset = () => {
      setDragStart(null);
      setDragCurrent(null);
      setDragSide(undefined);
      setDragCurrentSide(undefined);
    };
    window.addEventListener("mouseup", reset);
    return () => window.removeEventListener("mouseup", reset);
  }, [dragStart]);

  // A text selection begun on one side must not spill into the other. The
  // side rides the table as an attribute set by hand: a state write here
  // would re-render every row on the pointer-down of a text selection.
  useEffect(() => {
    const release = () => tableRef.current?.removeAttribute("data-selecting");
    window.addEventListener("mouseup", release);
    return () => window.removeEventListener("mouseup", release);
  }, []);

  const handleRailEnter = (run: ComparisonRun, el: HTMLElement) => {
    setRailHover({ run, el });
  };
  // Mouse-leave is owned by the Callout's hover system (safePolygon), so the
  // pointer can travel into the callout; this closes the keyboard path (blur).
  const handleRailLeave = () => setRailHover(null);

  if (!chunk.diff || chunk.diff.length === 0) {
    return (
      <div className={styles["metadataDiff"]}>
        <span>{t("brief.diff.unavailable")}</span>
        <p>{t("brief.diff.noMatchingRaw")}</p>
      </div>
    );
  }

  const dragSelection = resolveDragSelection(
    pairs,
    dragStart,
    dragCurrent,
    dragSide,
    dragCurrentSide,
  );
  const dragIndexes = new Set(dragSelection.indexes);
  const activePlacement =
    activeCommentAnchor === null
      ? undefined
      : placementForAnchor(activeCommentAnchor);
  const activeRowIds = new Set(activeCommentAnchor?.rowIds ?? []);
  const strandedRowIds = resolveStrandedRows(chunk, comments);
  const handleToggleConversationThread = (threadId: number) =>
    toggleConversationThread(chunkKey, threadId);
  const overlayActive = comparisonView.runs.length > 0;

  function finishSelection(rowIndex: number, side?: SplitSide) {
    // Read-only revision: composer entry is inert (the affordance itself is
    // aria-disabled with the reason, which guards the activation path).
    if (composerDisabledReason !== undefined) return;
    const startIndex = dragStart ?? rowIndex;
    const startSide = dragStart === null ? side : dragSide;
    setDragStart(null);
    setDragCurrent(null);
    setDragSide(undefined);
    setDragCurrentSide(undefined);
    const anchor = resolveAnchor(startIndex, startSide, rowIndex, side);
    if (anchor) openComposer(anchor);
  }

  // GitHub's rule: a range that stays on one side anchors on that side's
  // lines; a range that crosses sides is the unified span between the ends.
  function resolveAnchor(
    startIndex: number,
    startSide: SplitSide | undefined,
    endIndex: number,
    endSide: SplitSide | undefined,
  ): LineCommentAnchor | null {
    const diff = chunk.diff ?? [];
    if (startSide !== undefined && startSide === endSide) {
      const indexes = collectSideIndexes(
        pairs,
        startSide,
        startIndex,
        endIndex,
      );
      const commentSide =
        startSide === SplitSides.LEFT ? CommentSides.OLD : CommentSides.NEW;
      return createSideAnchor(chunk.id, chunk.file, diff, indexes, commentSide);
    }
    return createCommentAnchor(
      chunk.id,
      chunk.file,
      diff,
      rangeBetween(startIndex, endIndex),
    );
  }

  const rowViews = chunk.diff.map(buildRowView);

  function buildRowView(
    line: DiffLine,
    index: number,
  ): DiffRowView | undefined {
    if (isFullWidthDiffRow(line)) return undefined;
    return getDiffRowView({
      line,
      index,
      chunk,
      overlayActive,
      comparisonView,
      comments,
      addressedComments,
      dragIndexes,
      activeRowIds,
      activeCommentAnchor,
      strandedRowIds,
    });
  }

  function buildRowAttributes(
    line: DiffLine,
    index: number,
    side?: SplitSide,
  ): DiffRowAttributes {
    const view = rowViews[index];
    const commentable = composerDisabledReason === undefined;
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
          if (side !== undefined) markSelectingSide(side);
          return;
        }
        if (!commentable) return;
        // Anchoring intent: drop any stale text selection, preventDefault
        // keeps it alive otherwise, and it would trip the mouseup
        // suppression guard.
        window.getSelection()?.removeAllRanges();
        event.preventDefault();
        setDragStart(index);
        setDragCurrent(index);
        setDragSide(side);
        setDragCurrentSide(side);
      },
      onMouseEnter: () => {
        if (dragStart !== null) {
          setDragCurrent(index);
          setDragCurrentSide(side);
        }
      },
      onMouseUp: (event) => {
        // A gutter-initiated drag is unambiguous comment intent (the gutter
        // mousedown cleared any selection).
        if (dragStart !== null) {
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
    if (!commentable) {
      attributes.describedById = composerDisabledReasonId;
      attributes.disabled = true;
    }
    return attributes;
  }

  function markSelectingSide(side: SplitSide): void {
    tableRef.current?.setAttribute("data-selecting", side);
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
      activeRowIds.has(rowId(chunk.id, index)) &&
      (activePlacement === undefined || activePlacement === side);
    return dragged || active;
  }

  function buildGutterCell(_line: DiffLine, index: number): ReactNode {
    const own = rowViews[index];
    const partner = pairPartners.get(index);
    const other = partner === undefined ? undefined : rowViews[partner];
    const rail = unionRail(own, other);
    return (
      <RevisionGutterCell
        run={overlayActive ? rail.run : undefined}
        isStart={rail.isStart}
        isEnd={rail.isEnd}
        chunk={chunk}
        onRailEnter={handleRailEnter}
        onRailLeave={handleRailLeave}
      />
    );
  }

  function buildCodeTrailer(_line: DiffLine, index: number): ReactNode {
    const view = rowViews[index];
    if (view === undefined || !view.isRevStart || !view.revRun) return null;
    const label =
      view.revRun.kind === "removed"
        ? t("brief.diff.revRemoved")
        : t("brief.diff.revNew");
    return (
      <span className={styles["newTag"]} data-kind={view.revRun.kind}>
        {label}
      </span>
    );
  }

  function buildUnderRow(
    line: DiffLine,
    index: number,
    columnCount: number,
    sideColumns?: number,
  ): ReactNode {
    const view = rowViews[index];
    if (view === undefined) return null;
    const conversationRows = conversationThreadsByRow?.get(index) ?? [];
    const layout: UnderRowLayout = { columnCount, sideColumns };
    const composerPlacement =
      activeCommentAnchor === null
        ? undefined
        : placementForAnchor(activeCommentAnchor);
    return (
      <>
        {view.showComposer && activeCommentAnchor ? (
          <UnderRow layout={layout} placement={composerPlacement}>
            <CommentComposer
              anchor={activeCommentAnchor}
              cancel={cancelComposer}
              saving={composerSaving}
              mentionCandidates={conversationComposer?.mentionPool}
              save={saveComment}
            />
          </UnderRow>
        ) : null}
        {view.rowComments.map((comment) => (
          <UnderRow
            key={comment.id}
            layout={layout}
            placement={placementForAnchor(comment.anchor)}
          >
            <CommentThread
              comment={comment}
              deleteComment={deleteComment}
              mentionCandidates={conversationComposer?.mentionPool}
              post={postReviewComment}
              posting={postingCommentIds.includes(comment.id)}
              postBlockedExternally={postBlockedExternally}
              toggle={toggleComment}
              update={updateComment}
            />
          </UnderRow>
        ))}
        {conversationRows.map((row) =>
          conversationComposer !== undefined ? (
            <UnderRow
              // Addressable target for the digest's "Jump to comment"
              // (BriefPage descends to this row).
              conversationThread={row.thread.rootCommentId}
              key={`conversation-${row.thread.rootCommentId}`}
              layout={layout}
              placement={placementForThread(row.thread, line)}
            >
              <ThreadRowView
                composer={conversationComposer}
                expanded={expandedConversation.has(row.thread.rootCommentId)}
                hideJump
                jumpToChunk={noJump}
                row={row}
                toggle={handleToggleConversationThread}
              />
            </UnderRow>
          ) : null,
        )}
        {view.rowAddressedComments.map((comment) => (
          <UnderRow key={`addressed-${comment.id}`} layout={layout}>
            <AddressedDiffComment
              comment={comment}
              label={reviewCommentLabel}
            />
          </UnderRow>
        ))}
      </>
    );
  }

  const viewportStyle: DiffViewportStyle = {
    "--diff-rows": split ? pairs.length : chunk.diff.length,
  };
  return (
    <>
      {/* The reason the commentable rows are inert (aria-describedby target).
          Visible rather than sr-only, so pointer users learn it too. */}
      {composerDisabledReason !== undefined ? (
        <p
          className={styles["composerDisabledNote"]}
          id={composerDisabledReasonId}
        >
          {composerDisabledReason}
        </p>
      ) : null}
      <div className={styles["viewport"]} style={viewportStyle}>
        <table
          className={styles["diff"]}
          ref={tableRef}
          data-view={resolvedView}
        >
          {split ? (
            <colgroup>
              <col className={styles["colRail"]} />
              <col className={styles["colNumber"]} />
              <col className={styles["colCode"]} />
              <col className={styles["colNumber"]} />
              <col className={styles["colCode"]} />
            </colgroup>
          ) : null}
          {/* Sr-only caption + column headers (the LiveDiffPreview pattern):
              without them AT table navigation reads bare cell soup. */}
          <ScreenReaderOnly as="caption">
            {t("brief.diff.caption", { file: chunk.file })}
          </ScreenReaderOnly>
          <ScreenReaderOnly as="thead">
            <tr>
              <th aria-hidden={overlayActive ? undefined : true} scope="col">
                {overlayActive ? t("brief.diff.colRevision") : null}
              </th>
              {split ? (
                <>
                  <th scope="col">{t("brief.diff.colOld")}</th>
                  <th scope="col">{t("brief.diff.colContentOld")}</th>
                  <th scope="col">{t("brief.diff.colNew")}</th>
                  <th scope="col">{t("brief.diff.colContentNew")}</th>
                </>
              ) : (
                <>
                  <th scope="col">{t("brief.diff.colOld")}</th>
                  <th scope="col">{t("brief.diff.colNew")}</th>
                  <th scope="col">{t("brief.diff.colContent")}</th>
                </>
              )}
            </tr>
          </ScreenReaderOnly>
          <DiffRows
            rows={chunk.diff}
            view={resolvedView}
            pairs={pairs}
            tokensByRow={tokensByRow}
            tokensPending={tokensPending}
            anchorAttributes={COMMENT_ANCHOR_ATTRIBUTES}
            codeTrailer={buildCodeTrailer}
            gutterCell={buildGutterCell}
            rowAttributes={buildRowAttributes}
            underRow={buildUnderRow}
          />
        </table>
      </div>
      {railHover && (
        <ComparisonCallout
          anchor={railHover.el}
          onClose={handleRailLeave}
          run={railHover.run}
          chunk={chunk}
          source={comparisonSource}
          skipReason={comparisonSkipReason}
        />
      )}
    </>
  );
}

/** A thread, composer or addressed comment under a row, on its side if any. */
function UnderRow({
  layout,
  placement,
  conversationThread,
  children,
}: UnderRowProps) {
  const { columnCount, sideColumns } = layout;
  const beside = placement !== undefined && sideColumns !== undefined;
  const leadColumns = columnCount - (sideColumns ?? 0);

  return (
    <tr
      className={styles["commentRow"]}
      data-conversation-thread={conversationThread}
      data-placement={beside ? placement : undefined}
    >
      {beside && placement === SplitSides.RIGHT ? (
        <td className={styles["commentGap"]} colSpan={leadColumns}>
          {EMPTY_GAP}
        </td>
      ) : null}
      <td colSpan={beside ? spanForPlacement(placement, layout) : columnCount}>
        {children}
      </td>
      {beside && placement === SplitSides.LEFT ? (
        <td className={styles["commentGap"]} colSpan={sideColumns}>
          {EMPTY_GAP}
        </td>
      ) : null}
    </tr>
  );
}
