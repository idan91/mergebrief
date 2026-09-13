import type { DiffLine } from "@web/utils/diffTokens/types";
import { useTranslation } from "react-i18next";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { rangeBetween } from "@web/utils/collections";
import { CommentComposer } from "@web/features/review";
import { CommentThread } from "@web/features/review";
import {
  ThreadRowView,
  type ThreadComposerWiring,
} from "@web/features/conversation";
import {
  demotedSubmittedCommentIds,
  type DigestThreadRow,
} from "@web/features/conversation/utils";

// Row-level threads already sit AT their line, so the detail's jump is hidden.
const noJump = () => undefined;
import { AddressedDiffComment } from "@web/features/review";
import {
  createCommentAnchor,
  isLineCommentAnchor,
} from "@web/features/review/utils";
import {
  useChunkReviewComments,
  useReviewActions,
  useReviewFlow,
} from "@web/features/review/session";
import {
  type ChunkComparisonView,
  type ComparisonRun,
  type ComparisonSource,
} from "../../../comparison/comparison";
import type {
  AddressedReviewComment,
  BriefChunk,
  RevisionNarrativeSkipReason,
} from "../../../types";
import { ComparisonCallout } from "./ComparisonCallout/ComparisonCallout";
import { RevisionGutterCell } from "./RevisionGutterCell/RevisionGutterCell";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import {
  getDiffRowView,
  resolveStrandedRows,
  type DiffRowView,
} from "./diffRowView";
import type { RowTokenMap } from "@web/utils/diffTokens/types";
import {
  DiffRows,
  isFullWidthDiffRow,
} from "@web/components/DiffRows/DiffRows";
import type { DiffRowAttributes } from "@web/components/DiffRows/types";
import styles from "./DiffTable.module.scss";

// csstype's CSSProperties has no `--*` index; a typed extension keeps the
// custom property cast-free.
interface DiffViewportStyle extends CSSProperties {
  "--diff-rows": number;
}

const EMPTY_REVIEW_COMMENTS: never[] = [];

/** Marks the cells range anchoring may start from, read by the row handlers. */
const COMMENT_ANCHOR_ATTRIBUTES = { "data-comment-anchor": "" };
const EMPTY_EXPANDED_THREADS: ReadonlySet<number> = new Set();

export interface DiffTableProps {
  chunk: BriefChunk;
  comparisonView: ChunkComparisonView;
  comparisonSource: ComparisonSource;
  comparisonSkipReason: RevisionNarrativeSkipReason | null;
  addressedComments: AddressedReviewComment[];
  /** Live conversation threads under their diff rows. */
  conversationThreadsByRow?: ReadonlyMap<number, DigestThreadRow[]> | undefined;
  conversationComposer?: ThreadComposerWiring | undefined;
  reviewCommentLabel: string;
  /**
   * Hard read-only override (the RawSpanDiff case): every write affordance
   * stands down with THIS reason regardless of the flow store's posture, and
   * no review comments render, a raw-span chunk id could collide with a
   * brief chunk id, so the store's chunk-keyed reads must not apply.
   */
  readOnlyReason?: string | undefined;
  /** Syntax tokens keyed by row index; absent renders every row plain. */
  tokensByRow?: RowTokenMap | undefined;
  tokensPending?: boolean;
}

export function DiffTable({
  tokensByRow,
  tokensPending = false,
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

  // Reset the drag when the mouse is released anywhere. Without this, releasing
  // outside a commentable row leaves the selection highlight stuck on.
  useEffect(() => {
    if (dragStart === null) return;
    const reset = () => {
      setDragStart(null);
      setDragCurrent(null);
    };
    window.addEventListener("mouseup", reset);
    return () => window.removeEventListener("mouseup", reset);
  }, [dragStart]);

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

  const dragIndexes =
    dragStart === null || dragCurrent === null
      ? []
      : rangeBetween(dragStart, dragCurrent);
  const activeRowIds = new Set(activeCommentAnchor?.rowIds ?? []);
  const strandedRowIds = resolveStrandedRows(chunk, comments);
  const handleToggleConversationThread = (threadId: number) =>
    toggleConversationThread(chunkKey, threadId);
  const overlayActive = comparisonView.runs.length > 0;

  function finishSelection(rowIndex: number) {
    // Read-only revision: composer entry is inert (the affordance itself is
    // aria-disabled with the reason, which guards the activation path).
    if (composerDisabledReason !== undefined) return;
    const indexes =
      dragStart === null ? [rowIndex] : rangeBetween(dragStart, rowIndex);
    setDragStart(null);
    setDragCurrent(null);
    const anchor = createCommentAnchor(
      chunk.id,
      chunk.file,
      chunk.diff ?? [],
      indexes,
    );
    if (anchor) openComposer(anchor);
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
    _line: DiffLine,
    index: number,
  ): DiffRowAttributes {
    const view = rowViews[index];
    const commentable = composerDisabledReason === undefined;
    const attributes: DiffRowAttributes = {
      commentable,
      focusable: true,
      revision: view?.revMark,
      selected: view?.isSelected === true,
      onKeyDown: (event) => {
        if (event.key === "Enter") finishSelection(index);
      },
      onMouseDown: (event) => {
        if (!commentable) return;
        // Range anchoring starts from a comment anchor, the line-number
        // gutter or the +/− sign column, never the code text, which stays
        // natively selectable.
        if (
          !(event.target instanceof Element) ||
          event.target.closest("[data-comment-anchor]") === null
        ) {
          return;
        }
        // Anchoring intent: drop any stale text selection, preventDefault
        // keeps it alive otherwise, and it would trip the mouseup
        // suppression guard.
        window.getSelection()?.removeAllRanges();
        event.preventDefault();
        setDragStart(index);
        setDragCurrent(index);
      },
      onMouseEnter: () => {
        if (dragStart !== null) setDragCurrent(index);
      },
      onMouseUp: (event) => {
        // A gutter-initiated drag is unambiguous comment intent (the gutter
        // mousedown cleared any selection).
        if (dragStart !== null) {
          finishSelection(index);
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
        finishSelection(index);
      },
    };
    if (!commentable) {
      attributes.describedById = composerDisabledReasonId;
      attributes.disabled = true;
    }
    return attributes;
  }

  function buildGutterCell(_line: DiffLine, index: number): ReactNode {
    const view = rowViews[index];
    return (
      <RevisionGutterCell
        run={overlayActive ? view?.revRun : undefined}
        isStart={view?.isRevStart === true}
        isEnd={view?.isRevEnd === true}
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
    _line: DiffLine,
    index: number,
    columnCount: number,
  ): ReactNode {
    const view = rowViews[index];
    if (view === undefined) return null;
    const conversationRows = conversationThreadsByRow?.get(index) ?? [];
    return (
      <>
        {view.showComposer && activeCommentAnchor ? (
          <tr className={styles["commentRow"]}>
            <td colSpan={columnCount}>
              <CommentComposer
                anchor={activeCommentAnchor}
                cancel={cancelComposer}
                saving={composerSaving}
                mentionCandidates={conversationComposer?.mentionPool}
                save={saveComment}
              />
            </td>
          </tr>
        ) : null}
        {view.rowComments.map((comment) => (
          <tr className={styles["commentRow"]} key={comment.id}>
            <td colSpan={columnCount}>
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
            </td>
          </tr>
        ))}
        {conversationRows.map((row) =>
          conversationComposer !== undefined ? (
            <tr
              className={styles["commentRow"]}
              // Addressable target for the digest's "Jump to comment"
              // (BriefPage descends to this row).
              data-conversation-thread={row.thread.rootCommentId}
              key={`conversation-${row.thread.rootCommentId}`}
            >
              <td colSpan={columnCount}>
                <ThreadRowView
                  composer={conversationComposer}
                  expanded={expandedConversation.has(row.thread.rootCommentId)}
                  hideJump
                  jumpToChunk={noJump}
                  row={row}
                  toggle={handleToggleConversationThread}
                />
              </td>
            </tr>
          ) : null,
        )}
        {view.rowAddressedComments.map((comment) => (
          <tr className={styles["commentRow"]} key={`addressed-${comment.id}`}>
            <td colSpan={columnCount}>
              <AddressedDiffComment
                comment={comment}
                label={reviewCommentLabel}
              />
            </td>
          </tr>
        ))}
      </>
    );
  }

  const viewportStyle: DiffViewportStyle = {
    "--diff-rows": chunk.diff.length,
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
        <table className={styles["diff"]}>
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
              <th scope="col">{t("brief.diff.colOld")}</th>
              <th scope="col">{t("brief.diff.colNew")}</th>
              <th scope="col">{t("brief.diff.colContent")}</th>
            </tr>
          </ScreenReaderOnly>
          <DiffRows
            rows={chunk.diff}
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
