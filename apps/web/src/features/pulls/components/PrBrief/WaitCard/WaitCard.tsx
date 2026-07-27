// The wait surface for the DB-brief route (BRIEF-19, ADR 0006 #10 diff-first
// wait). Announced via the polite live region the body owns; presentational.
import type { Span } from "../../../briefRouteState";
import cardStyles from "../stateCard.module.scss";
import { LiveDiffPreview } from "./LiveDiffPreview/LiveDiffPreview";

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
    <section aria-labelledby="wait-heading" className={cardStyles["card"]}>
      <h1 className={cardStyles["heading"]} id="wait-heading">
        {waitLabel(status, phase, queuedNotice)}
      </h1>
      <span aria-hidden="true" className={cardStyles["spinner"]} />
      <p className={cardStyles["copy"]}>
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
