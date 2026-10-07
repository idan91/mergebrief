import type { ReviewDraftCommentRow, ReviewSessionError } from "persistence";
import type { SessionRejectedFailure } from "../../../../shared-errors/failures";

/** What a bound session write, or the session read, can refuse with. */
export type SessionWriteFailure = SessionRejectedFailure<ReviewSessionError>;

/**
 * A draft as a publish reads it before claiming: a session row, or before
 * the session exists, a carried draft named by its source row's id.
 */
export type HeldDraft = Pick<
  ReviewDraftCommentRow,
  | "id"
  | "carriedFromCommentId"
  | "anchor"
  | "body"
  | "status"
  | "anchorStatus"
  | "publishClaim"
  | "publishClaimedAt"
>;
