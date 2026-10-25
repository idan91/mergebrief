import type { ValueOf } from "types/utils";

/** What the latest push is doing while it has no brief and an older one is on screen. */
export const LatestPushStates = {
  FAILED: "failed",
  AWAITING_TRIGGER: "awaiting-trigger",
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

/** The button's text at rest and while its request is in flight. */
export interface LatestPushActionLabels {
  readonly action: string;
  readonly pending: string;
}

/** What the notice says about the latest push, before the facade wires the button. */
export interface LatestPushCopy {
  readonly label: string;
  readonly title: string;
  readonly detail?: string;
  /** Present only when the viewer may queue the run. */
  readonly actionLabels?: LatestPushActionLabels;
}
