import { DispositionDecisions, type ValueOf } from "types";

import { WriteFailureKinds } from "../../../data/request/types";

/** A flag's state in the session: one of the two stored decisions, or none yet. */
export const DispositionKinds = {
  OPEN: "open",
  ADDRESSED: DispositionDecisions.ADDRESSED,
  DISMISSED: DispositionDecisions.DISMISSED,
} as const;
export type DispositionKind = ValueOf<typeof DispositionKinds>;

/** How a session write was refused; `frozen` is terminal for the screen. */
export const SessionWriteFailureKinds = {
  FROZEN: "frozen",
  DRAFT_LIMIT: "draft-limit",
  RECORD_LIMIT: "record-limit",
  ALREADY_PUBLISHED: "already-published",
  PUBLISH_PENDING: "publish-pending",
  PUBLISH_IN_DOUBT: "publish-in-doubt",
  HUMAN_ONLY: "human-only",
  FAILED: "failed",
  UNAUTHORIZED: WriteFailureKinds.UNAUTHORIZED,
  INDETERMINATE: WriteFailureKinds.INDETERMINATE,
} as const;
export type SessionWriteFailureKind = ValueOf<typeof SessionWriteFailureKinds>;
