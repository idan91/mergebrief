import type { ValueOf } from "types/utils";

export const BottomSheetHeights = {
  HALF: "half",
  FULL: "full",
} as const;

export type BottomSheetHeight = ValueOf<typeof BottomSheetHeights>;
