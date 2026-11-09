import type { ValueOf } from "types/utils";

export const ChunkFactsPlacements = {
  HEAD: "head",
  SHEET: "sheet",
} as const;
export type ChunkFactsPlacement = ValueOf<typeof ChunkFactsPlacements>;
