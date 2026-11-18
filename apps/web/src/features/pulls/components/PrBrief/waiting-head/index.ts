import type { GenerationPartsView, WaitReason } from "contract";
import type { TFunction } from "i18next";

import { PHASE_KEYS, REASONS_OVER_NOTICE, WAIT_REASON_KEYS } from "./consts";

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

/** A large run's parts sentence, one source for the waiting card and the newer-commits chip. */
export function describePartsProgress(
  t: TFunction,
  parts: GenerationPartsView,
): string {
  const { done, total } = parts;
  if (done === 0) {
    return t("pulls.wait.partsPlanned", { count: total });
  }
  return t("pulls.wait.partsDone", { done, total });
}
