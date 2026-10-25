// The wait surface for the DB-brief route. Announced via the polite live
// region the body owns; presentational.
import { WaitReasons, type WaitReason } from "contract";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock";
import type { Span } from "../../../utils/briefRouteState";
import type { RerunNoteInput } from "../failed-head";
import { PHASE_KEYS, REASONS_OVER_NOTICE, WAIT_REASON_KEYS } from "./consts";
import { LiveDiffPreview } from "./LiveDiffPreview";
import { selectWaitDetail } from "./utils";

export interface WaitCardProps {
  status: "pending" | "running";
  phase: string | undefined;
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
  /** The row and PR facts that name how a stalled head runs again. */
  rerun: RerunNoteInput;
}

export interface WaitLabelInput {
  status: "pending" | "running";
  phase: string | undefined;
  waitReason: WaitReason | undefined;
  pendingNotice: string | undefined;
}

/**
 * The damped notice states the real draft window, so it outranks the
 * debouncing line; once the wait is for a slot, or no job is left to run, the
 * draft wait is over and that line outranks the notice.
 */
function getPendingLabel(
  t: TFunction,
  waitReason: WaitReason | undefined,
  pendingNotice: string | undefined,
): string {
  if (waitReason === undefined) {
    return pendingNotice ?? t("pulls.wait.pending");
  }
  if (REASONS_OVER_NOTICE.has(waitReason)) {
    return t(WAIT_REASON_KEYS[waitReason]);
  }
  return pendingNotice ?? t(WAIT_REASON_KEYS[waitReason]);
}

/** The wait heading, which is also the live region's announcement. */
export function waitLabel(t: TFunction, input: WaitLabelInput): string {
  if (input.status === "pending") {
    return getPendingLabel(t, input.waitReason, input.pendingNotice);
  }

  const phaseKey =
    input.phase === undefined ? undefined : PHASE_KEYS.get(input.phase);
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
  rerun,
}: WaitCardProps) {
  const { t } = useTranslation();
  const heading = waitLabel(t, { status, phase, waitReason, pendingNotice });
  const stalled = status === "pending" && waitReason === WaitReasons.STALLED;
  const detail = selectWaitDetail(t, { span, stalled, rerun });

  return (
    <section aria-labelledby="wait-heading">
      <EmptyBlock
        busy={!stalled}
        detail={detail}
        heading={<h1 id="wait-heading">{heading}</h1>}
      >
        {span === undefined ? undefined : (
          <LiveDiffPreview prNumber={prNumber} repoId={repoId} span={span} />
        )}
      </EmptyBlock>
    </section>
  );
}
