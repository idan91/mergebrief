import type { ReviewPosture } from "../hooks/useReviewPosture";

const WRITABLE_POSTURE: ReviewPosture = {
  composerDisabledReason: undefined,
  flagsReadOnly: false,
  postingCommentIds: new Set(),
  postBlockedExternally: undefined,
  postComment: undefined,
};

/** A writable posture for tests, with only the named fields changed. */
export function makeReviewPosture(
  overrides: Partial<ReviewPosture> = {},
): ReviewPosture {
  return { ...WRITABLE_POSTURE, ...overrides };
}
