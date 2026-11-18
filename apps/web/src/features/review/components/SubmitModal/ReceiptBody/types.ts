import type { ValueOf } from "types/utils";

/** The receipt's tabbed sections, one shown at a time. */
export const ReceiptSections = {
  SIGNATURE: "signature",
  RISKS: "risks",
  COMMENTS: "comments",
  NOT_CHECKED: "not-checked",
  RAW: "raw",
} as const;
export type ReceiptSection = ValueOf<typeof ReceiptSections>;
