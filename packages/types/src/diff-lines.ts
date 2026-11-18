import type { ValueOf } from "./utils";

/** What one row of a parsed unified diff is. */
export const DiffLineKinds = {
  HUNK: "hunk",
  ADD: "add",
  DEL: "del",
  CTX: "ctx",
  NOTE: "note",
} as const;
export type DiffLineKind = ValueOf<typeof DiffLineKinds>;
