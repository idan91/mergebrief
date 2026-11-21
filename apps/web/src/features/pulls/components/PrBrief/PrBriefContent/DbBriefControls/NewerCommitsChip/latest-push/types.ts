import type { ValueOf } from "types/utils";

/** What the latest push is doing while it has no brief and an older one is on screen. */
export const LatestPushStates = {
  FAILED: "failed",
  AWAITING_TRIGGER: "awaiting-trigger",
  GENERATING: "generating",
  /** Pending behind a job that spent its attempts: nothing will run the head. */
  STALLED: "stalled",
  CAPPED: "capped",
  /** Trigger conditions hold it: it generates once they pass, or on Generate. */
  HELD: "held",
} as const;
export type LatestPushState = ValueOf<typeof LatestPushStates>;
