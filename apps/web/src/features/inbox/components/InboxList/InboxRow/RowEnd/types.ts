import type { ValueOf } from "types/utils";

/** What the right edge can print; the stylesheet keys its colours on these. */
export const RowSignalKinds = {
  QUEUED: "queued",
  RUNNING: "running",
  FAILED: "failed",
  CAPPED: "capped",
  AWAITING_TRIGGER: "awaiting-trigger",
  /** Trigger conditions hold the head, and one needs someone to act. */
  HELD: "held",
  /** Trigger conditions hold the head, and each clears by itself. */
  WAITING: "waiting",
  DRAFT: "draft",
  MERGED: "merged",
  CLOSED: "closed",
} as const;
export type RowSignalKind = ValueOf<typeof RowSignalKinds>;
