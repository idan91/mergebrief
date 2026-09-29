import { useTranslation } from "react-i18next";
import { useCallback, useMemo } from "react";
import { Markdown } from "@web/components/Markdown";
import { useReviewFlow } from "@web/features/review/session";
import { TokenizeModes } from "@web/utils/diffTokens/types";
import { estimateNarrativeCardHeight } from "../chunkHeightModel";
import { useGroupWindow } from "../useGroupWindow";
import { categoryLabel, GroupViewKinds } from "../../../utils/viewModel";
import type { BriefViewModel } from "../../../utils/viewModel";
import { buildBriefViewModel } from "../../../utils/viewModel";
import {
  type Brief,
  type BriefChunk,
  type ComparisonMarks,
  Concerns,
  GuestHostPrefixes,
  type RevisionNarrative,
  type RevisionNarrativeChunk,
  type RevisionNarrativeSkipReason,
  Roles,
} from "../../../types";
import type { ComparisonQuery } from "../../../comparison/comparisonQuery";
import type { FileRowsCache } from "../../../utils/fileRows";
import { DeltaContext } from "../DeltaContext";
import { type DeltaSpanStatus, DeltaSpanStatuses } from "../types";
import { GuestDiff } from "./GuestDiff";
import { RawSpanDiff } from "./RawSpanDiff";
import { GuestDiffVariants } from "./GuestDiff/types";
import { SectionFlags } from "./SectionFlags";
import type { ChangesReviewWiring } from "./types";
import {
  collectNarrativeRows,
  countLines,
  hasLengthViolations,
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
  compare: "previous-brief" | "last-review";
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
  /**
   * The live span-diff descriptor for the ACTIVE compare baseline → selected
   * head. Present only on the DB timeline path while a compare lens is active,
   * it drives the "Show raw diff" toggle. Absent → just the summary.
   */
  rawSpanDiff?: ComparisonQuery<string> | undefined;
  /** What the guest tables need to take a comment; absent leaves them inert. */
  review?: ChangesReviewWiring | undefined;
  /** Where the delta's rows stand; a card shows its summary first, rows when they land. */
  deltaSpan?: DeltaSpanStatus | undefined;
  /** Where a flag's jump lands: the screen exits to Full and lands on the chunk. */
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
    props.compare === "last-review" ? (
      <LastReviewChanges
        brief={props.brief}
        delta={props.delta}
        deltaSpan={props.deltaSpan ?? DeltaSpanStatuses.ABSENT}
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
  if (props.rawSpanDiff === undefined) return summary;
  // Key on the LENS plus the addressed span so a lens switch or revision
  // change remounts and resets to the summary, both lenses can resolve to
  // the SAME span, and a lens switch is still a view change.
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

  // Deduped: the collector can emit the same line once per direction.
  const warnings = [...new Set(narrative.generationWarnings ?? [])];

  return (
    <div className={styles["changesOnly"]}>
      <div className={styles["eyebrow"]}>
        {t("brief.changes.eyebrowPreviousBrief")}
      </div>
      {restartNote}
      {lengthNote}
      {warnings.length > 0 ? (
        <div className={styles["generationWarnings"]} role="note">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}
      <p className={styles["overview"]}>{narrative.overview}</p>
      {model.groups.map((group) => {
        if (group.kind !== GroupViewKinds.ATTRIBUTED) return null;
        const chunks = narrative.chunks.filter(
          (chunk) => chunk.briefChangeGroupId === group.group.id,
        );
        if (chunks.length === 0) return null;
        return (
          <section className={styles["group"]} key={group.id}>
            <div className={styles["groupHead"]}>
              <h2 className={styles["groupTitle"]}>{group.group.title}</h2>
              <span className={styles["groupCategory"]}>
                {categoryLabel(group.group.dominantCategory)}
              </span>
            </div>
            <SectionFlags
              chunks={brief.chunks}
              flags={model.flags}
              group={group}
              jumpToChunk={jumpToChunk}
              regions={chunks}
            />
            <WindowedNarrativeList
              brief={brief}
              chunks={chunks}
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
 * offscreen, as a story card does. No jump registry, nothing navigates to a
 * narrative card by id.
 */
function WindowedNarrativeList({
  brief,
  chunks,
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
        if (!chunk) return null;
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
  review: ChangesReviewWiring | undefined;
  spanRows: FileRowsCache | undefined;
}

function NarrativeChunkCard({
  brief,
  chunk,
  review,
  spanRows,
}: NarrativeChunkCardProps) {
  const { t } = useTranslation();
  const fileSpanRows = spanRows?.getFileRows(chunk.file);
  // The snippet key and the guest input derive from these identities.
  const narrative = useMemo(
    () => collectNarrativeRows(brief, chunk, t, fileSpanRows),
    [brief, chunk, fileSpanRows, t],
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
  return (
    <div className={styles["chunk"]}>
      <div className={styles["chunkFile"]}>{chunk.file}</div>
      <p className={styles["chunkSummary"]}>{chunk.summary}</p>
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

interface LastReviewChangesProps {
  /** The full brief and its model: their flags and chunks are what a section's regions match. */
  brief: Brief;
  fullModel: BriefViewModel;
  delta: Brief | null;
  deltaSpan: DeltaSpanStatus;
  jumpToChunk: (chunkId: string) => void;
  review: ChangesReviewWiring | undefined;
}

/** The over-length muted line, shared by both compare lenses. */
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
  deltaSpan,
  jumpToChunk,
  review,
}: LastReviewChangesProps) {
  const { t } = useTranslation();
  if (!delta) {
    return (
      <EmptyState>
        <b>{t("brief.changes.changesSummaryUnavailableLead")}</b>{" "}
        {t("brief.changes.changesSummaryUnavailableBody")}
      </EmptyState>
    );
  }
  const model = buildBriefViewModel(delta);
  return (
    <div className={styles["changesOnly"]}>
      <div className={styles["eyebrow"]}>
        {t("brief.changes.eyebrowLastReview")}
      </div>
      {hasLengthViolations(delta) ? <LengthGuidanceNote /> : null}
      <div className={styles["overview"]}>
        <Markdown content={delta.summary} />
      </div>
      <DeltaContext brief={delta} />
      {model.groups.map((group) => {
        if (group.kind !== GroupViewKinds.ATTRIBUTED) return null;
        return (
          <section className={styles["group"]} key={group.id}>
            <div className={styles["groupHead"]}>
              <h2 className={styles["groupTitle"]}>{group.group.title}</h2>
              <span className={styles["groupCategory"]}>
                {categoryLabel(group.group.dominantCategory)}
              </span>
            </div>
            <SectionFlags
              chunks={brief.chunks}
              flags={fullModel.flags}
              group={group}
              jumpToChunk={jumpToChunk}
              regions={group.chunks}
            />
            {group.chunks.map((chunk) => (
              <div className={styles["chunk"]} key={chunk.id}>
                <div className={styles["chunkFile"]}>{chunk.file}</div>
                {chunk.summary ? (
                  <p className={styles["chunkSummary"]}>{chunk.summary}</p>
                ) : null}
                <DeltaChunkDiff
                  chunk={chunk}
                  deltaSpan={deltaSpan}
                  review={review}
                />
              </div>
            ))}
          </section>
        );
      })}
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
