import { Fragment, useEffect, useState } from "react";

import { rangeBetween } from "../../../../lib/collections";
import { CommentComposer } from "../../../review/components/CommentComposer/CommentComposer";
import { CommentThread } from "../../../review/components/CommentThread/CommentThread";
import { AddressedDiffComment } from "../../../review/components/AddressedDiffComment/AddressedDiffComment";
import {
  createCommentAnchor,
  type CommentAnchor,
  type ReviewComment,
} from "../../../review/comments";
import {
  type ChunkRevisionView,
  type RevisionRun,
} from "../../revisionChanges";
import type { AddressedReviewComment, Brief, BriefChunk } from "../../types";
import { DeltaCallout } from "../DeltaCallout/DeltaCallout";
import { RevisionGutterCell } from "../RevisionGutterCell/RevisionGutterCell";
import { getDiffRowView } from "./diffRowView";
import styles from "./DiffTable.module.scss";

export interface DiffTableProps {
  chunk: BriefChunk;
  revisionView: ChunkRevisionView;
  revisionDelta: Brief | null;
  activeCommentAnchor: CommentAnchor | null;
  addressedComments: AddressedReviewComment[];
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
  revisionView,
  revisionDelta,
  activeCommentAnchor,
  addressedComments,
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
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  const [railHover, setRailHover] = useState<{
    run: RevisionRun;
    pos: { top: number; left: number };
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

  const handleRailEnter = (run: RevisionRun, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setRailHover({ run, pos: { top: rect.top, left: rect.right + 8 } });
  };
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
  const overlayActive = revisionView.runs.length > 0;
  const metaColSpan = overlayActive ? 4 : 3;

  function finishSelection(rowIndex: number) {
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

  return (
    <>
      <div
        className={styles["viewport"]}
        // CSS custom property: csstype's CSSProperties has no `--*` index, so a
        // narrow cast is the standard typed escape hatch here.
        style={{ "--diff-rows": chunk.diff.length } as React.CSSProperties}
      >
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
                id,
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
                revisionView,
                comments,
                addressedComments,
                dragIndexes,
                activeRowIds,
                activeCommentAnchor,
              });
              return (
                <Fragment key={`${line.kind}-${index}`}>
                  <tr
                    className={styles["line"]}
                    data-commentable=""
                    data-line-kind={line.kind}
                    data-rev={revMark}
                    data-selected={isSelected ? "" : undefined}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") finishSelection(index);
                    }}
                    onMouseDown={(event) => {
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
        <DeltaCallout
          pos={railHover.pos}
          run={railHover.run}
          chunk={chunk}
          delta={revisionDelta}
        />
      )}
    </>
  );
}
