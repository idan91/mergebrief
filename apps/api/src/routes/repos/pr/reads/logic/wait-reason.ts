import { WaitReasons, type WaitReason } from "contract";
import type { GenerateJobTiming, TakeoverJob } from "persistence";
import {
  GenerationStatuses,
  TakeoverJobStates,
  type GenerationStatus,
} from "types/generations";

type DerivedWaitReason = WaitReason | undefined;

/**
 * A reason exists only for a pending generation whose queued job no worker
 * holds. A locked job is about to flip the row to running, so it has none. A
 * job that spent its attempts never runs: the head is stalled unless its
 * Takeover is queued or running.
 */
export function deriveWaitReason(
  status: GenerationStatus,
  timing: GenerateJobTiming | undefined,
  takeover: TakeoverJob | undefined,
): DerivedWaitReason {
  if (status !== GenerationStatuses.PENDING) {
    return undefined;
  }
  if (timing === undefined || timing.locked) {
    return undefined;
  }
  if (!timing.hasAttemptsLeft) {
    return isTakeoverComing(takeover) ? undefined : WaitReasons.STALLED;
  }

  return timing.startsLater
    ? WaitReasons.DEBOUNCING
    : WaitReasons.WAITING_FOR_SLOT;
}

function isTakeoverComing(takeover: TakeoverJob | undefined): boolean {
  const state = takeover?.state;
  const coming =
    state === TakeoverJobStates.SCHEDULED ||
    state === TakeoverJobStates.RUNNING;
  return coming;
}
