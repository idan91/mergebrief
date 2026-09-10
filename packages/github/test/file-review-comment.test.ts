// File-arm GitHub writes: grouped review comments and standalone post-now
// both send subject_type file and omit every line coordinate.
import { describe, expect, it, vi } from "vitest";
import { createInlineReviewComment } from "../src/operations/inline-comment";
import {
  createPullRequestReview,
  ReviewEvents,
  ReviewSubjectTypes,
} from "../src/operations/review";
import type { Octokit } from "octokit";

function mockOctokit(overrides: {
  createReview?: ReturnType<typeof vi.fn>;
  createReviewComment?: ReturnType<typeof vi.fn>;
}): Octokit {
  const stub = {
    rest: {
      pulls: {
        createReview: overrides.createReview ?? vi.fn(),
        createReviewComment: overrides.createReviewComment ?? vi.fn(),
      },
    },
  };
  return stub as unknown as Octokit;
}

const FILE_COMMENT = {
  path: "src/app.ts",
  body: "on the file",
  subjectType: ReviewSubjectTypes.FILE,
} as const;

describe("createPullRequestReview file arm", () => {
  it("posts subject_type file and omits line and side", async () => {
    const createReview = vi.fn().mockResolvedValue({ data: { id: 512 } });
    const result = await createPullRequestReview(
      mockOctokit({ createReview }),
      {
        owner: "o",
        repo: "r",
        prNumber: 7,
        commitId: "c".repeat(40),
        event: ReviewEvents.COMMENT,
        comments: [FILE_COMMENT],
      },
    );

    expect(result.ok).toBe(true);
    expect(createReview).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 7,
      commit_id: "c".repeat(40),
      event: "COMMENT",
      comments: [
        {
          path: "src/app.ts",
          body: "on the file",
          subject_type: "file",
        },
      ],
    });
    const sent = createReview.mock.calls[0]?.[0]?.comments?.[0];
    if (sent === undefined) throw new Error("expected a sent comment");
    expect("line" in sent).toBe(false);
    expect("side" in sent).toBe(false);
    expect("start_line" in sent).toBe(false);
    expect("start_side" in sent).toBe(false);
  });
});

describe("createInlineReviewComment file arm", () => {
  it("posts subject_type file and omits line and side", async () => {
    const createReviewComment = vi
      .fn()
      .mockResolvedValue({ data: { id: 999, pull_request_review_id: 555 } });
    const result = await createInlineReviewComment(
      mockOctokit({ createReviewComment }),
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
