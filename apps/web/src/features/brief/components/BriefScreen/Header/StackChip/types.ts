import type { ValueOf } from "types/utils";

export const StackChipOpeners = {
  HOVER: "hover",
  CLICK: "click",
} as const;

export type StackChipOpener = ValueOf<typeof StackChipOpeners>;
