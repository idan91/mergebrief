import { memo, useMemo } from "react";

import { reviewCommentsForChunk } from "../../reviewComments";
import { buildChunkRevisionView } from "../../revisionChanges";
import type { AddressedReviewComment, BriefChunk } from "../../types";
import type { RevisionOverlayState } from "../../revisionOverlay";
import {
  AddressedComments,
  ReviewComments,
} from "../../../review/components/AddressedComments/AddressedComments";
import type { CommentAnchor, ReviewComment } from "../../../review/comments";
import { useMindMap } from "../../../review/session";
import { RoleBadge } from "../Badge/RoleBadge";
import { DiffTable } from "../DiffTable/DiffTable";
import styles from "./ChunkCard.module.scss";

export interface ChunkCardProps {
  chunk: BriefChunk;
  revision: RevisionOverlayState;
  active: boolean;
  open: boolean;
  forceCollapsed: boolean;
  activeCommentAnchor: CommentAnchor | null;
  addressedReviewComments: AddressedReviewComment[];
  comments: ReviewComment[];
  existingReviewCommentCount: number;
  cancelCommentComposer: () => void;
  deleteReviewComment: (commentId: string) => void;
  toggleChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  openCommentComposer: (anchor: CommentAnchor) => void;
  saveReviewComment: (anchor: CommentAnchor, body: string) => void;
  toggleReviewComment: (commentId: string) => void;
  updateReviewComment: (commentId: string, body: string) => void;
}

export const ChunkCard = memo(function ChunkCard({
  chunk,
  revision,
  active,
  open,
  forceCollapsed,
  activeCommentAnchor,
  addressedReviewComments,
  comments,
  existingReviewCommentCount,
  cancelCommentComposer,
  deleteReviewComment,
  toggleChunk,
  markReviewed,
  openCommentComposer,
  saveReviewComment,
  toggleReviewComment,
  updateReviewComment,
}: ChunkCardProps) {
  const reviewed = useMindMap((state) => state.reviewedChunks.has(chunk.id));

  const expanded = open && !forceCollapsed;
  const revisionView = useMemo(
    () => buildChunkRevisionView(chunk, revision.changes),
    [chunk, revision.changes],
  );
  const chunkReviewComments = reviewCommentsForChunk(
    addressedReviewComments,
    chunk,
  );
  const hasLinkedAddressedComments = Boolean(chunk.addressesComments?.length);
  const topReviewComments = hasLinkedAddressedComments
    ? chunkReviewComments
    : chunkReviewComments.filter(
        (comment) => comment.outdated || comment.line == null,
      );
  const inlineReviewComments = hasLinkedAddressedComments
    ? chunkReviewComments
    : chunkReviewComments.filter(
        (comment) => !comment.outdated && comment.line != null,
      );
  return (
    <article
      className={styles["chunk"]}
      data-current={active ? "" : undefined}
      data-reviewed={reviewed ? "" : undefined}
      data-state={expanded ? "open" : "collapsed"}
      id={chunk.id}
    >
      <button
        className={styles["head"]}
        type="button"
        onClick={() => toggleChunk(chunk.id)}
      >
        <span className={styles["twist"]}>▶</span>
        <span className={styles["file"]}>{chunk.file}</span>
        <span className={styles["chips"]}>
          {chunk.riskSurface.map((risk) => (
            <span className={`${styles["chip"]} ${styles["risk"]}`} key={risk}>
              {risk}
            </span>
          ))}
          <span className={styles["chip"]} data-concern={chunk.concern}>
            <span className={styles["dot"]} />
            {chunk.concern}
          </span>
          <RoleBadge role={chunk.role} />
          {comments.length > 0 ? (
            <span className={styles["chip"]}>
              {comments.length} comment{comments.length === 1 ? "" : "s"}
            </span>
          ) : null}
          {chunkReviewComments.length > 0 ? (
            <span className={styles["chip"]}>
              {chunkReviewComments.length}{" "}
              {hasLinkedAddressedComments ? "addressed" : "review"}
            </span>
          ) : null}
          <span className={`${styles["chip"]} ${styles["loc"]}`}>
            <span className="a">+{chunk.loc.added}</span>{" "}
            <span className="d">−{chunk.loc.deleted}</span>
          </span>
        </span>
      </button>
      <div className={styles["actions"]}>
        <button
          className={styles["markButton"]}
          type="button"
          onClick={() => markReviewed(chunk.id)}
        >
          {reviewed ? "Reviewed ✓" : "Mark reviewed"}
        </button>
      </div>
      {!expanded ? (
        <div className={styles["collapseNote"]}>
          {chunk.role === "supporting"
            ? "supporting chunk — collapsed"
            : "collapsed"}
          {comments.length > 0
            ? ` · ${comments.length} draft comment${comments.length === 1 ? "" : "s"}`
            : ""}
        </div>
      ) : null}
      {expanded ? (
        <div className={styles["body"]}>
          {chunk.summary ||
          chunk.addressesComments?.length ||
          topReviewComments.length > 0 ? (
            <div className={styles["deltaSummary"]}>
              {chunk.summary ? <p>{chunk.summary}</p> : null}
              {chunk.addressesComments?.length ? (
                <AddressedComments chunk={chunk} comments={topReviewComments} />
              ) : null}
              {!chunk.addressesComments?.length &&
              topReviewComments.length > 0 ? (
                <ReviewComments
                  comments={topReviewComments}
                  label="review comment"
                />
              ) : null}
            </div>
          ) : null}
          <DiffTable
            activeCommentAnchor={activeCommentAnchor}
            addressedComments={inlineReviewComments}
            cancelCommentComposer={cancelCommentComposer}
            chunk={chunk}
            revisionView={revisionView}
            revisionDelta={revision.delta}
            comments={comments}
            deleteReviewComment={deleteReviewComment}
            existingReviewCommentCount={existingReviewCommentCount}
            openCommentComposer={openCommentComposer}
            reviewCommentLabel={
              hasLinkedAddressedComments ? "addressed" : "review comment"
            }
            saveReviewComment={saveReviewComment}
            toggleReviewComment={toggleReviewComment}
            updateReviewComment={updateReviewComment}
          />
        </div>
      ) : null}
    </article>
  );
});
