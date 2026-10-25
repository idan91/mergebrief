import { useTranslation } from "react-i18next";
import { memo, useMemo, useRef } from "react";

import { CopyButton } from "@web/components/CopyButton";
import { IconButton } from "@web/components/IconButton";
import { LocSign, LocSigns } from "@web/components/LocSign";
import {
  pathOnlyFileCommentsForChunk,
  reviewCommentsForChunk,
} from "../../../../../model/utils/review-comments";
import { buildChunkComparisonView } from "../../../../../model/comparison/runs";
import { isUnattributedRemainderChunk } from "../../../../../model/utils/remainder";
import type {
  AddressedReviewComment,
  BriefChunk,
  RiskKey,
} from "../../../../../model/types";
import { useExpandedRows } from "../../../../../model/expansion/useExpandedRows";
import { resolveFileStatus } from "../../../../../model/utils/file-status";
import type {
  FileLineOwners,
  LineTarget,
} from "../../../../../model/utils/line-owner";
import type { AttributeDisplayMeta } from "../../../../../model/utils/repo-config";
import type { ComparisonOverlayState } from "../../../../../model/comparison/comparison-overlay";
import { AddressedComments, ReviewComments } from "@web/features/review";
import {
  useChunkReviewComments,
  useReviewSession,
} from "@web/features/review/session";
import {
  getConcernLabel,
  getRiskAttributeLabel,
  riskChipView,
} from "../../../../../model/utils/view-model";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { RiskBadge } from "../../RiskBadge";
import { RiskChipDisclosure } from "../../RiskChipDisclosure";
import { RiskDetailList } from "../../RiskDetailList";
import { RoleBadge } from "./RoleBadge";
import { FileCommentBand } from "./FileCommentBand";
import { useFileCommentComposer } from "./useFileCommentComposer";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import { FileStatusBadge } from "./FileStatusBadge";
import {
  splitInlineRows,
  type DigestRow,
  type DigestThreadRow,
} from "@web/features/conversation/utils";
import { InlineThreads } from "@web/features/conversation";
import type { ThreadComposerWiring } from "@web/features/conversation";
import { DiffTable } from "../../DiffTable";

import { useChunkTokens } from "@web/hooks/useChunkTokens";
import { useTokenPlan } from "@web/hooks/useTokenPlan";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import type { ChunkShare } from "../../types";
import { ChunkTokenStatuses, type DiffLine } from "@web/utils/diffTokens/types";
import { useReadingPosition } from "../../reading/reading-position";
import styles from "./ChunkCard.module.scss";

export interface ChunkCardProps {
  chunk: BriefChunk;
  diffView?: DiffView;
  comparison: ComparisonOverlayState;
  open: boolean;
  addressedReviewComments: AddressedReviewComment[];
  toggleChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  /** No session to save a mark into: the toggle renders, disabled. */
  marksDisabled?: boolean | undefined;
  /** Inline conversation threads at this chunk; absent = none. */
  conversationRows?: DigestRow[] | undefined;
  conversationComposer?: ThreadComposerWiring | undefined;
  /**
   * Per-attribute display meta for THIS chunk: source variant,
   * de-emphasis, implication. Absent = plain built-in chips.
   */
  riskMeta?: ReadonlyMap<string, AttributeDisplayMeta> | undefined;
  /** Live threads on lines no chunk renders; expansion reveals them. */
  hiddenThreads?: readonly DigestThreadRow[] | undefined;
  /** Every current line thread of the file; expanded rows show theirs. */
  fileThreads?: readonly DigestThreadRow[] | undefined;
  /** The file's chunks and labels, for framing a sibling's expanded rows. */
  lineOwners?: FileLineOwners | undefined;
  /** Where a sibling span's control lands. */
  jumpToLine?: ((chunkId: string, target: LineTarget) => void) | undefined;
  /** Writes the chunk's hash and answers the URL to copy; absent hides the glyph. */
  shareChunk?: ChunkShare | undefined;
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
  attrs: RiskKey[];
  riskMeta?: ReadonlyMap<string, AttributeDisplayMeta> | undefined;
}) {
  const { t } = useTranslation();
  const spokenAttributes = attrs
    .map((attr) => getRiskAttributeLabel(t, attr))
    .join(", ");
  return (
    <RiskChipDisclosure
      detail={
        <RiskDetailList attrs={attrs} metaFor={(attr) => riskMeta?.get(attr)} />
      }
    >
      <RiskBadge>
        +{attrs.length}
        <ScreenReaderOnly>{` ${spokenAttributes}`}</ScreenReaderOnly>
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
  if (!selection || selection.isCollapsed) {
    return null;
  }
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

const NO_ROWS: DiffLine[] = [];

export const ChunkCard = memo(function ChunkCard({
  chunk,
  diffView = DiffViews.UNIFIED,
  comparison,
  open,
  addressedReviewComments,
  toggleChunk,
  markReviewed,
  marksDisabled,
  conversationRows,
  conversationComposer,
  riskMeta,
  hiddenThreads,
  fileThreads,
  lineOwners,
  jumpToLine,
  shareChunk,
}: ChunkCardProps) {
  const { t } = useTranslation();
  const reviewed = useReviewSession((state) =>
    state.reviewedChunks.has(chunk.id),
  );
  // Store-subscribed, not a prop: a reading-position tick re-renders the two
  // affected cards, never the parent list (which would break the memo win).
  const active = useReadingPosition(
    (state) => state.activeChunkId === chunk.id,
  );
  // Selection identity when the toggle gesture started. Only a selection
  // CHANGED by this gesture suppresses the click. A stale selection that
  // survives the mousedown untouched (Firefox/Safari keep selections
  // across mousedowns on unselectable content) must not swallow the click.
  const selectionAtMouseDown = useRef<SelectionSnapshot | null>(null);
  // Unsuppressed toggles within the current click pair (reset on the
  // pair's first mousedown). The dblclick compensator must know what the
  // pair actually did, not infer it from selection presence.
  const togglesThisPair = useRef(0);
  // Selected per chunk so this card re-renders only when ITS slice changes,
  // instead of trusting a parent-built map whose array identities churn on
  // every comment interaction anywhere.
  const comments = useChunkReviewComments(chunk.id);
  const fileComposer = useFileCommentComposer({
    chunk,
    chunkOpen: open,
    toggleChunk,
  });
  const tokenPlan = useTokenPlan();
  const diffRows = chunk.diff ?? NO_ROWS;
  const fileStatus = useMemo(() => resolveFileStatus(diffRows), [diffRows]);
  const concernLabel = getConcernLabel(t, chunk.concern);
  const expansion = useExpandedRows({
    chunkId: chunk.id,
    path: chunk.file,
    rows: diffRows,
  });
  const tokenRequest = {
    briefKey: tokenPlan.briefKey,
    chunkId: chunk.id,
    filePath: chunk.file,
    rows: open ? expansion.rows : NO_ROWS,
    admitted: tokenPlan.admitted,
  };
  const chunkTokens = useChunkTokens(
    expansion.expansionKey === undefined
      ? tokenRequest
      : { ...tokenRequest, expansionKey: expansion.expansionKey },
  );
  const diffPending = chunkTokens.status === ChunkTokenStatuses.PENDING;
  const tokensByRow =
    chunkTokens.status === ChunkTokenStatuses.READY
      ? chunkTokens.tokensByRow
      : undefined;
  const addFileCommentLabel = t("brief.chunk.ariaLabelAddFileComment", {
    file: chunk.file,
  });

  const riskChips = riskChipView(chunk.riskSurface);
  const comparisonView = useMemo(
    () => buildChunkComparisonView(chunk, comparison.marks),
    [chunk, comparison.marks],
  );
  // Humans render row-level inside the diff, under their lines; bots keep
  // ONE aggregated chunk-level disclosure.
  const conversationSplit = useMemo(
    () => splitInlineRows(conversationRows ?? []),
    [conversationRows],
  );
  const chunkReviewComments = reviewCommentsForChunk(
    addressedReviewComments,
    chunk,
  );
  const hasLinkedAddressedComments = Boolean(chunk.addressesComments?.length);
  const pathOnlyFileComments =
    conversationComposer === undefined
      ? pathOnlyFileCommentsForChunk(addressedReviewComments, chunk)
      : [];
  const unlinkedSummaryComments = chunkReviewComments.filter(
    (comment) => comment.outdated || comment.line === undefined,
  );
  const topReviewComments = hasLinkedAddressedComments
    ? chunkReviewComments
    : unlinkedSummaryComments.concat(pathOnlyFileComments);
  const inlineReviewComments = hasLinkedAddressedComments
    ? chunkReviewComments
    : chunkReviewComments.filter(
        (comment) => !comment.outdated && comment.line !== undefined,
      );
  return (
    <article
      className={styles["chunk"]}
      data-current={active ? "" : undefined}
      data-reviewed={reviewed ? "" : undefined}
      data-state={open ? "open" : "collapsed"}
      data-testid="brief-chunk"
      id={chunk.id}
      // Programmatic focus target for the conversation jump: move focus with
      // the scroll, never leave it behind.
      tabIndex={-1}
    >
      <div className={styles["head"]}>
        {/* oxlint-disable-next-line house/no-raw-button -- disclosure with a user-select: text requirement no shared component models */}
        <button
          className={styles["toggle"]}
          type="button"
          aria-expanded={open}
          data-testid="chunk-toggle"
          onMouseDown={(event) => {
            selectionAtMouseDown.current = snapshotSelection();
            if (event.detail <= 1) {
              togglesThisPair.current = 0;
            }
          }}
          onClick={(event) => {
            // Selecting the file path (selectable inside this button) must
            // not toggle the chunk open/closed. Keyboard activation
            // (detail 0) always toggles. Residual edge: re-selecting the
            // EXACT same range reads as unchanged and toggles.
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
            // selection change, already net zero) are left alone.
            if (togglesThisPair.current === 1) {
              toggleChunk(chunk.id);
            }
          }}
        >
          <span aria-hidden="true" className={styles["twist"]}>
            <Icon
              name={IconNames.CARET_DOWN}
              rotation={
                open ? IconRotations.NONE : IconRotations.THREE_QUARTERS
              }
              size={IconSizes.SM}
            />
          </span>
          <span className={styles["file"]}>{chunk.file}</span>
        </button>
        <CopyButton
          className={styles["copyPath"]}
          label={t("brief.chunk.copyFilePath")}
          text={chunk.file}
        />
        {shareChunk !== undefined ? (
          <CopyButton
            className={styles["copyLink"]}
            icon={IconNames.LINK}
            label={t("brief.chunk.copyLink")}
            onCopy={() => shareChunk.commit(chunk.id)}
            text={() => shareChunk.deriveUrl(chunk.id)}
            title={t("brief.chunk.copyLink")}
          />
        ) : null}
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
                      <RiskBadge attribute={risk} meta={meta} />
                    </RiskChipDisclosure>
                  );
                }
                return <RiskBadge attribute={risk} key={risk} meta={meta} />;
              })}
              {riskChips.overflow.length > 0 ? (
                <OverflowRiskChip
                  attrs={riskChips.overflow}
                  riskMeta={riskMeta}
                />
              ) : null}
            </span>
          ) : null}
          {isUnattributedRemainderChunk(chunk) ? null : (
            <>
              <span className={styles["chip"]} data-concern={chunk.concern}>
                <span className={styles["dot"]} />
                {concernLabel}
              </span>
              <RoleBadge role={chunk.role} />
              {fileStatus !== undefined ? (
                <FileStatusBadge status={fileStatus} />
              ) : null}
            </>
          )}
          {comments.length > 0 ? (
            <span className={styles["chip"]}>
              {t("brief.chunk.drafts", { count: comments.length })}
            </span>
          ) : null}
          {chunkReviewComments.length > 0 ? (
            <span className={styles["chip"]}>
              {hasLinkedAddressedComments
                ? t("brief.chunk.addressedCount", {
                    count: chunkReviewComments.length,
                  })
                : t("brief.chunk.reviewCount", {
                    count: chunkReviewComments.length,
                  })}
            </span>
          ) : null}
          <span className={`${styles["chip"]} ${styles["loc"]}`}>
            <LocSign sign={LocSigns.ADD} count={chunk.loc.added} />{" "}
            <LocSign sign={LocSigns.DEL} count={chunk.loc.deleted} />
          </span>
        </span>
        <label className={styles["reviewToggle"]}>
          <input
            type="checkbox"
            checked={reviewed}
            disabled={marksDisabled === true}
            onChange={() => markReviewed(chunk.id)}
          />
          <span>{t("brief.chunk.viewed")}</span>
          <ScreenReaderOnly>{` ${chunk.file}`}</ScreenReaderOnly>
        </label>
        <IconButton
          aria-label={addFileCommentLabel}
          aria-pressed={fileComposer.composerOpen}
          callout="left"
          className={styles["fileCommentControl"]}
          label={t("review.comment.commentOnFile")}
          onClick={fileComposer.requestComposer}
        >
          <Icon name={IconNames.CHAT_TEXT} size={IconSizes.MD} />
        </IconButton>
      </div>
      {!open ? (
        <ScreenReaderOnly>{t("brief.chunk.collapsed")}</ScreenReaderOnly>
      ) : null}
      {open ? (
        <div className={styles["body"]}>
          <FileCommentBand
            chunk={chunk}
            composerOpen={fileComposer.composerOpen}
            conversationComposer={conversationComposer}
            inboundRows={conversationSplit.fileHeader}
            onCancelComposer={fileComposer.cancelComposer}
          />
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
                  label={t("brief.chunk.reviewComment")}
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
            tokensByRow={tokensByRow}
            tokensPending={diffPending}
            view={diffView}
            expansion={expansion}
            hiddenThreads={hiddenThreads}
            fileThreads={fileThreads}
            jumpToLine={jumpToLine}
            deriveChunkUrl={shareChunk?.deriveUrl}
            lineOwners={lineOwners}
            conversationComposer={conversationComposer}
            conversationThreadsByRow={conversationSplit.byRow}
            addressedComments={inlineReviewComments}
            chunk={chunk}
            comparisonView={comparisonView}
            comparisonSource={comparison.source}
            comparisonSkipReason={comparison.skipReason}
            reviewCommentLabel={
              hasLinkedAddressedComments
                ? t("brief.chunk.addressed")
                : t("brief.chunk.reviewComment", { context: "inline" })
            }
          />
        </div>
      ) : null}
    </article>
  );
});
