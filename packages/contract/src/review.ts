// The review submit's wire shapes: what it sends and the receipt it answers.
import type { ReviewOutcome } from "types";

/** `submit-review`. The comments are the drafts the session holds, never sent. */
export interface SubmitReviewBody {
  readonly outcome: ReviewOutcome;
  /** Required and non-blank for `request-changes`. */
  readonly body?: string;
}

/** What `submit-review` answers, with 201. */
export interface SubmitReviewResponse {
  readonly reviewId: number;
  /** `commentsFolded > 0`, kept for one release. */
  readonly commentsDegraded: boolean;
  /** Comments GitHub would not anchor, folded into the review body. */
  readonly commentsFolded: number;
  readonly commentsTotal: number;
}
