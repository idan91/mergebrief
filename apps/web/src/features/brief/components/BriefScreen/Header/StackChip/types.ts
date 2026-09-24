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
  /** ISO time `stack` was recorded, when it is the record rather than live. */
  asOf?: string;
  /** `stack` is the generation-time one, standing in for a closed PR. */
  atGeneration?: true;
}
