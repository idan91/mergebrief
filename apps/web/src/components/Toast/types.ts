import type { ValueOf } from "types/utils";

/** What keeps a result line on screen: the pointer over it, focus inside it, or its action waiting on a request. */
export const ToastHoldSources = {
  POINTER: "pointer",
  FOCUS: "focus",
  PENDING: "pending",
} as const;
export type ToastHoldSource = ValueOf<typeof ToastHoldSources>;

export interface ToastAction {
  label: string;
  run: () => void;
  /** Spoken with the message, for a reader who cannot see where the action sits. */
  hint?: string;
}
