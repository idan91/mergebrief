// Pending-review lifecycle tests: finding the viewer's stale pending review
// off the paginated review list, and deleting one with a 404 folding to ok.
// REST is stubbed at the `octokit.rest.pulls` and `octokit.paginate` seams.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  deletePendingPullRequestReview,
  findPendingPullRequestReview,
} from "../src/operations/review-pending";
import { LEAKED_TOKEN } from "./fixtures/graphql-error";

function mockOctokit(overrides: {
  paginate?: ReturnType<typeof vi.fn>;
  deletePendingReview?: ReturnType<typeof vi.fn>;
}): Octokit {
  const listReviews = vi.fn();
  const stub = {
    paginate: overrides.paginate ?? vi.fn(),
    rest: {
      pulls: {
        listReviews,
        deletePendingReview: overrides.deletePendingReview ?? vi.fn(),
      },
    },
  };
  return stub as unknown as Octokit;
}

const REF = { owner: "o", repo: "r", prNumber: 7 } as const;

function makeRequestError(status: number): RequestError {
  return new RequestError(`status ${status}`, status, {
    request: {
      method: "GET",
      url: "https://api.github.com",
      headers: { authorization: `token ${LEAKED_TOKEN}` },
    },
    response: { status, url: "https://api.github.com", headers: {}, data: {} },
  });
}

describe("findPendingPullRequestReview", () => {
  it("returns the pending review's ids, skipping submitted reviews", async () => {
    const paginate = vi.fn().mockResolvedValue([
      { id: 1, node_id: "PRR_one", state: "APPROVED" },
      { id: 2, node_id: "PRR_two", state: "PENDING" },
    ]);
    const octokit = mockOctokit({ paginate });
    const result = await findPendingPullRequestReview(octokit, REF);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ reviewId: 2n, reviewNodeId: "PRR_two" });
    const [, params] = paginate.mock.calls[0] ?? [];
    expect(params).toMatchObject({ owner: "o", repo: "r", pull_number: 7 });
  });

  it("returns undefined when no review is pending", async () => {
    const paginate = vi
      .fn()
      .mockResolvedValue([{ id: 1, node_id: "PRR_one", state: "COMMENTED" }]);
    const result = await findPendingPullRequestReview(
      mockOctokit({ paginate }),
      REF,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBeUndefined();
  });

  it("rejects a pending review id past the safe-integer range", async () => {
    const paginate = vi
      .fn()
      .mockResolvedValue([
        { id: 9007199254740992, node_id: "PRR_big", state: "PENDING" },
      ]);
    const result = await findPendingPullRequestReview(
      mockOctokit({ paginate }),
      REF,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("maps a list failure to a sanitized error", async () => {
    const paginate = vi.fn().mockRejectedValue(makeRequestError(403));
    const result = await findPendingPullRequestReview(
      mockOctokit({ paginate }),
      REF,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });
});

describe("deletePendingPullRequestReview", () => {
  it("deletes the pending review by its numeric id", async () => {
    const deletePendingReview = vi.fn().mockResolvedValue({ data: {} });
    const result = await deletePendingPullRequestReview(
      mockOctokit({ deletePendingReview }),
      { ...REF, reviewId: 512n },
    );

    expect(result.ok).toBe(true);
    expect(deletePendingReview).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 7,
      review_id: 512,
    });
  });

  it("treats a 404 on an already-gone review as success", async () => {
    const deletePendingReview = vi
      .fn()
      .mockRejectedValue(makeRequestError(404));
    const result = await deletePendingPullRequestReview(
      mockOctokit({ deletePendingReview }),
      { ...REF, reviewId: 512n },
    );

    expect(result.ok).toBe(true);
  });

  it("maps any other failure to a sanitized error", async () => {
    const deletePendingReview = vi
      .fn()
      .mockRejectedValue(makeRequestError(403));
    const result = await deletePendingPullRequestReview(
      mockOctokit({ deletePendingReview }),
      { ...REF, reviewId: 512n },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });
});
