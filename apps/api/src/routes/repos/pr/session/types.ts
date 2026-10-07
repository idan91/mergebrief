import type { ReviewSessionError } from "persistence";
import type { SessionRejectedFailure } from "../../../../shared-errors/failures";

/** What a bound session write, or the session read, can refuse with. */
export type SessionWriteFailure = SessionRejectedFailure<ReviewSessionError>;
