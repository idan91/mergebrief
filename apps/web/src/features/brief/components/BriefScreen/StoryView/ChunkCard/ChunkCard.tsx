import { memo, useMemo, useRef } from "react";

import { CopyButton } from "@web/components/CopyButton/CopyButton";
import { reviewCommentsForChunk } from "../../../../utils/reviewComments";
import { buildChunkComparisonView } from "../../../../comparison/comparison";
import type {
  AddressedReviewComment,
  BriefChunk,
  RiskToken,
} from "../../../../types";
import type { AttributeDisplayMeta } from "../../../../utils/repoConfig";
import type { ComparisonOverlayState } from "../../../../comparison/comparisonOverlay";
import { AddressedComments, ReviewComments } from "@web/features/review";
import {
  useChunkReviewComments,
  useMindMap,
} from "@web/features/review/session";
import { riskChipView } from "../../../../utils/viewModel";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { RiskBadge } from "../../RiskBadge/RiskBadge";
import { RiskChipDisclosure } from "../../RiskChipDisclosure/RiskChipDisclosure";
import { RiskDetailList } from "../../RiskDetailList/RiskDetailList";
import { RoleBadge } from "./RoleBadge/RoleBadge";
import {
  splitInlineRows,
  type DigestRow,
} from "@web/features/conversation/utils/digest";
import { InlineThreads } from "@web/features/conversation";
import type { ThreadComposerWiring } from "@web/features/conversation";
import { DiffTable } from "../../DiffTable/DiffTable";
import styles from "./ChunkCard.module.scss";

export interface ChunkCardProps {
  chunk: BriefChunk;
  comparison: ComparisonOverlayState;
  active: boolean;
  open: boolean;
  forceCollapsed: boolean;
  addressedReviewComments: AddressedReviewComment[];
  toggleChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  /** Inline conversation threads at this chunk (BRIEF-25); absent = none. */
  conversationRows?: DigestRow[] | undefined;
  conversationComposer?: ThreadComposerWiring | undefined;
  /**
   * Per-attribute display meta for THIS chunk (BRIEF-52): source variant,
   * de-emphasis, implication. Absent = plain built-in chips.
   */
  riskMeta?: ReadonlyMap<string, AttributeDisplayMeta> | undefined;
}

/**
 * The "+N" chip for risk attributes beyond the header's two-chip budget.
 * The full list opens in the shared anchored Callout (portal-rendered, so
 * the card's overflow clip and the sticky header's backdrop-filter
 * containing block can't swallow it) and stays open while the pointer is
 * inside it. Screen readers get the list inline via the hidden span.
 */
function OverflowRiskChip({
  attrs,
  riskMeta,
}: {
  attrs: RiskToken[];
  riskMeta?: ReadonlyMap<string, AttributeDisplayMeta> | undefined;
}) {
  return (
    <RiskChipDisclosure
      detail={
        <RiskDetailList attrs={attrs} metaFor={(attr) => riskMeta?.get(attr)} />
      }
    >
      <RiskBadge>
        +{attrs.length}
        <ScreenReaderOnly>{` ${attrs.join(", ")}`}</ScreenReaderOnly>
      </RiskBadge>
    </RiskChipDisclosure>
  );
}

/** Identity of a non-collapsed selection, for change detection across a gesture. */
interface SelectionSnapshot {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
}

function snapshotSelection(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;
  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
  };
}

function isSameSnapshot(
  a: SelectionSnapshot,
  b: SelectionSnapshot | null,
): boolean {
  return (
    b !== null &&
    a.anchorNode === b.anchorNode &&
    a.anchorOffset === b.anchorOffset &&
    a.focusNode === b.focusNode &&
    a.focusOffset === b.focusOffset
  );
}

export const ChunkCard = memo(function ChunkCard({
  chunk,
  comparison,
  active,
  open,
  forceCollapsed,
  addressedReviewComments,
  toggleChunk,
  markReviewed,
  conversationRows,
  conversationComposer,
  riskMeta,
}: ChunkCardProps) {
  const reviewed = useMindMap((state) => state.reviewedChunks.has(chunk.id));
  // Selection identity when the toggle gesture started — only a selection
  // CHANGED by this gesture suppresses the click. A stale selection that
  // survives the mousedown untouched (Firefox/Safari keep selections
  // across mousedowns on unselectable content) must not swallow the click.
  const selectionAtMouseDown = useRef<SelectionSnapshot | null>(null);
  // Unsuppressed toggles within the current click pair (reset on the
  // pair's first mousedown) — the dblclick compensator must know what the
  // pair actually did, not infer it from selection presence.
  const togglesThisPair = useRef(0);
  // Selected per chunk (BRIEF-27): this card re-renders only when ITS
  // slice changes, instead of trusting a parent-built map whose array
  // identities churned on every comment interaction anywhere.
  const comments = useChunkReviewComments(chunk.id);

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
          onMouseDown={(event) => {
            selectionAtMouseDown.current = snapshotSelection();
            if (event.detail <= 1) togglesThisPair.current = 0;
          }}
          onClick={(event) => {
            // Selecting the file path (selectable inside this button —
            // BRIEF-14) must not toggle the chunk open/closed. Keyboard
            // activation (detail 0) always toggles. Residual edge: re-
            // selecting the EXACT same range reads as unchanged and
            // toggles — the cost is a toggle, not a lost selection.
            if (event.detail > 0) {
              const selection = snapshotSelection();
              // Either endpoint counts: a shift-click extension keeps its
              // anchor where the selection started (e.g. down in the diff)
              // and only moves the focus into this button.
              if (
                selection !== null &&
                !isSameSnapshot(selection, selectionAtMouseDown.current) &&
                (event.currentTarget.contains(selection.anchorNode) ||
                  event.currentTarget.contains(selection.focusNode))
              ) {
                return;
              }
              togglesThisPair.current += 1;
            }
            toggleChunk(chunk.id);
          }}
          onDoubleClick={() => {
            // A double-click pair that netted exactly ONE unsuppressed
            // toggle (its first click preceded the word selection, the
            // second was suppressed) toggles again so the pair nets to
            // zero. Pairs that netted zero (both suppressed) or two (no
            // selection change — already net zero) are left alone.
            if (togglesThisPair.current === 1) toggleChunk(chunk.id);
          }}
        >
          <span aria-hidden="true" className={styles["twist"]}>
            ▶
          </span>
          <span className={styles["file"]}>{chunk.file}</span>
        </button>
        <CopyButton
          className={styles["copyPath"]}
          label="Copy file path"
          text={chunk.file}
        />
        <span className={styles["chips"]}>
          {riskChips.shown.length > 0 ? (
            <span className={styles["riskLane"]}>
              {riskChips.shown.map((risk) => {
                const meta = riskMeta?.get(risk);
                if (meta?.source === "repo-policy" || meta?.deEmphasized) {
                  // Repo-defined and de-emphasized chips carry a visible
                  // expansion (source, implication, de-emphasis note)
                  // reachable by keyboard/touch, not just title-hover.
                  return (
                    <RiskChipDisclosure
                      detail={
                        <RiskDetailList attrs={[risk]} metaFor={() => meta} />
                      }
                      key={risk}
                    >
                      <RiskBadge meta={meta}>{risk}</RiskBadge>
                    </RiskChipDisclosure>
                  );
                }
                return (
                  <RiskBadge key={risk} meta={meta}>
                    {risk}
                  </RiskBadge>
                );
              })}
              {riskChips.overflow.length > 0 ? (
                <OverflowRiskChip
                  attrs={riskChips.overflow}
                  riskMeta={riskMeta}
                />
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
            addressedComments={inlineReviewComments}
            chunk={chunk}
            comparisonView={comparisonView}
            comparisonSource={comparison.source}
            comparisonSkipReason={comparison.skipReason}
            reviewCommentLabel={
              hasLinkedAddressedComments ? "addressed" : "review comment"
            }
          />
        </div>
      ) : null}
    </article>
  );
});
