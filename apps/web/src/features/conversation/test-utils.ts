import type { PrConversation } from "./types";

/** One line thread per author at src/a.ts:10, the line the Brief's `makeChunk` adds. */
export function makeConversation(authors: readonly string[]): PrConversation {
  return {
    threads: authors.map((login, index) => ({
      rootCommentId: 9000 + index,
      path: "src/a.ts",
      line: 10,
      side: "RIGHT",
      subjectType: "LINE",
      isResolved: false,
      isOutdated: false,
      comments: [
        {
          commentId: 9000 + index,
          author: { login, isBot: false },
          body: login,
          createdAt: "2026-08-01T00:00:00Z",
          url: `https://example.test/c/${9000 + index}`,
        },
      ],
      hasMoreComments: false,
    })),
    reviews: [],
    prComments: [],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}
