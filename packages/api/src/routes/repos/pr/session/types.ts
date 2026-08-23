import type { ReviewSessionError } from "persistence";
import type { SessionRejectedFailure } from "../../../../shared-errors/failures";

/**
 * The Brief the carry-over would be evaluated against will not parse. This
 * is the dangerous side of the read route's version of the same failure:
 * empty facts here would MATERIALIZE every carried decision as `DROPPED`.
 */
export interface UnreadableBriefFailure {
  readonly kind: "unreadable-brief";
}

/** What a bound session write can refuse with. */
export type SessionWriteFailure =
  | SessionRejectedFailure<ReviewSessionError>
  | UnreadableBriefFailure;
