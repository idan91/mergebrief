import type { ValueOf } from "types/utils";

/** What the right edge can print; the stylesheet keys its colours on these. */
export const RowSignalKinds = {
  QUEUED: "queued",
  RUNNING: "running",
  FAILED: "failed",
  CAPPED: "capped",
  DRAFT: "draft",
  MERGED: "merged",
  CLOSED: "closed",
} as const;
export type RowSignalKind = ValueOf<typeof RowSignalKinds>;
