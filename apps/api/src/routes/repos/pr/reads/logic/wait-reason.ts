import { WaitReasons, type WaitReason } from "contract";
import type { GenerateJobTiming } from "persistence";
import { GenerationStatuses, type GenerationStatus } from "types/generations";

type DerivedWaitReason = WaitReason | undefined;

/**
 * A reason exists only for a pending generation whose queued job no worker
 * holds. A locked job is about to flip the row to running, so it has none.
 */
export function deriveWaitReason(
  status: GenerationStatus,
  timing: GenerateJobTiming | undefined,
): DerivedWaitReason {
  if (status !== GenerationStatuses.PENDING) {
    return undefined;
  }
  if (timing === undefined || timing.locked) {
    return undefined;
  }

  return timing.startsLater
    ? WaitReasons.DEBOUNCING
    : WaitReasons.WAITING_FOR_SLOT;
}
