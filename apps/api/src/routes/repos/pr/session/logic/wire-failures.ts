import { ApiErrorCodes } from "contract";
import { ReviewSessionErrorCodes } from "persistence";
import {
  Conflict,
  InternalError,
  NotFound,
} from "../../../../../shared-errors/api-error";
import type { SessionOperationFailure, SessionWriteFailure } from "../types";

/**
 * The store's expected refusals, mapped to the wire. An unreadable Brief is a
 * retryable 500, never empty facts that would drop carried decisions.
 */
export function throwSessionWriteFailure(failure: SessionWriteFailure): never {
  switch (failure.error.code) {
    case ReviewSessionErrorCodes.BRIEF_UNREADABLE:
      throw new InternalError();
    case ReviewSessionErrorCodes.SESSION_FROZEN:
      throw new Conflict(ApiErrorCodes.PR_CHANGED_SINCE_READ);
    case ReviewSessionErrorCodes.DRAFT_ALREADY_PUBLISHED:
      throw new Conflict(ApiErrorCodes.DRAFT_ALREADY_PUBLISHED);
    case ReviewSessionErrorCodes.DRAFT_LIMIT_REACHED:
      throw new Conflict(ApiErrorCodes.DRAFT_LIMIT_REACHED);
    case ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED:
      throw new Conflict(ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED);
    case ReviewSessionErrorCodes.DRAFT_ANCHOR_ORPHANED:
      throw new Conflict(ApiErrorCodes.DRAFT_ANCHOR_ORPHANED);
    case ReviewSessionErrorCodes.DRAFT_PUBLISH_PENDING:
      throw new Conflict(ApiErrorCodes.DRAFT_PUBLISH_PENDING);
    case ReviewSessionErrorCodes.DRAFT_PUBLISH_IN_DOUBT:
      throw new Conflict(ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT);
    case ReviewSessionErrorCodes.SESSION_NOT_FOUND:
      throw new NotFound();
  }
}

/** An unknown Brief is the subtree's hint-free 404. */
export function throwSessionFailure(failure: SessionOperationFailure): never {
  if (failure.kind === "target-not-found") {
    throw new NotFound();
  }
  throwSessionWriteFailure(failure);
}
