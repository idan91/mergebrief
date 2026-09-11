import type { ValueOf } from "types";

export const StackChipOpeners = {
  HOVER: "hover",
  CLICK: "click",
} as const;

export type StackChipOpener = ValueOf<typeof StackChipOpeners>;
