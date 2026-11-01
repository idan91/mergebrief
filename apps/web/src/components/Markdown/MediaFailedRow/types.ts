import type { ValueOf } from "types/utils";

/** The Media a failed row stands in for; a diagram falls back to its source instead. */
export const MediaFailedRowKinds = {
  IMAGE: "image",
  VIDEO: "video",
} as const;
export type MediaFailedRowKind = ValueOf<typeof MediaFailedRowKinds>;
