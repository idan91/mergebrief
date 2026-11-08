import type { GenerationSummaryView } from "contract";
import type { ValueOf } from "types/utils";

import type { UnknownValue } from "../open-enum/types";

/** Where a head's generation stands for a reader that waits on it. */
export const GenerationWaits = {
  SETTLED: "settled",
  IN_FLIGHT: "in-flight",
  /** In flight with nothing left to run it: the job spent its attempts. */
  STALLED: "stalled",
} as const;
export type GenerationWait = ValueOf<typeof GenerationWaits>;

export interface GenerationWaitInput {
  readonly status: GenerationSummaryView["status"] | UnknownValue;
  readonly waitReason?: GenerationSummaryView["waitReason"] | undefined;
}
