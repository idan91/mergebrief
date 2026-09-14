// The wait surface for the DB-brief route. Announced via the polite live
// region the body owns; presentational.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { Span } from "../../../utils/briefRouteState";
import cardStyles from "../stateCard.module.scss";
import { LiveDiffPreview } from "./LiveDiffPreview/LiveDiffPreview";

export interface WaitCardProps {
  status: "pending" | "running";
  phase: string | null;
  /** Known span → diff-first wait; unknown (first brief) → phase-only. */
  span: Span | undefined;
  repoId: string;
  prNumber: number;
  /**
   * Draft-damping notice (own-draft only): replaces the pending heading, whose
   * "shortly" is wrong while the configured window runs.
   */
  pendingNotice?: string | undefined;
}

/**
 * Human label for the generation heading. A phase that is EXACTLY the verb
 * ("generating") would echo the verb straight back in the heading, so that
 * echo collapses to the phase-less heading; any other phase is informative
 * and still shows after the separator.
 */
export function waitLabel(
  t: TFunction,
  status: "pending" | "running",
  phase: string | null,
  pendingNotice?: string,
): string {
  if (status === "pending")
    // Under draft damping "shortly" would lie, so the notice text (which
    // states the configured window) replaces the pending heading.
    return pendingNotice ?? t("pulls.wait.pending");
  if (phase === null) return t("pulls.wait.generating");
  const phaseText = phase.replaceAll("-", " ");
  return phaseText.toLowerCase() === "generating"
    ? t("pulls.wait.generating")
    : t("pulls.wait.generatingPhase", { phase: phaseText });
}

export function WaitCard({
  status,
  phase,
  span,
  repoId,
  prNumber,
  pendingNotice,
}: WaitCardProps) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="wait-heading" className={cardStyles["card"]}>
      <h1 className={cardStyles["heading"]} id="wait-heading">
        {waitLabel(t, status, phase, pendingNotice)}
      </h1>
      <span aria-hidden="true" className={cardStyles["spinner"]} />
      <p className={cardStyles["copy"]}>
        {span === undefined
          ? t("pulls.wait.diffPending")
          : t("pulls.wait.diffReady")}
      </p>
      {span === undefined ? null : (
        <LiveDiffPreview prNumber={prNumber} repoId={repoId} span={span} />
      )}
    </section>
  );
}
