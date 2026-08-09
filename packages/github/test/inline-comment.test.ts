// Standalone inline review-comment write tests (BRIEF-43 PR 4): drive the
// REST create-review-comment primitive — the happy path (comment id + the
// wrapping review id GitHub assigns), the null-review-id degradation, the
// precision guards, the 422 stale-anchor flag, and the sanitized failure
// paths. REST is stubbed at the `octokit.rest.pulls.createReviewComment` interface
// (the same structural mock style the other operation suites use).
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { createInlineReviewComment } from "../src/operations/inline-comment";
import { GitHubApiErrorCode } from "../src/errors";
import { ReviewCommentSide } from "../src/operations/review";

function mockOctokit(createReviewComment: ReturnType<typeof vi.fn>): Octokit {
  const stub = { rest: { pulls: { createReviewComment } } };
  return stub as unknown as Octokit;
}

const INPUT = {
  owner: "o",
  repo: "r",
  prNumber: 7,
  commitId: "a".repeat(40),
  path: "src/index.ts",
  line: 12,
  side: ReviewCommentSide.RIGHT,
  body: "post now",
} as const;

function requestError(status: number): RequestError {
  return new RequestError(`status ${status}`, status, {
    request: { method: "POST", url: "https://api.github.com", headers: {} },
    response: { status, url: "https://api.github.com", headers: {}, data: {} },
  });
}

describe("createInlineReviewComment", () => {
  it("posts the comment with the pinned commit + anchor and returns both ids", async () => {
    const createReviewComment = vi
      .fn()
      .mockResolvedValue({ data: { id: 999, pull_request_review_id: 555 } });
    const result = await createInlineReviewComment(
      mockOctokit(createReviewComment),
      {
        ...INPUT,
        startLine: 10,
        startSide: ReviewCommentSide.RIGHT,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.commentId).toBe(999n);
    expect(result.value.reviewId).toBe(555n);
    // commit_id is the PINNED head SHA; anchor maps to path/line/side +
    // start_line/start_side (the multi-line range).
    expect(createReviewComment).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 7,
      commit_id: "a".repeat(40),
      path: "src/index.ts",
      line: 12,
      side: "RIGHT",
      start_line: 10,
      start_side: "RIGHT",
      body: "post now",
    });
  });

  it("omits start_line/start_side for a single-line anchor", async () => {
    const createReviewComment = vi
      .fn()
      .mockResolvedValue({ data: { id: 1, pull_request_review_id: 2 } });
    await createInlineReviewComment(mockOctokit(createReviewComment), INPUT);
    const [call] = createReviewComment.mock.calls[0] ?? [];
    expect(call).not.toHaveProperty("start_line");
    expect(call).not.toHaveProperty("start_side");
  });

  it("returns commentId with reviewId absent when GitHub assigns no review id", async () => {
    const createReviewComment = vi
      .fn()
      .mockResolvedValue({ data: { id: 999, pull_request_review_id: null } });
    const result = await createInlineReviewComment(
      mockOctokit(createReviewComment),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.commentId).toBe(999n);
    expect(result.value.reviewId).toBeUndefined();
  });

  it("rejects a lossy (unsafe-integer) comment id as an unexpected shape", async () => {
    const createReviewComment = vi.fn().mockResolvedValue({
      data: { id: Number.MAX_SAFE_INTEGER + 2, pull_request_review_id: 1 },
    });
    const result = await createInlineReviewComment(
      mockOctokit(createReviewComment),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
  });

  it("drops an unsafe review id to undefined rather than failing the post", async () => {
    const createReviewComment = vi.fn().mockResolvedValue({
      data: { id: 5, pull_request_review_id: Number.MAX_SAFE_INTEGER + 2 },
    });
    const result = await createInlineReviewComment(
      mockOctokit(createReviewComment),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.commentId).toBe(5n);
    expect(result.value.reviewId).toBeUndefined();
  });

  it("flags a 422 as a stale anchor (the diff moved under the pinned commit)", async () => {
    const createReviewComment = vi.fn().mockRejectedValue(requestError(422));
    const result = await createInlineReviewComment(
      mockOctokit(createReviewComment),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.staleAnchor).toBe(true);
    // Sanitized: the message is derived from the static context + status only,
    // never the upstream body (the RequestError message here is "status 422").
    expect(result.error.message).toBe(
      "failed to create inline review comment: GitHub API returned status 422",
    );
  });

  it("maps a 403 to a sanitized forbidden error without the stale-anchor flag", async () => {
    const createReviewComment = vi.fn().mockRejectedValue(requestError(403));
    const result = await createInlineReviewComment(
      mockOctokit(createReviewComment),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.FORBIDDEN);
    expect(result.error.staleAnchor).toBeUndefined();
  });
});
