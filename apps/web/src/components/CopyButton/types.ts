import type { ValueOf } from "types/utils";

export const CopyStates = {
  IDLE: "idle",
  COPIED: "copied",
  FAILED: "failed",
} as const;
export type CopyState = ValueOf<typeof CopyStates>;

/** A copy control's outcome, the action that produces it, and what to announce. */
export interface CopyFeedback {
  state: CopyState;
  copy: () => Promise<void>;
  announcement: string;
}
