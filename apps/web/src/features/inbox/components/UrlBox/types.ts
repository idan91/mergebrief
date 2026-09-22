import type { ValueOf } from "types/utils";

/** The form's two looks: the field, or one line of status while GitHub is read. */
export const UrlBoxStates = {
  IDLE: "idle",
  PROGRESS: "progress",
} as const;
/** @public */
export type UrlBoxState = ValueOf<typeof UrlBoxStates>;
