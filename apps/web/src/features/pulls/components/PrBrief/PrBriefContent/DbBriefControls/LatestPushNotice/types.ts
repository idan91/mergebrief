import type { ValueOf } from "types/utils";

/** What the latest push is doing while it has no brief and an older one is on screen. */
export const LatestPushStates = {
  FAILED: "failed",
  GENERATING: "generating",
  CAPPED: "capped",
} as const;
export type LatestPushState = ValueOf<typeof LatestPushStates>;

/** The one run the viewer may queue for the latest push. */
export interface LatestPushAction {
  /** The request is in flight. */
  readonly pending: boolean;
  /** The button's text, already switched for the pending state. */
  readonly label: string;
  readonly onTrigger: () => void;
}
