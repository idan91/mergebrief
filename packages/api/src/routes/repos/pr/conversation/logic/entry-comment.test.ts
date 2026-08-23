import type { PrConversation } from "github";
import { describe, expect, it } from "vitest";
import { stripEntryComment } from "./entry-comment";

function buildConversation(commentIds: readonly number[]): PrConversation {
  return {
    threads: [],
    reviews: [],
    prComments: commentIds.map((commentId) => ({
      commentId,
      author: { login: "octocat", isBot: false },
      body: "hello",
      createdAt: "2026-08-01T00:00:00Z",
      url: `https://github.com/acme/app/pull/7#issuecomment-${commentId}`,
    })),
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

describe("stripEntryComment", () => {
  it("drops exactly the stored entry-comment id", () => {
    const stripped = stripEntryComment(buildConversation([1, 2, 3]), 2n);
    expect(stripped.prComments.map((comment) => comment.commentId)).toEqual([
      1, 3,
    ]);
  });

  it("keeps everything when no entry comment is recorded", () => {
    const original = buildConversation([1, 2]);
    expect(stripEntryComment(original, null)).toBe(original);
  });
});
