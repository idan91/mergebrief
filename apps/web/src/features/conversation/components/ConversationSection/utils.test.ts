import type { PrLevelCommentView } from "contract";
import type { ReviewVerdictState } from "types/conversation";
import { describe, expect, it } from "vitest";
import { headSummary, shouldRelandInPlace } from "./utils";
import type {
  ConversationReview,
  ConversationThread,
  PrConversation,
} from "../../types";
import { createI18n } from "i18n";

const t = createI18n().t;

function review(
  reviewId: number,
  state: ReviewVerdictState,
  body = `body ${reviewId}`,
): ConversationReview {
  return {
    reviewId,
    author: { login: "octocat", isBot: false },
    state,
    body,
    url: `https://github.com/o/r/pull/1#pullrequestreview-${reviewId}`,
  };
}

function thread(rootCommentId: number, isResolved = false): ConversationThread {
  return {
    rootCommentId,
    path: "src/a.ts",
    line: 10,
    side: "RIGHT",
    subjectType: "LINE",
    isResolved,
    isOutdated: false,
    comments: [
      {
        commentId: rootCommentId,
        author: { login: "octocat", isBot: false },
        body: "note",
        createdAt: "2026-08-01T00:00:00Z",
        url: `https://github.com/o/r/pull/1#discussion_r${rootCommentId}`,
      },
    ],
    hasMoreComments: false,
  };
}

function prComment(commentId: number): PrLevelCommentView {
  return {
    commentId,
    author: { login: "octocat", isBot: false },
    body: "general",
    createdAt: "2026-08-01T00:00:00Z",
    url: `https://github.com/o/r/pull/1#issuecomment-${commentId}`,
  };
}

function buildConversation(
  parts: Partial<
    Pick<PrConversation, "threads" | "reviews" | "prComments">
  > = {},
): PrConversation {
  return {
    threads: parts.threads ?? [],
    reviews: parts.reviews ?? [],
    prComments: parts.prComments ?? [],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

describe("headSummary", () => {
  it("returns nothing for an empty conversation", () => {
    expect(headSummary(t, buildConversation())).toBeUndefined();
  });

  it("omits zero parts, a body-only review never reads 0 threads", () => {
    const conversation = buildConversation({
      reviews: [review(1, "COMMENTED", "LGTM")],
    });
    expect(headSummary(t, conversation)).toBe("1 review");
  });

  it("ignores empty-bodied COMMENTED envelopes", () => {
    const conversation = buildConversation({
      reviews: [review(1, "COMMENTED", "  ")],
      threads: [thread(11, true)],
    });
    expect(headSummary(t, conversation)).toBe("1 thread · 0 open");
  });

  it("threads carry the open count", () => {
    const conversation = buildConversation({
      threads: [thread(11), thread(12, true)],
    });
    expect(headSummary(t, conversation)).toBe("2 threads · 1 open");
  });

  it("joins all present kinds with pluralization", () => {
    const conversation = buildConversation({
      reviews: [review(1, "APPROVED"), review(2, "CHANGES_REQUESTED")],
      prComments: [prComment(21)],
      threads: [thread(11)],
    });
    expect(headSummary(t, conversation)).toBe(
      "2 reviews · 1 comment · 1 thread · 1 open",
    );
  });
});

describe("shouldRelandInPlace", () => {
  it("relands only when the jump changes neither revision nor thread", () => {
    const sameSpot = {
      currentHeadSha: "a".repeat(40),
      anchorSha: "a".repeat(40),
      focusThreadId: 7,
      threadId: 7,
    };

    expect(shouldRelandInPlace(sameSpot)).toBe(true);
    const otherSha = "b".repeat(40);
    expect(shouldRelandInPlace({ ...sameSpot, anchorSha: otherSha })).toBe(
      false,
    );
    expect(shouldRelandInPlace({ ...sameSpot, threadId: 8 })).toBe(false);
    expect(shouldRelandInPlace({ ...sameSpot, focusThreadId: undefined })).toBe(
      false,
    );
  });
});
