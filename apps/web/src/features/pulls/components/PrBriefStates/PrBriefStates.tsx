// Wait/failed/superseded/empty surfaces for the DB-brief route (BRIEF-19
// PR 3.2, ADR 0006 #10 diff-first wait). All states are announced via one
// polite live region owned by the route; these components are presentational.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { parseUnifiedDiffPatch } from "../../../brief/utils/diffSlicing";
import type { DiffLine } from "../../../brief/types";
import { prDiffQueryOptions } from "../../queries";
import { splitUnifiedDiffByFile } from "../../liveDiff";
import type { Span } from "../../briefRouteState";
import styles from "./PrBriefStates.module.scss";

export interface WaitCardProps {
  status: "queued" | "running";
  phase: string | null;
  /** Known span → diff-first wait; unknown (first brief) → phase-only. */
  span: Span | undefined;
  repoId: string;
  prNumber: number;
  /**
   * Draft-damping notice (BRIEF-64, own-draft only): replaces the queued
   * heading, whose "shortly" is wrong while the configured window runs.
   */
  queuedNotice?: string | undefined;
}

/**
 * Human label for the generation heading. "brief" is lowercase mid-sentence
 * (house naming rule: the artifact noun capitalizes only at sentence start;
 * product references say "MergeBrief"). A phase that is EXACTLY the verb
 * ("generating") would read "Generating the brief — generating…", so that
 * echo collapses to the phase-less heading; any other phase (writing,
 * generating-summary) is informative and still shows after the em dash.
 */
export function waitLabel(
  status: "queued" | "running",
  phase: string | null,
  queuedNotice?: string,
): string {
  if (status === "queued")
    // Under draft damping (BRIEF-64) "shortly" would lie — the notice text
    // (which states the configured window) replaces the queued heading.
    return queuedNotice ?? "Queued — the brief will start generating shortly.";
  if (phase === null) return "Generating the brief…";
  const phaseText = phase.replaceAll("-", " ");
  return phaseText.toLowerCase() === "generating"
    ? "Generating the brief…"
    : `Generating the brief — ${phaseText}…`;
}

export function WaitCard({
  status,
  phase,
  span,
  repoId,
  prNumber,
  queuedNotice,
}: WaitCardProps) {
  return (
    <section aria-labelledby="wait-heading" className={styles["card"]}>
      <h1 className={styles["heading"]} id="wait-heading">
        {waitLabel(status, phase, queuedNotice)}
      </h1>
      <span aria-hidden="true" className={styles["spinner"]} />
      <p className={styles["copy"]}>
        {span === undefined
          ? "The diff preview appears here once the span is known; the brief replaces it when ready."
          : "Read the raw diff while you wait — the brief replaces it when ready."}
      </p>
      {span === undefined ? null : (
        <LiveDiffPreview prNumber={prNumber} repoId={repoId} span={span} />
      )}
    </section>
  );
}

export interface FailedCardProps {
  error: string | null;
  attempts: number;
}

export function FailedCard({ error, attempts }: FailedCardProps) {
  return (
    <section aria-labelledby="failed-heading" className={styles["card"]}>
      <h1 className={styles["heading"]} id="failed-heading">
        Brief generation failed
      </h1>
      <p className={styles["copy"]}>
        {/* Sanitized at write time (first line, URLs redacted, capped). */}
        {error ?? "No failure detail was recorded."}
      </p>
      <p className={styles["meta"]}>
        {attempts + 1} attempt{attempts === 0 ? "" : "s"} so far. A new push
        re-queues generation automatically.
      </p>
    </section>
  );
}

export function SupersededCard() {
  return (
    <section aria-labelledby="superseded-heading" className={styles["card"]}>
      <h1 className={styles["heading"]} id="superseded-heading">
        A newer revision is on the way
      </h1>
      <span aria-hidden="true" className={styles["spinner"]} />
      <p className={styles["copy"]}>
        This push was superseded before its brief finished; the brief for the
        newest push will appear here automatically.
      </p>
    </section>
  );
}

/**
 * The empty-state copy. The default promises generation "on the next push" —
 * wrong under the instance drafts-off policy (BRIEF-64), so the own-draft
 * notice replaces it wholesale.
 */
export function emptyCardCopy(copyOverride: string | undefined): string {
  return (
    copyOverride ??
    "Generation starts automatically on the next push (or a submitted review) in a repository where the App is installed."
  );
}

export interface EmptyCardProps {
  /** Drafts-off notice (BRIEF-64, own-draft only); replaces the copy. */
  copyOverride?: string | undefined;
}

export function EmptyCard({ copyOverride }: EmptyCardProps) {
  return (
    <section aria-labelledby="empty-heading" className={styles["card"]}>
      <h1 className={styles["heading"]} id="empty-heading">
        No brief for this pull request yet
      </h1>
      <p className={styles["copy"]}>{emptyCardCopy(copyOverride)}</p>
    </section>
  );
}

export interface HeadAdvancedBannerProps {
  onNavigate: () => void;
}

/** Offered, never forced — the viewer stays pinned until they choose. */
export function HeadAdvancedBanner({ onNavigate }: HeadAdvancedBannerProps) {
  return (
    <div className={styles["banner"]} role="status">
      <span>This pull request has new commits since this brief's span.</span>
      <button className="btn" onClick={onNavigate} type="button">
        Go to the newest revision
      </button>
    </div>
  );
}

/** Shown next to a rendered brief while delta/comparison warmup still runs. */
export function WarmingChip() {
  return (
    <span className={styles["warmingChip"]} role="status">
      comparisons warming…
    </span>
  );
}

interface LiveDiffPreviewProps {
  repoId: string;
  prNumber: number;
  span: Span;
}

interface FileRows {
  readonly file: string;
  readonly rows: DiffLine[];
}

/**
 * Read-only whole-PR diff for the wait screen. Deliberately NOT the chunk
 * DiffTable (that one is wired to review comments/comparisons); this is the
 * ADR 0006 #10 "diff-first" placeholder.
 */
function LiveDiffPreview({ repoId, prNumber, span }: LiveDiffPreviewProps) {
  const diff = useQuery(
    prDiffQueryOptions(repoId, prNumber, span.base, span.head),
  );
  const files: FileRows[] = useMemo(() => {
    if (diff.data === undefined) return [];
    return [...splitUnifiedDiffByFile(diff.data)].map(([file, patch]) => ({
      file,
      rows: parseUnifiedDiffPatch(patch),
    }));
  }, [diff.data]);

  if (diff.isPending) {
    return <p className={styles["meta"]}>Loading the diff…</p>;
  }
  if (diff.isError || files.length === 0) {
    return (
      <p className={styles["meta"]}>The diff is not viewable right now.</p>
    );
  }
  return (
    <div className={styles["diff"]}>
      {files.map(({ file, rows }) => (
        <details
          className={styles["diffFile"]}
          key={file}
          open={files.length <= 5}
        >
          <summary>{file}</summary>
          <table className={styles["diffTable"]}>
            <caption className="sr-only">Diff for {file}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Old line</th>
                <th scope="col">New line</th>
                <th scope="col">Content</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr data-kind={row.kind} key={`${file}:${String(index)}`}>
                  <td className={styles["lineNo"]}>{row.oldLine ?? ""}</td>
                  <td className={styles["lineNo"]}>{row.newLine ?? ""}</td>
                  <td className={styles["lineContent"]}>{row.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}
