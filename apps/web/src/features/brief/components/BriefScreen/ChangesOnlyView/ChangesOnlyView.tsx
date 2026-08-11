import { useTranslation } from "react-i18next";
import { Markdown } from "@web/components/Markdown/Markdown";
import { categoryLabel } from "../../../utils/viewModel";
import type { BriefViewModel } from "../../../utils/viewModel";
import { buildBriefViewModel } from "../../../utils/viewModel";
import type {
  Brief,
  BriefChunk,
  ComparisonMarks,
  DiffLine,
  LengthViolation,
  LineRange,
  RevisionNarrative,
  RevisionNarrativeChunk,
  RevisionNarrativeSkipReason,
} from "../../../types";
import type { ComparisonQuery } from "../../../comparison/comparisonQuery";
import { DeltaContext } from "../DeltaContext/DeltaContext";
import { RawSpanDiff } from "./RawSpanDiff/RawSpanDiff";
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
  /** The full Brief at the selected head — owns the Change-group taxonomy. */
  brief: Brief;
  /** View model for the full Brief (group order, titles, categories). */
  model: BriefViewModel;
  /** The Revision narrative for Previous Brief, or null when it failed. */
  narrative: RevisionNarrative | null;
  /** Full comparison marks — used to describe removed lines the diff can't show. */
  marks: ComparisonMarks | null;
  /** Distinct skip reason when the narrative was deliberately not generated. */
  skipReason: RevisionNarrativeSkipReason | null;
  /** The Delta Brief for Your last review, or null when unavailable. */
  delta: Brief | null;
  /**
   * The live span-diff descriptor for the ACTIVE compare baseline → selected
   * head. Present only on the DB timeline path while a compare lens is active
   * — it drives the "Show raw diff" toggle. Absent → just the summary.
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
  // change remounts and resets to the summary — both lenses can resolve to
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
  // Brief origin, not narrative content — so it renders independently of
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
          <b>No revision summary.</b> The change from the previous brief was{" "}
          {skipReason === "span too large"
            ? "too large to summarize incrementally"
            : "not summarized (disabled by config)"}
          . The highlighted lines in Full Brief still show what changed.
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
        Changes Only · since the previous Brief
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
        const chunks = narrative.chunks.filter(
          (chunk) => chunk.briefChangeGroupId === group.group.id,
        );
        if (chunks.length === 0) return null;
        return (
          <section className={styles["group"]} key={group.id}>
            <div className={styles["groupHead"]}>
              <h3 className={styles["groupTitle"]}>{group.group.title}</h3>
              <span className={styles["groupCategory"]}>
                {categoryLabel(group.group.dominantCategory)}
              </span>
            </div>
            {chunks.map((chunk) => (
              <NarrativeChunkCard brief={brief} chunk={chunk} key={chunk.id} />
            ))}
          </section>
        );
      })}
      {orphanChunks.length > 0 ? (
        <section className={styles["group"]}>
          <div className={styles["groupHead"]}>
            <h3 className={styles["groupTitle"]}>Other changes</h3>
          </div>
          {orphanChunks.map((chunk) => (
            <NarrativeChunkCard brief={brief} chunk={chunk} key={chunk.id} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

interface NarrativeChunkCardProps {
  brief: Brief;
  chunk: RevisionNarrativeChunk;
}

function NarrativeChunkCard({ brief, chunk }: NarrativeChunkCardProps) {
  const addedRows = addedRowsForNarrativeChunk(brief, chunk);
  const removedCount = countLines(chunk.removedRanges);
  return (
    <div className={styles["chunk"]}>
      <div className={styles["chunkFile"]}>{chunk.file}</div>
      <p className={styles["chunkSummary"]}>{chunk.summary}</p>
      {addedRows.length > 0 ? <ReadonlyDiff rows={addedRows} /> : null}
      {removedCount > 0 ? (
        <div className={styles["removedNote"]}>
          −{removedCount} line{removedCount === 1 ? "" : "s"} removed
        </div>
      ) : null}
    </div>
  );
}

interface LastReviewChangesProps {
  delta: Brief | null;
}

/** The over-length muted line — shared by both compare lenses. */
function LengthGuidanceNote() {
  return (
    <p className={styles["restartNote"]} role="note">
      Some brief text exceeds length guidance — a stronger model may keep
      summaries tighter.
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
        Changes Only · since your last review
      </div>
      {hasLengthViolations(delta) ? <LengthGuidanceNote /> : null}
      <div className={styles["overview"]}>
        <Markdown content={delta.summary} />
      </div>
      <DeltaContext brief={delta} />
      {model.groups.map((group) => (
        <section className={styles["group"]} key={group.id}>
          <div className={styles["groupHead"]}>
            <h3 className={styles["groupTitle"]}>{group.group.title}</h3>
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
              {chunk.diff && chunk.diff.length > 0 ? (
                <ReadonlyDiff rows={chunk.diff.filter(isCodeRow)} />
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

interface ReadonlyDiffProps {
  rows: DiffLine[];
}

/** Compact, read-only diff slice — no comment machinery (Changes Only is a read view). */
function ReadonlyDiff({ rows }: ReadonlyDiffProps) {
  return (
    <div className={styles["diff"]}>
      {rows.map((row, index) => (
        <div
          className={styles["row"]}
          data-kind={row.kind}
          key={`${row.kind}-${index}`}
        >
          <span className={styles["lineNo"]}>
            {row.newLine ?? row.oldLine ?? ""}
          </span>
          <span>
            {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
            {row.content}
          </span>
        </div>
      ))}
    </div>
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
 * head-coordinate diffs. Removed (prevHead-only) lines have no row at head —
 * the FE holds base→head diffs, not prevHead→head — so callers summarize
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
