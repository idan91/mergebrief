import { WaitReasons } from "contract";
import { GenerationStatuses } from "types";

import {
  GenerationWaits,
  type GenerationWait,
  type GenerationWaitInput,
} from "./types";

/** Absent, terminal and unknown statuses read as settled: nothing to wait on. */
export function deriveGenerationWait(
  generation: GenerationWaitInput | undefined,
): GenerationWait {
  const status = generation?.status;
  const inFlight =
    status === GenerationStatuses.PENDING ||
    status === GenerationStatuses.RUNNING;
  if (!inFlight) {
    return GenerationWaits.SETTLED;
  }
  if (generation?.waitReason === WaitReasons.STALLED) {
    return GenerationWaits.STALLED;
  }
  return GenerationWaits.IN_FLIGHT;
}
