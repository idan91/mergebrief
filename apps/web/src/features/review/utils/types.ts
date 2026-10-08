import type { ValueOf } from "types/utils";

export const SubmitReviewResultKinds = {
  SUBMITTED: "submitted",
  REWRITTEN: "rewritten",
  UNAUTHORIZED: "unauthorized",
  NOT_FOUND: "not-found",
  ORPHANED_DRAFT: "orphaned-draft",
  INVALID: "invalid",
  NO_WRITE_ACCESS: "no-write-access",
  GITHUB_PERMISSION: "github-permission",
  UPSTREAM: "upstream",
  INDETERMINATE: "indeterminate",
  PENDING_REVIEW_HELD: "pending-review-held",
  PUBLISH_PENDING: "publish-pending",
  PUBLISH_IN_DOUBT: "publish-in-doubt",
} as const;
export type SubmitReviewResultKind = ValueOf<typeof SubmitReviewResultKinds>;

export type SubmitReviewResult =
  | {
      kind: typeof SubmitReviewResultKinds.SUBMITTED;
      reviewId: number;
      /** Comments GitHub would not anchor, folded into the body; 0 = none. */
      commentsFolded: number;
      commentsTotal: number;
    }
  /** 409, the PR was rewritten since it was read; reload to re-anchor. */
  | { kind: typeof SubmitReviewResultKinds.REWRITTEN }
  | { kind: typeof SubmitReviewResultKinds.UNAUTHORIZED }
  | { kind: typeof SubmitReviewResultKinds.NOT_FOUND }
  /** 409, a held draft's anchor no longer points at code; re-place or drop it. */
  | { kind: typeof SubmitReviewResultKinds.ORPHANED_DRAFT }
  /** 400 (shape; programmer error) or deterministic 413, edit the body, retry-as-is never clears. */
  | { kind: typeof SubmitReviewResultKinds.INVALID }
  /**
   * 403, a url-box brief for a repo the reader's own GitHub account cannot
   * write to. Never a retry: it clears by installing the App there.
   */
  | { kind: typeof SubmitReviewResultKinds.NO_WRITE_ACCESS }
  /** 403, GitHub refused the viewer's review on this pull request; not a retry. */
  | { kind: typeof SubmitReviewResultKinds.GITHUB_PERMISSION }
  /** 502/anything else, GitHub rejected or is unreachable. */
  | { kind: typeof SubmitReviewResultKinds.UPSTREAM }
  /**
   * 504 from the web proxy: its budget ran out while the API was still
   * posting threads, so the review may land after this answer. Never a
   * plain retry.
   */
  | { kind: typeof SubmitReviewResultKinds.INDETERMINATE }
  /** 409, the reader holds an unsubmitted review on GitHub; finish it there. */
  | { kind: typeof SubmitReviewResultKinds.PENDING_REVIEW_HELD }
  /** 409, a comment in the review is still being posted by another attempt. */
  | { kind: typeof SubmitReviewResultKinds.PUBLISH_PENDING }
  /** 409, a comment in the review may already be on GitHub; settle it first. */
  | { kind: typeof SubmitReviewResultKinds.PUBLISH_IN_DOUBT };
