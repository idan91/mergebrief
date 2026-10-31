import { useTranslation } from "react-i18next";
import { formatDisplayPath } from "brief-core/hidden-chars";
import { useCallback, useEffect, useMemo } from "react";
import {
  Concerns,
  type RevisionNarrativeSkipReason,
  Roles,
  type RevisionNarrative,
  type RevisionNarrativeChunk,
} from "brief-core/types";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { Markdown } from "@web/components/Markdown";
import { useReviewFlow } from "@web/features/review/session";
import { TokenizeModes } from "@web/utils/diffTokens/types";
import { estimateNarrativeCardHeight } from "../reading/chunk-height-model";
import { useChunkWindows } from "../reading/chunk-windows";
import { useGroupWindow } from "../reading/useGroupWindow";
import { GroupViewKinds } from "../../../../model/utils/remainder";
import { getCategoryLabel } from "../../../../model/utils/view-model";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import {
  type Brief,
  type BriefChunk,
  type ComparisonMarks,
  GuestHostPrefixes,
} from "../../../../model/types";
import {
  CompareParams,
  type CompareParam,
} from "../../../../model/comparison/types";
import type { ComparisonQuery } from "../../../../model/comparison/comparison-query";
import type { FileRowsCache } from "../../../../model/file-rows/cache";
import { useFileRows } from "../../../../model/file-rows/useFileRows";
import { DiffTimeoutNotice } from "../../DiffTimeoutNotice";
import { DeltaContext } from "../DeltaContext";
import {
  type DeltaSpanLanding,
  type DeltaSpanStatus,
  DeltaSpanStatuses,
} from "../types";
import { GuestDiff } from "./GuestDiff";
import { RawSpanDiff } from "./RawSpanDiff";
import { GuestDiffVariants } from "./GuestDiff/types";
import { SectionFlags } from "./SectionFlags";
import type { ChangesReviewWiring } from "./types";
import {
  collectNarrativeRows,
  countLines,
  hasLengthViolations,
  resolveCardOwnerChunkId,
  shapeGuestRows,
} from "./utils";
import styles from "./ChangesOnlyView.module.scss";

/**
 * @description A compact, changed-only rendering of the active comparison.
 * Previous Brief groups the shared Revision narrative under the full Brief's
 * Change-groups; Your last review reuses the Delta Brief content under Changes
 * Only copy ("Delta" never appears as a primary label).
 */
export interface ChangesOnlyViewProps {
  /** The active baseline; `off` is normalized away before Changes Only renders. */
  compare: Exclude<CompareParam, typeof CompareParams.OFF>;
  /** The full Brief at the selected head, owns the Change-group taxonomy. */
  brief: Brief;
  /** View model for the full Brief (group order, titles, categories). */
  model: BriefViewModel;
  /** The Revision narrative for Previous Brief, or null when it failed. */
  narrative: RevisionNarrative | null;
  /** Full comparison marks, used to describe removed lines the diff can't show. */
  marks: ComparisonMarks | null;
  /** Distinct skip reason when the narrative was deliberately not generated. */
  skipReason: RevisionNarrativeSkipReason | null;
  /** The Delta Brief for Your last review, or null when unavailable. */
  delta: Brief | null;
  /** The last-review span was too large to summarize, so no Delta Brief will come. */
  deltaSkipped?: boolean;
  /**
   * The live span-diff descriptor for the ACTIVE compare baseline → selected
   * head. Present only on the DB timeline path while a comparison is active,
   * it drives the "Show raw diff" toggle. Absent → just the summary.
   */
  rawSpanDiff?: ComparisonQuery<string> | undefined;
  /** What the guest tables need to take a comment; absent leaves them inert. */
  review?: ChangesReviewWiring | undefined;
  /** Where the delta's rows stand; a card shows its summary first, rows when they land. */
  deltaSpan?: DeltaSpanStatus | undefined;
  /** The delta span's timeout retry: one notice above the cards. */
  deltaSpanLanding?: DeltaSpanLanding | undefined;
  /** Where a flag's or a card's jump lands: the screen exits to Full and lands on the chunk. */
  jumpToChunk?: ((chunkId: string) => void) | undefined;
  /** The previous-brief span diff by file; a narrative card takes its removed lines from it. */
  narrativeSpanRows?: FileRowsCache | undefined;
}

function ignoreJump(): void {
  return undefined;
}

export function ChangesOnlyView(props: ChangesOnlyViewProps) {
  const jumpToChunk = props.jumpToChunk ?? ignoreJump;
  const summary =
    props.compare === CompareParams.LAST_REVIEW ? (
      <LastReviewChanges
        brief={props.brief}
        delta={props.delta}
        deltaSkipped={props.deltaSkipped === true}
        deltaSpan={props.deltaSpan ?? DeltaSpanStatuses.ABSENT}
        deltaSpanLanding={props.deltaSpanLanding}
        fullModel={props.model}
        jumpToChunk={jumpToChunk}
        review={props.review}
      />
    ) : (
      <PreviousBriefChanges
        brief={props.brief}
        jumpToChunk={jumpToChunk}
        model={props.model}
        narrative={props.narrative}
        review={props.review}
        skipReason={props.skipReason}
        spanRows={props.narrativeSpanRows}
      />
    );
  if (props.rawSpanDiff === undefined) {
    return summary;
  }
  // Key on the COMPARISON plus the addressed span so a comparison switch or
  // revision change remounts and resets to the summary, both comparisons can
  // resolve to the SAME span, and a comparison switch is still a view change.
  return (
    <RawSpanDiff
      key={`${props.compare}:${JSON.stringify(props.rawSpanDiff.queryKey)}`}
      query={props.rawSpanDiff}
      review={props.review}
    >
      {summary}
    </RawSpanDiff>
  );
}

interface PreviousBriefChangesProps {
  brief: Brief;
  jumpToChunk: (chunkId: string) => void;
  model: BriefViewModel;
  narrative: RevisionNarrative | null;
  review: ChangesReviewWiring | undefined;
  skipReason: RevisionNarrativeSkipReason | null;
  spanRows: FileRowsCache | undefined;
}

function PreviousBriefChanges({
  brief,
  jumpToChunk,
  model,
  narrative,
  review,
  skipReason,
  spanRows,
}: PreviousBriefChangesProps) {
  const { t } = useTranslation();
  // Brief origin, not narrative content, so it renders independently of
  // narrative availability, and stays hidden for anchored revisions,
  // always-regenerate instances, and briefs with no stamp.
  const restartNote =
    brief.anchor?.state === "fresh-restart" ? (
      <p className={styles["restartNote"]} role="note">
        {brief.anchor.reason === "model-swap"
          ? t("brief.changes.regeneratedModelChange")
          : t("brief.changes.regeneratedFresh")}
      </p>
    ) : null;
  // The actionable read is "pick a stronger model", so the individual
  // over-cap entries are not itemized.
  const lengthNote = hasLengthViolations(brief, narrative) ? (
    <LengthGuidanceNote />
  ) : null;

  if (skipReason) {
    return (
      <>
        {restartNote}
        {lengthNote}
        <EmptyState>
          <b>{t("brief.changes.noRevisionSummaryLead")}</b>{" "}
          {skipReason === "span too large"
            ? t("brief.changes.noRevisionSummaryTooLarge")
            : t("brief.changes.noRevisionSummaryDisabled")}
        </EmptyState>
      </>
    );
  }
  if (!narrative) {
    return (
      <>
        {restartNote}
        {lengthNote}
        <EmptyState>
          <b>{t("brief.changes.revisionSummaryUnavailableLead")}</b>{" "}
          {t("brief.changes.revisionSummaryUnavailableBody")}
        </EmptyState>
      </>
    );
  }

  // Orphans (a briefChangeGroupId not on the Brief) fall to a trailing
  // section rather than being dropped.
  const orphanChunks = narrative.chunks.filter(
    (chunk) =>
      !brief.changeGroups.some((g) => g.id === chunk.briefChangeGroupId),
  );
  const modelChunks = model.groups.flatMap((group) => group.chunks);

  return (
    <div className={styles["changesOnly"]}>
      <div className={styles["eyebrow"]}>
        {t("brief.changes.eyebrowPreviousBrief")}
      </div>
      {restartNote}
      {lengthNote}
      <p className={styles["overview"]}>{narrative.overview}</p>
      {model.groups.map((group) => {
        if (group.kind !== GroupViewKinds.ATTRIBUTED) {
          return null;
        }
        const chunks = narrative.chunks.filter(
          (chunk) => chunk.briefChangeGroupId === group.group.id,
        );
        if (chunks.length === 0) {
          return null;
        }
        return (
          <section className={styles["group"]} key={group.id}>
            <div className={styles["groupHead"]}>
              <h2 className={styles["groupTitle"]}>{group.group.title}</h2>
              <span className={styles["groupCategory"]}>
                {getCategoryLabel(t, group.group.dominantCategory)}
              </span>
            </div>
            <SectionFlags
              chunks={modelChunks}
              flags={model.flags}
              group={group}
              jumpToChunk={jumpToChunk}
              regions={chunks}
            />
            <WindowedNarrativeList
              brief={brief}
              chunks={chunks}
              jumpToChunk={jumpToChunk}
              review={review}
              spanRows={spanRows}
            />
          </section>
        );
      })}
      {orphanChunks.length > 0 ? (
        <section className={styles["group"]}>
          <div className={styles["groupHead"]}>
            <h2 className={styles["groupTitle"]}>
              {t("brief.changes.otherChanges")}
            </h2>
          </div>
          <WindowedNarrativeList
            brief={brief}
            chunks={orphanChunks}
            jumpToChunk={jumpToChunk}
            review={review}
            spanRows={spanRows}
          />
        </section>
      ) : null}
    </div>
  );
}

interface WindowedNarrativeListProps {
  brief: Brief;
  chunks: readonly RevisionNarrativeChunk[];
  jumpToChunk: (chunkId: string) => void;
  review: ChangesReviewWiring | undefined;
  spanRows: FileRowsCache | undefined;
}

/**
 * The host id a narrative card's guest table renders under: file-qualified
 * like the window keys, since narrative chunk ids are the model's and
 * nothing checks them for uniqueness, and never a brief chunk's.
 */
function deriveNarrativeHostId(chunk: RevisionNarrativeChunk): string {
  return `${GuestHostPrefixes.NARRATIVE}${chunk.file}#${chunk.id}`;
}

/**
 * Windowed narrative cards, same shape as the story pane's chunk column:
 * absolute cards in a totalSize column, explicit inline-size (absolute cards
 * have no intrinsic width). The card hosting the composer stays mounted
 * offscreen, as a story card does. It joins the window registry only for
 * the scroll-compensation hold: nothing navigates to a narrative card by id.
 */
function WindowedNarrativeList({
  brief,
  chunks,
  jumpToChunk,
  review,
  spanRows,
}: WindowedNarrativeListProps) {
  const chunkKeys = useMemo(
    () => chunks.map((chunk) => `${chunk.file}#${chunk.id}`),
    [chunks],
  );
  const composerHost = useReviewFlow((state) => state.composerHost);
  const hostedIndex = useMemo(
    () =>
      chunks.findIndex(
        (chunk) => deriveNarrativeHostId(chunk) === composerHost,
      ),
    [chunks, composerHost],
  );
  const pinnedKeys = useMemo(() => {
    const key = hostedIndex === -1 ? undefined : chunkKeys[hostedIndex];
    return key === undefined ? undefined : new Set([key]);
  }, [chunkKeys, hostedIndex]);
  const estimateChunk = useCallback(
    (index: number) => {
      const chunk = chunks[index];
      if (!chunk) {
        return 0;
      }
      const removed = countLines(chunk.removedRanges);
      const spanLanded = spanRows?.getFileRows(chunk.file) !== undefined;
      return estimateNarrativeCardHeight({
        rowCount: countLines(chunk.addedRanges) + (spanLanded ? removed : 0),
        hasRemovedNote: !spanLanded && removed > 0,
      });
    },
    [chunks, spanRows],
  );
  const window = useGroupWindow({ chunkKeys, estimateChunk, pinnedKeys });
  const { holdScrollCompensation } = window;

  const registry = useChunkWindows();
  useEffect(() => {
    if (!registry) {
      return;
    }
    return registry.register({
      scrollToChunk: () => false,
      holdScrollCompensation,
    });
  }, [holdScrollCompensation, registry]);

  return (
    <div
      ref={window.listRef}
      style={{
        position: "relative",
        blockSize: window.totalSize,
        inlineSize: "100%",
      }}
    >
      {window.items.map((item) => {
        const chunk = chunks[item.index];
        if (!chunk) {
          return null;
        }
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={window.measureElement}
            style={{
              position: "absolute",
              // `top`, never `transform`, see WindowedChunkList: transform
              // ancestors break the cards' sticky headers.
              insetBlockStart: item.start - window.scrollMargin,
              insetInlineStart: 0,
              inlineSize: "100%",
            }}
          >
            <NarrativeChunkCard
              brief={brief}
              chunk={chunk}
              jumpToChunk={jumpToChunk}
              review={review}
              spanRows={spanRows}
            />
          </div>
        );
      })}
    </div>
  );
}

interface NarrativeChunkCardProps {
  brief: Brief;
  chunk: RevisionNarrativeChunk;
  jumpToChunk: (chunkId: string) => void;
  review: ChangesReviewWiring | undefined;
  spanRows: FileRowsCache | undefined;
}

function NarrativeChunkCard({
  brief,
  chunk,
  jumpToChunk,
  review,
  spanRows,
}: NarrativeChunkCardProps) {
  const { t } = useTranslation();
  const fileRows = useFileRows();
  const fileSpanRows = spanRows?.getFileRows(chunk.file);
  // The snippet key and the guest input derive from these identities.
  const narrative = useMemo(
    () => collectNarrativeRows(brief, chunk, t, fileSpanRows, fileRows),
    [brief, chunk, fileSpanRows, fileRows, t],
  );
  const host = useMemo<BriefChunk>(
    () => ({
      id: deriveNarrativeHostId(chunk),
      changeGroupId: chunk.briefChangeGroupId,
      file: chunk.file,
      concern: Concerns.IMPLEMENTATION,
      role: Roles.CORE,
      loc: {
        added: narrative.rows.length - narrative.removedShown,
        deleted: narrative.removedShown,
      },
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
      diff: narrative.rows,
    }),
    [chunk, narrative],
  );
  const originOf = useCallback(
    (index: number) => narrative.origins[index],
    [narrative.origins],
  );
  // The count stands in until the span diff supplies the removed lines.
  const removedCount =
    narrative.removedShown > 0 ? 0 : countLines(chunk.removedRanges);
  // The chunk the card's first row came from is the exact owner; the
  // resolver covers a card with no rendered head row.
  const firstOrigin = narrative.origins.find((origin) => origin !== undefined);
  const ownerId =
    firstOrigin?.chunkId ??
    resolveCardOwnerChunkId(
      brief.chunks,
      chunk.file,
      chunk.addedRanges,
      chunk.briefChangeGroupId,
    );
  const summaryId = `${host.id}-summary`;
  return (
    <div className={styles["chunk"]}>
      <CardHead
        describedBy={summaryId}
        file={chunk.file}
        jumpToChunk={jumpToChunk}
        ownerId={ownerId}
      />
      <p className={styles["chunkSummary"]} id={summaryId}>
        {chunk.summary}
      </p>
      {narrative.rows.length > 0 ? (
        <GuestDiff
          chunk={host}
          originOf={originOf}
          review={review}
          tokenizeMode={TokenizeModes.STANDALONE}
          variant={GuestDiffVariants.CARD}
        />
      ) : null}
      {removedCount > 0 ? (
        <div className={styles["removedNote"]}>
          {t("brief.changes.removedLines", { count: removedCount })}
        </div>
      ) : null}
    </div>
  );
}

export interface CardHeadProps {
  /** The card's summary element, so cards on one file read apart in a buttons list. */
  describedBy: string | undefined;
  file: string;
  jumpToChunk: (chunkId: string) => void;
  /** The full brief chunk the card stands for; absent leaves the file line alone. */
  ownerId: string | undefined;
}

function CardHead({ describedBy, file, jumpToChunk, ownerId }: CardHeadProps) {
  const { t } = useTranslation();
  const displayFile = formatDisplayPath(file);
  return (
    <div className={styles["chunkHead"]}>
      <div className={styles["chunkFile"]}>{displayFile}</div>
      {ownerId === undefined ? null : (
        <IconButton
          aria-describedby={describedBy}
          aria-label={t("brief.changes.showInFullAria", { file: displayFile })}
          callout="right"
          className={styles["chunkJump"]}
          label={t("brief.changes.showInFull")}
          onClick={() => jumpToChunk(ownerId)}
        >
          <Icon name={IconNames.ARROW_ELBOW_DOWN_RIGHT} size={IconSizes.MD} />
        </IconButton>
      )}
    </div>
  );
}

interface LastReviewChangesProps {
  /** The full brief and its model: their flags and chunks are what a section's regions match. */
  brief: Brief;
  fullModel: BriefViewModel;
  delta: Brief | null;
  deltaSkipped: boolean;
  deltaSpan: DeltaSpanStatus;
  deltaSpanLanding: DeltaSpanLanding | undefined;
  jumpToChunk: (chunkId: string) => void;
  review: ChangesReviewWiring | undefined;
}

/** The over-length muted line, shared by both comparisons. */
function LengthGuidanceNote() {
  const { t } = useTranslation();
  return (
    <p className={styles["restartNote"]} role="note">
      {t("brief.changes.lengthGuidance")}
    </p>
  );
}

function LastReviewChanges({
  brief,
  fullModel,
  delta,
  deltaSkipped,
  deltaSpan,
  deltaSpanLanding,
  jumpToChunk,
  review,
}: LastReviewChangesProps) {
  const { t } = useTranslation();
  if (!delta && deltaSkipped) {
    return (
      <EmptyState>
        <b>{t("brief.changes.changesSummaryTooLargeLead")}</b>{" "}
        {t("brief.changes.changesSummaryTooLargeBody")}
      </EmptyState>
    );
  }
  if (!delta) {
    return (
      <EmptyState>
        <b>{t("brief.changes.changesSummaryUnavailableLead")}</b>{" "}
        {t("brief.changes.changesSummaryUnavailableBody")}
      </EmptyState>
    );
  }
  const model = buildBriefViewModel(delta);
  const fullModelChunks = fullModel.groups.flatMap((group) => group.chunks);
  const spanRetry = deltaSpanLanding?.retry;
  return (
    <div
      className={styles["changesOnly"]}
      data-testid="last-review-changes"
      ref={deltaSpanLanding?.sectionRef}
      tabIndex={-1}
    >
      <div className={styles["eyebrow"]}>
        {t("brief.changes.eyebrowLastReview")}
      </div>
      {hasLengthViolations(delta) ? <LengthGuidanceNote /> : null}
      <div className={styles["overview"]}>
        <Markdown content={delta.summary} />
      </div>
      <DeltaContext brief={delta} />
      {spanRetry === undefined ? null : <DiffTimeoutNotice retry={spanRetry} />}
      <p className="sr-only" role="status">
        {deltaSpanLanding?.announcement}
      </p>
      {model.groups.map((group) => {
        if (group.kind !== GroupViewKinds.ATTRIBUTED) {
          return null;
        }
        return (
          <section className={styles["group"]} key={group.id}>
            <div className={styles["groupHead"]}>
              <h2 className={styles["groupTitle"]}>{group.group.title}</h2>
              <span className={styles["groupCategory"]}>
                {getCategoryLabel(t, group.group.dominantCategory)}
              </span>
            </div>
            <SectionFlags
              chunks={fullModelChunks}
              flags={fullModel.flags}
              group={group}
              jumpToChunk={jumpToChunk}
              regions={group.chunks}
            />
            {group.chunks.map((chunk) => (
              <DeltaCard
                brief={brief}
                chunk={chunk}
                deltaSpan={deltaSpan}
                jumpToChunk={jumpToChunk}
                key={chunk.id}
                review={review}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

interface DeltaCardProps {
  brief: Brief;
  chunk: BriefChunk;
  deltaSpan: DeltaSpanStatus;
  jumpToChunk: (chunkId: string) => void;
  review: ChangesReviewWiring | undefined;
}

function DeltaCard({
  brief,
  chunk,
  deltaSpan,
  jumpToChunk,
  review,
}: DeltaCardProps) {
  // A delta chunk's id is the delta's own, so the Full chunk comes from the
  // file and head lines.
  const ownerId = resolveCardOwnerChunkId(
    brief.chunks,
    chunk.file,
    chunk.addedRanges,
  );
  const summaryId = chunk.summary
    ? `${GuestHostPrefixes.DELTA}${chunk.id}-summary`
    : undefined;
  return (
    <div className={styles["chunk"]}>
      <CardHead
        describedBy={summaryId}
        file={chunk.file}
        jumpToChunk={jumpToChunk}
        ownerId={ownerId}
      />
      {chunk.summary ? (
        <p className={styles["chunkSummary"]} id={summaryId}>
          {chunk.summary}
        </p>
      ) : null}
      <DeltaChunkDiff chunk={chunk} deltaSpan={deltaSpan} review={review} />
    </div>
  );
}

interface DeltaChunkDiffProps {
  chunk: BriefChunk;
  deltaSpan: DeltaSpanStatus;
  review: ChangesReviewWiring | undefined;
}

/**
 * A delta chunk carries del rows beside their add replacements, so its rows
 * reconstruct as a hunk. The host id is the delta's own, prefixed, so it
 * never collides with a full brief chunk id the flow store keys on.
 */
function DeltaChunkDiff({ chunk, deltaSpan, review }: DeltaChunkDiffProps) {
  const { t } = useTranslation();
  const host = useMemo<BriefChunk>(
    () => ({
      ...chunk,
      id: `${GuestHostPrefixes.DELTA}${chunk.id}`,
      addedRanges: [],
      removedRanges: [],
      diff: shapeGuestRows(chunk.diff ?? [], t),
    }),
    [chunk, t],
  );

  if (host.diff === undefined || host.diff.length === 0) {
    // The summary stands alone while the span diff loads; a failed fetch
    // says so under it, the raw toggle's copy, with no retry of its own.
    if (deltaSpan !== DeltaSpanStatuses.ERROR) {
      return null;
    }
    return (
      <p className={styles["removedNote"]} role="note">
        {t("brief.diff.rawUnavailable")}
      </p>
    );
  }

  return (
    <GuestDiff
      chunk={host}
      review={review}
      tokenizeMode={TokenizeModes.HUNK}
      variant={GuestDiffVariants.CARD}
    />
  );
}

interface EmptyStateProps {
  children: React.ReactNode;
}

function EmptyState({ children }: EmptyStateProps) {
  return (
    <div className={styles["empty"]} role="status">
      {children}
    </div>
  );
}
