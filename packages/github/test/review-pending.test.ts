// Pending-review lifecycle tests: finding the viewer's stale pending review
// off the paginated review list, and deleting one with a 404 folding to ok.
// REST is stubbed at the `octokit.rest.pulls` and `octokit.paginate` seams.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  countPendingReviewComments,
  hasPullRequestReviewPublished,
  deletePendingPullRequestReview,
  findPendingPullRequestReview,
  listReviewsByAuthor,
} from "../src/operations/review-pending";
import { LEAKED_TOKEN } from "./fixtures/graphql-error";

function mockOctokit(overrides: {
  paginate?: ReturnType<typeof vi.fn>;
  deletePendingReview?: ReturnType<typeof vi.fn>;
  graphql?: ReturnType<typeof vi.fn>;
}): Octokit {
  const listReviews = vi.fn();
  const stub = {
    paginate: overrides.paginate ?? vi.fn(),
    graphql: overrides.graphql ?? vi.fn(),
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("maps a list failure to a sanitized error", async () => {
    const paginate = vi.fn().mockRejectedValue(makeRequestError(403));
    const result = await findPendingPullRequestReview(
      mockOctokit({ paginate }),
      REF,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });
});

describe("hasPullRequestReviewPublished", () => {
  it("is true once the review is listed in a non-pending state", async () => {
    const paginate = vi
      .fn()
      .mockResolvedValue([{ id: 12, node_id: "PRR_a", state: "COMMENTED" }]);
    const result = await hasPullRequestReviewPublished(
      mockOctokit({ paginate }),
      { ...REF, reviewId: 12n },
    );

    expect(result).toEqual({ ok: true, value: true });
  });

  it("is false while the review is pending or missing from the list", async () => {
    const pending = vi
      .fn()
      .mockResolvedValue([{ id: 12, node_id: "PRR_a", state: "PENDING" }]);
    const missing = vi
      .fn()
      .mockResolvedValue([{ id: 99, node_id: "PRR_z", state: "APPROVED" }]);

    expect(
      await hasPullRequestReviewPublished(mockOctokit({ paginate: pending }), {
        ...REF,
        reviewId: 12n,
      }),
    ).toEqual({ ok: true, value: false });
    expect(
      await hasPullRequestReviewPublished(mockOctokit({ paginate: missing }), {
        ...REF,
        reviewId: 12n,
      }),
    ).toEqual({ ok: true, value: false });
  });

  it("maps a list failure to a sanitized error", async () => {
    const paginate = vi.fn().mockRejectedValue(makeRequestError(502));
    const result = await hasPullRequestReviewPublished(
      mockOctokit({ paginate }),
      { ...REF, reviewId: 12n },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.status).toBe(502);
  });
});

describe("listReviewsByAuthor", () => {
  const INPUT = { ...REF, authorId: 42n };

  function makeReviewEntry(extra: Record<string, unknown> = {}) {
    return {
      id: 12,
      node_id: "PRR_a",
      state: "COMMENTED",
      body: "looks good",
      user: { id: 42 },
      submitted_at: "2026-10-06T10:00:00Z",
      ...extra,
    };
  }

  it("returns the author's reviews with id, state, body and submit time", async () => {
    const paginate = vi.fn().mockResolvedValue([makeReviewEntry()]);

    const result = await listReviewsByAuthor(mockOctokit({ paginate }), INPUT);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          reviewId: 12n,
          state: "COMMENTED",
          body: "looks good",
          submittedAt: new Date("2026-10-06T10:00:00Z"),
        },
      ],
    });
    const [, params] = paginate.mock.calls[0] ?? [];
    expect(params).toMatchObject({ owner: "o", repo: "r", pull_number: 7 });
  });

  it("ignores another user's review and one with no user", async () => {
    const paginate = vi
      .fn()
      .mockResolvedValue([
        makeReviewEntry({ user: { id: 7 } }),
        makeReviewEntry({ user: null }),
      ]);

    const result = await listReviewsByAuthor(mockOctokit({ paginate }), INPUT);

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("keeps a pending review with its state and no submit time", async () => {
    const paginate = vi
      .fn()
      .mockResolvedValue([
        makeReviewEntry({ state: "PENDING", body: null, submitted_at: null }),
      ]);

    const result = await listReviewsByAuthor(mockOctokit({ paginate }), INPUT);

    expect(result).toEqual({
      ok: true,
      value: [{ reviewId: 12n, state: "PENDING", body: "" }],
    });
  });

  it("fails rather than skip an entry it cannot read", async () => {
    const paginate = vi
      .fn()
      .mockResolvedValue([
        makeReviewEntry(),
        makeReviewEntry({ user: { id: "x" } }),
      ]);

    const result = await listReviewsByAuthor(mockOctokit({ paginate }), INPUT);

    expect(result.ok).toBe(false);
  });

  it("maps a list failure to a sanitized error", async () => {
    const paginate = vi.fn().mockRejectedValue(makeRequestError(502));

    const result = await listReviewsByAuthor(mockOctokit({ paginate }), INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.status).toBe(502);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });
});

describe("countPendingReviewComments", () => {
  it("reads the comment count off the review node", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue({ node: { comments: { totalCount: 3 } } });
    const result = await countPendingReviewComments(
      mockOctokit({ graphql }),
      "PRR_kwDOpending",
    );

    expect(result).toEqual({ ok: true, value: 3 });
    const [, variables] = graphql.mock.calls[0] ?? [];
    expect(variables).toEqual({ id: "PRR_kwDOpending" });
  });

  it("flags a missing node as an unexpected shape", async () => {
    const graphql = vi.fn().mockResolvedValue({ node: null });
    const result = await countPendingReviewComments(
      mockOctokit({ graphql }),
      "PRR_kwDOpending",
    );

    expect(result.ok).toBe(false);
  });

  it("maps a GraphQL failure to a sanitized error", async () => {
    const graphql = vi.fn().mockRejectedValue(makeRequestError(502));
    const result = await countPendingReviewComments(
      mockOctokit({ graphql }),
      "PRR_kwDOpending",
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.status).toBe(502);
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
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });
});
