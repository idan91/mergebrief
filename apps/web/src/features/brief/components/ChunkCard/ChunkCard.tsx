import { memo, useMemo, useState } from "react";

import { Callout } from "../../../../components/Callout";
import { reviewCommentsForChunk } from "../../reviewComments";
import { buildChunkComparisonView } from "../../comparison";
import type {
  AddressedReviewComment,
  BriefChunk,
  RiskSurfaceAttribute,
} from "../../types";
import type { ComparisonOverlayState } from "../../comparisonOverlay";
import {
  AddressedComments,
  ReviewComments,
} from "../../../review/components/AddressedComments/AddressedComments";
import type { CommentAnchor, ReviewComment } from "../../../review/comments";
import { useMindMap } from "../../../review/session";
import { riskChipView } from "../../viewModel";
import { ScreenReaderOnly } from "../../../../components/ScreenReaderOnly";
import { RiskBadge } from "../Badge/RiskBadge";
import { RoleBadge } from "../Badge/RoleBadge";
import { splitInlineRows, type DigestRow } from "../../../conversation/digest";
import { InlineThreads } from "../../../conversation/components/InlineThreads/InlineThreads";
import type { ThreadComposerWiring } from "../../../conversation/components/ConversationSection/ConversationSection";
import { DiffTable } from "../DiffTable/DiffTable";
import styles from "./ChunkCard.module.scss";

export interface ChunkCardProps {
  chunk: BriefChunk;
  comparison: ComparisonOverlayState;
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
  /** Inline conversation threads at this chunk (BRIEF-25); absent = none. */
  conversationRows?: DigestRow[] | undefined;
  conversationComposer?: ThreadComposerWiring | undefined;
}

/**
 * The "+N" chip for risk attributes beyond the header's two-chip budget.
 * The full list opens in the shared anchored Callout (portal-rendered, so
 * the card's overflow clip and the sticky header's backdrop-filter
 * containing block can't swallow it) and stays open while the pointer is
 * inside it. Screen readers get the list inline via the hidden span.
 */
function OverflowRiskChip({ attrs }: { attrs: RiskSurfaceAttribute[] }) {
  const [anchor, setAnchor] = useState<Element | null>(null);
  return (
    <span onMouseEnter={(event) => setAnchor(event.currentTarget)}>
      <RiskBadge>
        +{attrs.length}
        <ScreenReaderOnly>{` ${attrs.join(", ")}`}</ScreenReaderOnly>
      </RiskBadge>
      {anchor ? (
        <Callout anchor={anchor} fit onClose={() => setAnchor(null)}>
          <span className={styles["tipChips"]}>
            {attrs.map((attr) => (
              <RiskBadge key={attr}>{attr}</RiskBadge>
            ))}
          </span>
        </Callout>
      ) : null}
    </span>
  );
}

export const ChunkCard = memo(function ChunkCard({
  chunk,
  comparison,
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
  conversationRows,
  conversationComposer,
}: ChunkCardProps) {
  const reviewed = useMindMap((state) => state.reviewedChunks.has(chunk.id));

  const riskChips = riskChipView(chunk.riskSurface);
  const expanded = open && !forceCollapsed;
  const comparisonView = useMemo(
    () => buildChunkComparisonView(chunk, comparison.marks),
    [chunk, comparison.marks],
  );
  // Live threads split (smoke feedback 2026-07-08): humans render row-level
  // inside the diff (under their lines); bots keep ONE aggregated
  // chunk-level disclosure.
  const conversationSplit = useMemo(
    () => splitInlineRows(conversationRows ?? []),
    [conversationRows],
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
      // Programmatic focus target for the conversation jump contract
      // (BRIEF-25): move focus with the scroll, never leave it behind.
      tabIndex={-1}
    >
      <div className={styles["head"]}>
        <button
          className={styles["toggle"]}
          type="button"
          aria-expanded={expanded}
          onClick={() => toggleChunk(chunk.id)}
        >
          <span className={styles["twist"]}>▶</span>
          <span className={styles["file"]}>{chunk.file}</span>
          <span className={styles["chips"]}>
            {riskChips.shown.length > 0 ? (
              <span className={styles["riskLane"]}>
                {riskChips.shown.map((risk) => (
                  <RiskBadge key={risk}>{risk}</RiskBadge>
                ))}
                {riskChips.overflow.length > 0 ? (
                  <OverflowRiskChip attrs={riskChips.overflow} />
                ) : null}
              </span>
            ) : null}
            <span className={styles["chip"]} data-concern={chunk.concern}>
              <span className={styles["dot"]} />
              {chunk.concern}
            </span>
            <RoleBadge role={chunk.role} />
            {comments.length > 0 ? (
              <span className={styles["chip"]}>
                {comments.length} draft{comments.length === 1 ? "" : "s"}
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
        <label className={styles["reviewToggle"]}>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={() => markReviewed(chunk.id)}
          />
          <span>Viewed</span>
          <ScreenReaderOnly>{` ${chunk.file}`}</ScreenReaderOnly>
        </label>
      </div>
      {!expanded ? <ScreenReaderOnly>Collapsed</ScreenReaderOnly> : null}
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
          {conversationSplit.botGroups.length > 0 &&
          conversationComposer !== undefined ? (
            <InlineThreads
              composer={conversationComposer}
              rows={conversationSplit.botGroups}
            />
          ) : null}
          <DiffTable
            conversationComposer={conversationComposer}
            conversationThreadsByRow={conversationSplit.byRow}
            activeCommentAnchor={activeCommentAnchor}
            addressedComments={inlineReviewComments}
            cancelCommentComposer={cancelCommentComposer}
            chunk={chunk}
            comparisonView={comparisonView}
            comparisonSource={comparison.source}
            comparisonSkipReason={comparison.skipReason}
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
