import type { ValueOf } from "types/utils";

export const CopyStates = {
  IDLE: "idle",
  COPIED: "copied",
  FAILED: "failed",
} as const;
export type CopyState = ValueOf<typeof CopyStates>;
