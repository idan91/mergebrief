// File-arm standalone post-now: sends subject_type file and omits every
// line coordinate.
import { describe, expect, it, vi } from "vitest";
import { createInlineReviewComment } from "../src/operations/inline-comment";
import { ReviewSubjectTypes } from "../src/operations/review-thread";
import type { Octokit } from "octokit";

function mockOctokit(createReviewComment: ReturnType<typeof vi.fn>): Octokit {
  const stub = { rest: { pulls: { createReviewComment } } };
  return stub as unknown as Octokit;
}

describe("createInlineReviewComment file arm", () => {
  it("posts subject_type file and omits line and side", async () => {
    const createReviewComment = vi
      .fn()
      .mockResolvedValue({ data: { id: 999, pull_request_review_id: 555 } });
    const result = await createInlineReviewComment(
      mockOctokit(createReviewComment),
      {
        owner: "o",
        repo: "r",
        prNumber: 7,
        commitId: "a".repeat(40),
        path: "src/app.ts",
        body: "post now",
        subjectType: ReviewSubjectTypes.FILE,
      },
    );

    expect(result.ok).toBe(true);
    expect(createReviewComment).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 7,
      commit_id: "a".repeat(40),
      path: "src/app.ts",
      body: "post now",
      subject_type: "file",
    });
    const sent = createReviewComment.mock.calls[0]?.[0];
    if (sent === undefined) throw new Error("expected a sent comment");
    expect("line" in sent).toBe(false);
    expect("side" in sent).toBe(false);
    expect("start_line" in sent).toBe(false);
    expect("start_side" in sent).toBe(false);
  });
});
