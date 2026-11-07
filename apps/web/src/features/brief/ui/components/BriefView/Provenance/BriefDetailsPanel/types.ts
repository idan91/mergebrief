import type { ValueOf } from "types/utils";

/** What the disclosure has open: the facts behind the ⓘ, or the chip's warnings. */
export const DetailsSurfaces = {
  FACTS: "facts",
  WARNINGS: "warnings",
} as const;
export type DetailsSurface = ValueOf<typeof DetailsSurfaces>;
