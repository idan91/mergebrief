import type { DiffLine } from "@web/utils/diffTokens/types";
import { useTranslation } from "react-i18next";
import { useCallback, useMemo, type ReactNode } from "react";
import { Markdown } from "@web/components/Markdown";
import { estimateNarrativeCardHeight } from "../chunkHeightModel";
import { useGroupWindow } from "../useGroupWindow";
import { DiffRows } from "@web/components/DiffRows";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { useSnippetTokens } from "@web/hooks/useSnippetTokens";
import { useTokenPlan } from "@web/hooks/useTokenPlan";
import {
  ChunkTokenStatuses,
  TokenizeModes,
  type TokenizeMode,
} from "@web/utils/diffTokens/types";
import { buildSnippetKey } from "@web/utils/diffTokens/utils";
import { categoryLabel, GroupViewKinds } from "../../../utils/viewModel";
import type { BriefViewModel } from "../../../utils/viewModel";
import { buildBriefViewModel } from "../../../utils/viewModel";
import type {
  Brief,
  BriefChunk,
  ComparisonMarks,
  LengthViolation,
  LineRange,
  RevisionNarrative,
  RevisionNarrativeChunk,
  RevisionNarrativeSkipReason,
} from "../../../types";
import type { ComparisonQuery } from "../../../comparison/comparisonQuery";
import { DeltaContext } from "../DeltaContext";
import { RawSpanDiff } from "./RawSpanDiff";
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
}

export function ChangesOnlyView(props: ChangesOnlyViewProps) {
  const summary =
    props.compare === "last-review" ? (
      <LastReviewChanges delta={props.delta} />
    ) : (
      <PreviousBriefChanges
        brief={props.brief}
        model={props.model}
        narrative={props.narrative}
        skipReason={props.skipReason}
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
    >
      {summary}
    </RawSpanDiff>
  );
}

interface PreviousBriefChangesProps {
  brief: Brief;
  model: BriefViewModel;
  narrative: RevisionNarrative | null;
  skipReason: RevisionNarrativeSkipReason | null;
}

function PreviousBriefChanges({
  brief,
  model,
  narrative,
  skipReason,
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
            <WindowedNarrativeList brief={brief} chunks={chunks} />
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
          <WindowedNarrativeList brief={brief} chunks={orphanChunks} />
        </section>
      ) : null}
    </div>
  );
}

interface WindowedNarrativeListProps {
  brief: Brief;
  chunks: readonly RevisionNarrativeChunk[];
}

/**
 * Windowed narrative cards, same shape as the story pane's chunk column:
 * absolute cards in a totalSize column, explicit inline-size (absolute cards
 * have no intrinsic width). No jump registry, nothing navigates to a
 * narrative card by id.
 */
function WindowedNarrativeList({ brief, chunks }: WindowedNarrativeListProps) {
  const chunkKeys = useMemo(
    () => chunks.map((chunk) => `${chunk.file}#${chunk.id}`),
    [chunks],
  );
  const estimateChunk = useCallback(
    (index: number) => {
      const chunk = chunks[index];
      if (!chunk) return 0;
      return estimateNarrativeCardHeight({
        addedRowCount: countLines(chunk.addedRanges),
        hasRemovedNote: countLines(chunk.removedRanges) > 0,
      });
    },
    [chunks],
  );
  const window = useGroupWindow({ chunkKeys, estimateChunk });
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
            <NarrativeChunkCard brief={brief} chunk={chunk} />
          </div>
        );
      })}
    </div>
  );
}

interface NarrativeChunkCardProps {
  brief: Brief;
  chunk: RevisionNarrativeChunk;
}

function NarrativeChunkCard({ brief, chunk }: NarrativeChunkCardProps) {
  const { t } = useTranslation();
  // The snippet key is derived from this array's identity.
  const addedRows = useMemo(
    () => addedRowsForNarrativeChunk(brief, chunk),
    [brief, chunk],
  );
  const removedCount = countLines(chunk.removedRanges);
  return (
    <div className={styles["chunk"]}>
      <div className={styles["chunkFile"]}>{chunk.file}</div>
      <p className={styles["chunkSummary"]}>{chunk.summary}</p>
      {addedRows.length > 0 ? (
        <ReadonlyDiff file={chunk.file} rows={addedRows} />
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
  delta: Brief | null;
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

function hasLengthViolations(
  ...artifacts: ({ lengthViolations?: LengthViolation[] } | null)[]
): boolean {
  return artifacts.some(
    (artifact) => (artifact?.lengthViolations ?? []).length > 0,
  );
}

function LastReviewChanges({ delta }: LastReviewChangesProps) {
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
            {group.chunks.map((chunk) => (
              <div className={styles["chunk"]} key={chunk.id}>
                <div className={styles["chunkFile"]}>{chunk.file}</div>
                {chunk.summary ? (
                  <p className={styles["chunkSummary"]}>{chunk.summary}</p>
                ) : null}
                <DeltaChunkDiff chunk={chunk} />
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
}

/**
 * A delta chunk carries del rows beside their add replacements, so its rows
 * reconstruct as a hunk. The filtered array is memoized because the snippet
 * key is derived from its identity.
 */
function DeltaChunkDiff({ chunk }: DeltaChunkDiffProps) {
  const rows = useMemo(
    () => (chunk.diff ?? []).filter(isCodeRow),
    [chunk.diff],
  );

  if (rows.length === 0) return null;

  return (
    <ReadonlyDiff file={chunk.file} mode={TokenizeModes.HUNK} rows={rows} />
  );
}

interface ReadonlyDiffProps {
  file: string;
  rows: DiffLine[];
  /**
   * Added-only rows are one side already. Rows carrying del beside its add
   * replacement have to reconstruct, or the two spell one broken statement.
   */
  mode?: TokenizeMode | undefined;
}

/** Compact, read-only diff slice; Changes Only is a read view with no comment machinery. */
function ReadonlyDiff({ file, rows, mode }: ReadonlyDiffProps) {
  const { t } = useTranslation();
  const plan = useTokenPlan();
  const snippetKey = useMemo(() => buildSnippetKey(file, rows), [file, rows]);
  const tokens = useSnippetTokens({
    briefKey: plan.briefKey,
    snippetKey,
    filePath: file,
    rows,
    admitted: plan.admitted,
    mode,
  });
  const tokensByRow =
    tokens.status === ChunkTokenStatuses.READY ? tokens.tokensByRow : undefined;

  return (
    <div className={styles["diff"]}>
      <table className={styles["diffTable"]}>
        <ScreenReaderOnly as="caption">
          {t("brief.diff.caption", { file })}
        </ScreenReaderOnly>
        <DiffRows
          gutterCell={buildNarrativeLineNumber}
          lineNumbers={false}
          rows={rows}
          tokensByRow={tokensByRow}
          tokensPending={tokens.status === ChunkTokenStatuses.PENDING}
        />
      </table>
    </div>
  );
}

/** One line number per row: the narrative slice is one side of the file. */
function buildNarrativeLineNumber(row: DiffLine): ReactNode {
  return (
    <td className={styles["lineNo"]}>{row.newLine ?? row.oldLine ?? ""}</td>
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

function isCodeRow(row: DiffLine): boolean {
  return row.kind === "add" || row.kind === "del" || row.kind === "ctx";
}

function lineInRanges(line: number | undefined, ranges: LineRange[]): boolean {
  return (
    typeof line === "number" &&
    ranges.some((range) => line >= range.start && line <= range.end)
  );
}

function countLines(ranges: LineRange[]): number {
  return ranges.reduce(
    (total, range) => total + (range.end - range.start + 1),
    0,
  );
}

/**
 * The added/context rows for a narrative chunk, pulled from the full Brief's
 * head-coordinate diffs. Removed (prevHead-only) lines have no row at head,
 * the FE holds base→head diffs, not prevHead→head, so callers summarize
 * those as a count instead.
 */
function addedRowsForNarrativeChunk(
  brief: Brief,
  chunk: RevisionNarrativeChunk,
): DiffLine[] {
  const rows: DiffLine[] = [];
  for (const briefChunk of chunksForFile(brief, chunk.file)) {
    if (!briefChunk.diff) continue;
    for (const row of briefChunk.diff) {
      if (
        (row.kind === "add" || row.kind === "ctx") &&
        lineInRanges(row.newLine, chunk.addedRanges)
      ) {
        rows.push(row);
      }
    }
  }
  return rows;
}

function chunksForFile(brief: Brief, file: string): BriefChunk[] {
  return brief.chunks.filter((chunk) => chunk.file === file);
}
