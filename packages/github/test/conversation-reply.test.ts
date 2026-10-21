// The reply's wrapping review id: best effort, never a reason to fail a
// reply that already posted.
import type { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";

import { createReviewCommentReply } from "../src/operations/conversation";

const INPUT = {
  owner: "o",
  repo: "r",
  prNumber: 7,
  commentId: 1001,
  body: "a follow-up",
} as const;

function stubReplyOctokit(data: Record<string, unknown>): Octokit {
  const stub = {
    rest: {
      pulls: {
        createReplyForReviewComment: vi.fn().mockResolvedValue({ data }),
      },
    },
  };
  // Structural stand-in where the full `Octokit` type is expected.
  return stub as unknown as Octokit;
}

describe("createReviewCommentReply, wrapping review id", () => {
  it("omits the review id when GitHub assigns none", async () => {
    const result = await createReviewCommentReply(
      stubReplyOctokit({ id: 7001, pull_request_review_id: null }),
      INPUT,
    );
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual({ commentId: 7001 });
  });

  it("omits a review id past the safe-integer range", async () => {
    const result = await createReviewCommentReply(
      stubReplyOctokit({ id: 7001, pull_request_review_id: 9007199254740992 }),
      INPUT,
    );
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual({ commentId: 7001 });
  });
});
