import {
  Fragment,
  useEffect,
  useId,
  useState,
  type CSSProperties,
} from "react";

import { rangeBetween } from "../../../../lib/collections";
import { CommentComposer } from "../../../review/components/CommentComposer/CommentComposer";
import { CommentThread } from "../../../review/components/CommentThread/CommentThread";
import {
  ThreadRowView,
  type ThreadComposerWiring,
} from "../../../conversation/components/ConversationSection/ConversationSection";
import type { DigestThreadRow } from "../../../conversation/digest";

// Row-level threads already sit AT their line — the detail's jump is hidden.
const noJump = () => undefined;
import { AddressedDiffComment } from "../../../review/components/AddressedDiffComment/AddressedDiffComment";
import {
  createCommentAnchor,
  type CommentAnchor,
  type ReviewComment,
} from "../../../review/comments";
import {
  type ChunkComparisonView,
  type ComparisonRun,
  type ComparisonSource,
} from "../../comparison";
import type {
  AddressedReviewComment,
  BriefChunk,
  RevisionNarrativeSkipReason,
} from "../../types";
import { ComparisonCallout } from "../ComparisonCallout/ComparisonCallout";
import { RevisionGutterCell } from "../RevisionGutterCell/RevisionGutterCell";
import { getDiffRowView } from "./diffRowView";
import styles from "./DiffTable.module.scss";

// csstype's CSSProperties has no `--*` index; a typed extension (same
// pattern as Header's ProgressBarStyle) keeps the custom property cast-free.
interface DiffViewportStyle extends CSSProperties {
  "--diff-rows": number;
}

export interface DiffTableProps {
  chunk: BriefChunk;
  comparisonView: ChunkComparisonView;
  comparisonSource: ComparisonSource;
  comparisonSkipReason: RevisionNarrativeSkipReason | null;
  activeCommentAnchor: CommentAnchor | null;
  addressedComments: AddressedReviewComment[];
  /**
   * Why comment composition is disabled (BRIEF-24 read-only posture on a
   * historical revision). When set, the commentable rows stay focusable but
   * carry `aria-disabled` + an `aria-describedby` reason (BRIEF-23 pattern —
   * keyboard/SR users learn WHY before activation), and selection/composer
   * entry is inert. Absent → rows are writable as usual.
   */
  composerDisabledReason?: string | undefined;
  /** Live conversation threads under their diff rows (BRIEF-25); optional. */
  conversationThreadsByRow?: ReadonlyMap<number, DigestThreadRow[]> | undefined;
  conversationComposer?: ThreadComposerWiring | undefined;
  cancelCommentComposer: () => void;
  comments: ReviewComment[];
  deleteReviewComment: (commentId: string) => void;
  existingReviewCommentCount: number;
  openCommentComposer: (anchor: CommentAnchor) => void;
  reviewCommentLabel: string;
  saveReviewComment: (anchor: CommentAnchor, body: string) => void;
  toggleReviewComment: (commentId: string) => void;
  updateReviewComment: (commentId: string, body: string) => void;
}

export function DiffTable({
  chunk,
  comparisonView,
  comparisonSource,
  comparisonSkipReason,
  activeCommentAnchor,
  addressedComments,
  composerDisabledReason,
  conversationThreadsByRow,
  conversationComposer,
  cancelCommentComposer,
  comments,
  deleteReviewComment,
  existingReviewCommentCount,
  openCommentComposer,
  reviewCommentLabel,
  saveReviewComment,
  toggleReviewComment,
  updateReviewComment,
}: DiffTableProps) {
  const [dragStart, setDragStart] = useState<number | null>(null);
  // Instance-scoped id for the read-only reason the disabled rows point at
  // (declared before the no-diff early return — hooks order).
  const composerDisabledReasonId = `${useId()}-composer-disabled`;
  // Expansion for the live threads rendered under rows (visible state,
  // local to this table instance) — declared with the other hooks, before
  // the no-diff early return.
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
    if (anchor) openCommentComposer(anchor);
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
                      event.preventDefault();
                      setDragStart(index);
                      setDragCurrent(index);
                    }}
                    onMouseEnter={() => {
                      if (dragStart !== null) setDragCurrent(index);
                    }}
                    onMouseUp={() => finishSelection(index)}
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
                    <td className={styles["lineNumber"]}>
                      {line.oldLine ?? ""}
                    </td>
                    <td className={styles["lineNumber"]}>
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
                          cancel={cancelCommentComposer}
                          existingReviewCommentCount={
                            existingReviewCommentCount
                          }
                          save={saveReviewComment}
                        />
                      </td>
                    </tr>
                  ) : null}
                  {rowComments.map((comment) => (
                    <tr className={styles["commentRow"]} key={comment.id}>
                      <td colSpan={metaColSpan}>
                        <CommentThread
                          comment={comment}
                          deleteComment={deleteReviewComment}
                          toggle={toggleReviewComment}
                          update={updateReviewComment}
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
