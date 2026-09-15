import type { ValueOf } from "types/utils";

import type { PrStack } from "../../../../types";

export const StackChipOpeners = {
  HOVER: "hover",
  CLICK: "click",
} as const;

export type StackChipOpener = ValueOf<typeof StackChipOpeners>;

export interface StackView {
  stack: PrStack;
  /** The generation-time stack, present only when it differs from `stack`. */
  snapshot?: PrStack;
}
