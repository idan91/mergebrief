import {
  PullRequestReviewStates,
  ReviewSubjectTypes,
  type AuthoredReview,
  type ListedReviewComment,
} from "github";
import { ReviewCommentSides } from "types/conversation";
import { describe, expect, it } from "vitest";
import { makeDraftCommentRow } from "../../../../../../test/fixtures";
import { shapePublishComment } from "./anchor";
import { foldCommentsIntoBody } from "./fold";
import {
  hasReviewFoldedComment,
  matchPostedComment,
  partitionPendingReviewComments,
} from "./in-doubt";

const VIEWER_ID = 42n;
const SINCE = new Date("2026-01-01T00:00:00Z");
const BEFORE_SINCE = new Date("2025-12-31T23:59:59Z");
const COMMENT = shapePublishComment(makeDraftCommentRow());

function makeSubmittedReview(patch: Partial<AuthoredReview> = {}) {
  return {
    reviewId: 5n,
    state: PullRequestReviewStates.COMMENTED,
    body: "",
    submittedAt: SINCE,
    ...patch,
  } as AuthoredReview;
}

function makePendingReview(body = ""): AuthoredReview {
  return { reviewId: 6n, state: PullRequestReviewStates.PENDING, body };
}

function makeListedComment(
  patch: Partial<ListedReviewComment> = {},
): ListedReviewComment {
  return {
    commentId: 900n,
    authorId: VIEWER_ID,
    path: "src/a.ts",
    body: "anchored note",
    subjectType: ReviewSubjectTypes.LINE,
    line: 12,
    side: ReviewCommentSides.RIGHT,
    ...patch,
  };
}

function shapeFoldedReviewBody(): string {
  return foldCommentsIntoBody("verdict", [COMMENT], 2) ?? "";
}

describe("hasReviewFoldedComment", () => {
  it("ignores a review submitted before the lookup start", () => {
    const review = makeSubmittedReview({
      body: shapeFoldedReviewBody(),
      submittedAt: BEFORE_SINCE,
    });

    expect(hasReviewFoldedComment([review], COMMENT, SINCE)).toBe(false);
  });

  it("ignores a pending review holding the folded block", () => {
    const review = makePendingReview(shapeFoldedReviewBody());

    expect(hasReviewFoldedComment([review], COMMENT, SINCE)).toBe(false);
  });

  it("matches a review submitted exactly at the lookup start", () => {
    const review = makeSubmittedReview({ body: shapeFoldedReviewBody() });

    expect(hasReviewFoldedComment([review], COMMENT, SINCE)).toBe(true);
  });

  it("matches a CRLF review body against an LF draft", () => {
    const crlf = shapeFoldedReviewBody().replaceAll("\n", "\r\n");
    const review = makeSubmittedReview({ body: crlf });

    expect(hasReviewFoldedComment([review], COMMENT, SINCE)).toBe(true);
  });

  it("ignores a review holding the body without its anchor line", () => {
    const review = makeSubmittedReview({ body: "verdict\n\nanchored note" });

    expect(hasReviewFoldedComment([review], COMMENT, SINCE)).toBe(false);
  });
});

describe("partitionPendingReviewComments", () => {
  const reviews = [makeSubmittedReview(), makePendingReview()];

  it("keeps a comment that names no review as published", () => {
    const row = makeListedComment();

    expect(partitionPendingReviewComments([row], reviews)).toEqual({
      published: [row],
      pending: [],
    });
  });

  it("keeps a comment in a submitted viewer review as published", () => {
    const row = makeListedComment({ reviewId: 5n });

    expect(partitionPendingReviewComments([row], reviews)).toEqual({
      published: [row],
      pending: [],
    });
  });

  it("sets aside a comment in a viewer pending review as pending", () => {
    const row = makeListedComment({ reviewId: 6n });

    expect(partitionPendingReviewComments([row], reviews)).toEqual({
      published: [],
      pending: [row],
    });
  });
});

describe("matchPostedComment", () => {
  const draft = makeDraftCommentRow();

  it("matches the viewer's comment on the same anchor and body", () => {
    const row = makeListedComment({ reviewId: 5n });

    expect(matchPostedComment([row], [draft], VIEWER_ID)).toEqual({
      draft,
      posted: { commentId: 900n, reviewId: 5n },
    });
  });

  it("matches a comment a push moved off its original line", () => {
    const row = makeListedComment({ line: 20, originalLine: 12 });

    expect(matchPostedComment([row], [draft], VIEWER_ID)).toEqual({
      draft,
      posted: { commentId: 900n },
    });
  });
});
