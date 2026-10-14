import type { ValueOf } from "types";

/** Where an archive was asked from: a row's menu, or the selection bar. */
export const ArchiveScopes = {
  ROW: "row",
  SELECTION: "selection",
} as const;
export type ArchiveScope = ValueOf<typeof ArchiveScopes>;
