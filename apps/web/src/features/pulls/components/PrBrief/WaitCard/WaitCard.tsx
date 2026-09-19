// The wait surface for the DB-brief route. Announced via the polite live
// region the body owns; presentational.
import { WaitReasons, type WaitReason } from "contract";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { Span } from "../../../utils/briefRouteState";
import cardStyles from "../stateCard.module.scss";
import { PHASE_KEYS, WAIT_REASON_KEYS } from "./consts";
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
  /** Why a pending generation has not started; absent shows the generic line. */
  waitReason?: WaitReason | undefined;
}

export interface WaitLabelInput {
  status: "pending" | "running";
  phase: string | null;
  waitReason: WaitReason | undefined;
  pendingNotice: string | undefined;
}

/**
 * The damped notice states the real draft window, so it outranks the
 * debouncing line; once the wait is for a slot the draft wait is over and the
 * slot line outranks the notice.
 */
function getPendingLabel(
  t: TFunction,
  waitReason: WaitReason | undefined,
  pendingNotice: string | undefined,
): string {
  if (waitReason === WaitReasons.WAITING_FOR_SLOT) {
    return t(WAIT_REASON_KEYS[waitReason]);
  }
  if (pendingNotice !== undefined) {
    return pendingNotice;
  }
  if (waitReason === undefined) {
    return t("pulls.wait.pending");
  }
  return t(WAIT_REASON_KEYS[waitReason]);
}

/** The wait heading, which is also the live region's announcement. */
export function waitLabel(t: TFunction, input: WaitLabelInput): string {
  if (input.status === "pending") {
    return getPendingLabel(t, input.waitReason, input.pendingNotice);
  }

  const phaseKey =
    input.phase === null ? undefined : PHASE_KEYS.get(input.phase);
  return t(phaseKey ?? "pulls.wait.generating");
}

export function WaitCard({
  status,
  phase,
  span,
  repoId,
  prNumber,
  pendingNotice,
  waitReason,
}: WaitCardProps) {
  const { t } = useTranslation();
  const heading = waitLabel(t, { status, phase, waitReason, pendingNotice });
  return (
    <section aria-labelledby="wait-heading" className={cardStyles["card"]}>
      <h1 className={cardStyles["heading"]} id="wait-heading">
        {heading}
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
