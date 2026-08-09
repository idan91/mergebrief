import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { rangeBetween } from "@web/utils/collections";
import { CommentComposer } from "@web/features/review";
import { CommentThread } from "@web/features/review";
import {
  ThreadRowView,
  type ThreadComposerWiring,
} from "@web/features/conversation";
import type { DigestThreadRow } from "@web/features/conversation/utils/digest";
import { demotedSubmittedCommentIds } from "@web/features/conversation/utils/ownComments";

// Row-level threads already sit AT their line — the detail's jump is hidden.
const noJump = () => undefined;
import { AddressedDiffComment } from "@web/features/review";
import { createCommentAnchor } from "@web/features/review/utils/comments";
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
import { getDiffRowView } from "./diffRowView";
import styles from "./DiffTable.module.scss";

// csstype's CSSProperties has no `--*` index; a typed extension keeps the
// custom property cast-free.
interface DiffViewportStyle extends CSSProperties {
  "--diff-rows": number;
}

const EMPTY_REVIEW_COMMENTS: never[] = [];

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
   * no review comments render — a raw-span chunk id could collide with a
   * brief chunk id, so the store's chunk-keyed reads must not apply.
   */
  readOnlyReason?: string | undefined;
}

export function DiffTable({
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
  const readOnly = readOnlyReason !== undefined;
  // Every stateful read below is chunk-scoped so this table re-renders for
  // ITS composer/posts only, never a sibling's.
  const {
    openComposer,
    cancelComposer,
    saveComment,
    deleteComment,
    toggleComment,
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
  const anchorForChunk = useReviewFlow((state) =>
    state.composerAnchor?.chunkId === chunk.id ? state.composerAnchor : null,
  );
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
  // set covers the whole brief — an unscoped read would re-render every
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
  // (declared before the no-diff early return — hooks order).
  const composerDisabledReasonId = `${useId()}-composer-disabled`;
  // Declared with the other hooks, before the no-diff early return.
  const [expandedConversation, setExpandedConversation] = useState<
    ReadonlySet<number>
  >(new Set());
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

  // Reset the drag when the mouse is released anywhere — without this, releasing
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
        <span>diff unavailable</span>
        <p>
          The brief loaded, but no matching raw diff was available for this
          chunk. The durable fix is to emit chunk-level hunk rows from the
          categorizer.
        </p>
      </div>
    );
  }

  const dragIndexes =
    dragStart === null || dragCurrent === null
      ? []
      : rangeBetween(dragStart, dragCurrent);
  const activeRowIds = new Set(activeCommentAnchor?.rowIds ?? []);
  const toggleConversationThread = (threadId: number) =>
    setExpandedConversation((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  const overlayActive = comparisonView.runs.length > 0;
  const metaColSpan = overlayActive ? 4 : 3;

  function finishSelection(rowIndex: number) {
    // Read-only revision: composer entry is inert (the affordance itself is
    // aria-disabled with the reason — this guards the activation path).
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

  const viewportStyle: DiffViewportStyle = {
    "--diff-rows": chunk.diff.length,
  };
  return (
    <>
      {/* The reason the commentable rows are inert (aria-describedby target).
          Visible — not sr-only — so pointer users learn it too. */}
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
            Diff for {chunk.file}
          </ScreenReaderOnly>
          <ScreenReaderOnly as="thead">
            <tr>
              {overlayActive ? <th scope="col">Revision</th> : null}
              <th scope="col">Old line</th>
              <th scope="col">New line</th>
              <th scope="col">Content</th>
            </tr>
          </ScreenReaderOnly>
          <tbody>
            {chunk.diff.map((line, index) => {
              if (line.kind === "hunk" || line.kind === "note") {
                return (
                  <tr
                    className={styles["line"]}
                    data-line-kind={line.kind}
                    key={`${line.kind}-${index}`}
                  >
                    <td colSpan={metaColSpan}>{line.content}</td>
                  </tr>
                );
              }
              const {
                sign,
                revRun,
                revMark,
                isRevStart,
                isRevEnd,
                rowComments,
                rowAddressedComments,
                isSelected,
                showComposer,
              } = getDiffRowView({
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
              });
              return (
                <Fragment key={`${line.kind}-${index}`}>
                  <tr
                    aria-describedby={
                      composerDisabledReason !== undefined
                        ? composerDisabledReasonId
                        : undefined
                    }
                    aria-disabled={
                      composerDisabledReason !== undefined ? true : undefined
                    }
                    className={styles["line"]}
                    data-commentable={
                      composerDisabledReason === undefined ? "" : undefined
                    }
                    data-line-kind={line.kind}
                    data-rev={revMark}
                    data-selected={isSelected ? "" : undefined}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") finishSelection(index);
                    }}
                    onMouseDown={(event) => {
                      if (composerDisabledReason !== undefined) return;
                      // Range anchoring starts from the line-number gutter
                      // only — a mousedown on the code cell stays native so
                      // the code text is selectable.
                      if (
                        !(event.target instanceof Element) ||
                        event.target.closest("[data-line-number]") === null
                      ) {
                        return;
                      }
                      // Anchoring intent: drop any stale text selection —
                      // preventDefault keeps it alive otherwise, and it
                      // would trip the mouseup suppression guard.
                      window.getSelection()?.removeAllRanges();
                      event.preventDefault();
                      setDragStart(index);
                      setDragCurrent(index);
                    }}
                    onMouseEnter={() => {
                      if (dragStart !== null) setDragCurrent(index);
                    }}
                    onMouseUp={(event) => {
                      // A gutter-initiated drag is unambiguous comment
                      // intent (the gutter mousedown cleared any selection).
                      if (dragStart !== null) {
                        finishSelection(index);
                        return;
                      }
                      // Plain mouseup: composer entry is gutter-only — the
                      // code column is reserved for text selection, so a
                      // double-click word-select never pops the composer.
                      // Keyboard entry stays row-level (Enter).
                      if (
                        !(event.target instanceof Element) ||
                        event.target.closest("[data-line-number]") === null
                      ) {
                        return;
                      }
                      // A text-selection drag released over the gutter: if
                      // either endpoint of a non-collapsed selection touches
                      // this table, the reviewer was selecting text.
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
                    }}
                    tabIndex={0}
                  >
                    {overlayActive ? (
                      <RevisionGutterCell
                        run={revRun}
                        isStart={isRevStart}
                        isEnd={isRevEnd}
                        chunk={chunk}
                        onRailEnter={handleRailEnter}
                        onRailLeave={handleRailLeave}
                      />
                    ) : null}
                    <td className={styles["lineNumber"]} data-line-number="">
                      {line.oldLine ?? ""}
                    </td>
                    <td className={styles["lineNumber"]} data-line-number="">
                      {line.newLine ?? ""}
                    </td>
                    <td className={styles["code"]}>
                      <span className={styles["sign"]}>{sign}</span>
                      {line.content}
                      {isRevStart && revRun ? (
                        <span
                          className={styles["newTag"]}
                          data-kind={revRun.kind}
                        >
                          {revRun.kind === "removed" ? "removed" : "new"}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  {showComposer && activeCommentAnchor ? (
                    <tr className={styles["commentRow"]}>
                      <td colSpan={metaColSpan}>
                        <CommentComposer
                          anchor={activeCommentAnchor}
                          cancel={cancelComposer}
                          mentionCandidates={conversationComposer?.mentionPool}
                          save={saveComment}
                        />
                      </td>
                    </tr>
                  ) : null}
                  {rowComments.map((comment) => (
                    <tr className={styles["commentRow"]} key={comment.id}>
                      <td colSpan={metaColSpan}>
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
                  {(conversationThreadsByRow?.get(index) ?? []).map((row) =>
                    conversationComposer !== undefined ? (
                      <tr
                        className={styles["commentRow"]}
                        // Addressable target for the digest's "Jump to
                        // comment" (BriefPage descends to this row).
                        data-conversation-thread={row.thread.rootCommentId}
                        key={`conversation-${row.thread.rootCommentId}`}
                      >
                        <td colSpan={metaColSpan}>
                          <ThreadRowView
                            composer={conversationComposer}
                            expanded={expandedConversation.has(
                              row.thread.rootCommentId,
                            )}
                            hideJump
                            jumpToChunk={noJump}
                            row={row}
                            toggle={toggleConversationThread}
                          />
                        </td>
                      </tr>
                    ) : null,
                  )}
                  {rowAddressedComments.map((comment) => (
                    <tr
                      className={styles["commentRow"]}
                      key={`addressed-${comment.id}`}
                    >
                      <td colSpan={metaColSpan}>
                        <AddressedDiffComment
                          comment={comment}
                          label={reviewCommentLabel}
                        />
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
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
