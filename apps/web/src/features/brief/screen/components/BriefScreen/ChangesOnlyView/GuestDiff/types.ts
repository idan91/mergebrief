import type { ValueOf } from "types/utils";

/** A card frames its own diff; a span file sits inside the file panel already. */
export const GuestDiffVariants = {
  CARD: "card",
  FILE: "file",
} as const;
export type GuestDiffVariant = ValueOf<typeof GuestDiffVariants>;
