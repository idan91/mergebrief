// Cutoff derivations: strictly-after comparison, absent-cutoff and
// unparsable-date safety, and the count spanning thread + PR-level comments.
import { describe, expect, it } from "vitest";

import type { PrConversation } from "../types";
import {
  NO_OWN_REVIEWS,
  countCommentsAfterBrief,
  postdatesBrief,
} from "./postdate";

const CUTOFF = "2026-07-01T10:30:00Z";

function comment(commentId: number, createdAt: string) {
  return {
    commentId,
    author: { login: "alice", isBot: false },
    body: "b",
    createdAt,
    url: "https://example.test/c",
  };
}

describe("postdatesBrief", () => {
  it("marks strictly newer comments only", () => {
    expect(
      postdatesBrief(
        { createdAt: "2026-07-01T10:31:00Z" },
        CUTOFF,
        NO_OWN_REVIEWS,
      ),
    ).toBe(true);
    expect(postdatesBrief({ createdAt: CUTOFF }, CUTOFF, NO_OWN_REVIEWS)).toBe(
      false,
    );
    expect(
      postdatesBrief(
        { createdAt: "2026-07-01T10:00:00Z" },
        CUTOFF,
        NO_OWN_REVIEWS,
      ),
    ).toBe(false);
  });

  it("marks nothing without a cutoff or with unparsable dates", () => {
    const newer = { createdAt: "2026-07-01T10:31:00Z" };
    expect(postdatesBrief(newer, undefined, NO_OWN_REVIEWS)).toBe(false);
    expect(
      postdatesBrief({ createdAt: "not-a-date" }, CUTOFF, NO_OWN_REVIEWS),
    ).toBe(false);
    expect(postdatesBrief(newer, "not-a-date", NO_OWN_REVIEWS)).toBe(false);
  });

  it("never marks a comment from the reviewer's own recorded submit", () => {
    const own = { createdAt: "2026-07-01T10:31:00Z", reviewId: 900 };
    expect(postdatesBrief(own, CUTOFF, new Set([900]))).toBe(false);
    expect(postdatesBrief(own, CUTOFF, new Set([901]))).toBe(true);
    expect(postdatesBrief(own, CUTOFF, NO_OWN_REVIEWS)).toBe(true);
  });
});

describe("countCommentsAfterBrief", () => {
  it("counts thread and PR-level comments past the cutoff", () => {
    const conversation: PrConversation = {
      threads: [
        {
          rootCommentId: 1,
          path: "src/a.ts",
          line: 1,
          side: "RIGHT",
          subjectType: "LINE",
          isResolved: false,
          isOutdated: false,
          comments: [
            comment(1, "2026-07-01T10:00:00Z"),
            comment(2, "2026-07-01T11:00:00Z"),
          ],
          hasMoreComments: false,
        },
      ],
      reviews: [],
      prComments: [
        { ...comment(3, "2026-07-01T12:00:00Z") },
        { ...comment(4, "2026-07-01T09:00:00Z") },
      ],
      hasMoreThreads: false,
      hasMoreReviews: false,
      hasMorePrComments: false,
    };
    expect(countCommentsAfterBrief(conversation, CUTOFF, NO_OWN_REVIEWS)).toBe(
      2,
    );
    expect(
      countCommentsAfterBrief(conversation, undefined, NO_OWN_REVIEWS),
    ).toBe(0);
  });

  it("leaves the reviewer's own recorded submits out of the count", () => {
    const conversation: PrConversation = {
      threads: [
        {
          rootCommentId: 1,
          path: "src/a.ts",
          line: 1,
          side: "RIGHT",
          subjectType: "LINE",
          isResolved: false,
          isOutdated: false,
          comments: [
            { ...comment(1, "2026-07-01T11:00:00Z"), reviewId: 900 },
            { ...comment(2, "2026-07-01T11:05:00Z"), reviewId: 901 },
          ],
          hasMoreComments: false,
        },
      ],
      reviews: [],
      prComments: [],
      hasMoreThreads: false,
      hasMoreReviews: false,
      hasMorePrComments: false,
    };
    expect(countCommentsAfterBrief(conversation, CUTOFF, new Set([900]))).toBe(
      1,
    );
  });
});
