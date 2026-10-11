import { HttpStatuses } from "types/http";
import { GitHubApiErrorCodes, type GitHubApiErrorCode } from "../errors";
import { PullRequestReviewStates } from "../operations/review-pending";
import { ReviewEvents, type ReviewEvent } from "../operations/review-submit";
import { FakeFailures, type FakeFailure } from "./types";

interface FailureAnswer {
  readonly code: GitHubApiErrorCode;
  /** Absent for a refusal the operation finds in a 200's payload. */
  readonly status?: number;
}

export const FAILURE_ANSWERS: Readonly<Record<FakeFailure, FailureAnswer>> = {
  [FakeFailures.NOT_FOUND]: {
    code: GitHubApiErrorCodes.NOT_FOUND,
    status: HttpStatuses.NOT_FOUND,
  },
  [FakeFailures.FORBIDDEN]: {
    code: GitHubApiErrorCodes.FORBIDDEN,
    status: HttpStatuses.FORBIDDEN,
  },
  [FakeFailures.UNAUTHORIZED]: {
    code: GitHubApiErrorCodes.UNAUTHORIZED,
    status: HttpStatuses.UNAUTHORIZED,
  },
  [FakeFailures.RATE_LIMITED]: {
    code: GitHubApiErrorCodes.RATE_LIMITED,
    status: HttpStatuses.FORBIDDEN,
  },
  [FakeFailures.SERVER_ERROR]: {
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    status: HttpStatuses.BAD_GATEWAY,
  },
  [FakeFailures.ANCHOR_REJECTED]: {
    code: GitHubApiErrorCodes.ANCHOR_REJECTED,
    status: HttpStatuses.UNPROCESSABLE_CONTENT,
  },
  [FakeFailures.UNKNOWN_COMMIT]: {
    code: GitHubApiErrorCodes.UNKNOWN_COMMIT,
    status: HttpStatuses.UNPROCESSABLE_CONTENT,
  },
  [FakeFailures.NOT_ACCEPTABLE]: {
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    status: HttpStatuses.NOT_ACCEPTABLE,
  },
  [FakeFailures.NOT_A_BLOB]: { code: GitHubApiErrorCodes.NOT_A_BLOB },
  [FakeFailures.NOT_TEXT]: { code: GitHubApiErrorCodes.NOT_TEXT },
};

/** Where each id sequence starts; distinct so a swapped id never matches. */
export const FIRST_IDS = {
  REVIEW: 77n,
  REVIEW_COMMENT: 901n,
  ISSUE_COMMENT: 1001n,
  THREAD: 1n,
  COMMIT: 1n,
} as const;

export const COMMIT_SHA_LENGTH = 40;

export const SUBMITTED_STATES = {
  [ReviewEvents.APPROVE]: PullRequestReviewStates.APPROVED,
  [ReviewEvents.REQUEST_CHANGES]: PullRequestReviewStates.CHANGES_REQUESTED,
  [ReviewEvents.COMMENT]: PullRequestReviewStates.COMMENTED,
} as const satisfies Record<ReviewEvent, string>;
