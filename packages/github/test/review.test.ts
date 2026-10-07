// Pending-review create: the REST POST carries the pinned commit and nothing
// else, both ids come back, and a 422 classifies without leaking its body.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  createPullRequestReview,
  ReviewValidationClasses,
} from "../src/operations/review";
import { LEAKED_TOKEN } from "./fixtures/graphql-error";

function mockOctokit(createReview: ReturnType<typeof vi.fn>): Octokit {
  const stub = { rest: { pulls: { createReview } } };
  return stub as unknown as Octokit;
}

const INPUT = {
  owner: "o",
  repo: "r",
  prNumber: 7,
  commitId: "c".repeat(40),
} as const;

function makeValidation422(body: unknown): RequestError {
  return new RequestError("Validation Failed", 422, {
    request: {
      method: "POST",
      url: "https://api.github.com/repos/o/r/pulls/7/reviews",
      headers: { authorization: `token ${LEAKED_TOKEN}` },
    },
    response: {
      status: 422,
      url: "https://api.github.com/repos/o/r/pulls/7/reviews",
      headers: {},
      data: body,
    },
  });
}

function makeRequestError(status: number): RequestError {
  return new RequestError(`status ${status}`, status, {
    request: {
      method: "POST",
      url: "https://api.github.com",
      headers: { authorization: `token ${LEAKED_TOKEN}` },
    },
    response: { status, url: "https://api.github.com", headers: {}, data: {} },
  });
}

describe("createPullRequestReview", () => {
  it("opens a pending review pinned to the commit and returns both ids", async () => {
    const createReview = vi
      .fn()
      .mockResolvedValue({ data: { id: 512, node_id: "PRR_kwDOABCD" } });
    const result = await createPullRequestReview(
      mockOctokit(createReview),
      INPUT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual({
      reviewId: 512n,
      reviewNodeId: "PRR_kwDOABCD",
    });
    expect(createReview).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 7,
      commit_id: "c".repeat(40),
    });
  });

  it("sends no event, body or comments so the review stays pending", async () => {
    const createReview = vi
      .fn()
      .mockResolvedValue({ data: { id: 512, node_id: "PRR_kwDOABCD" } });
    await createPullRequestReview(mockOctokit(createReview), INPUT);

    const sent = createReview.mock.calls[0]?.[0];
    if (sent === undefined) {
      throw new Error("expected a createReview call");
    }
    expect("event" in sent).toBe(false);
    expect("body" in sent).toBe(false);
    expect("comments" in sent).toBe(false);
  });

  it("rejects a review id past the safe-integer range", async () => {
    const createReview = vi
      .fn()
      .mockResolvedValue({ data: { id: 9007199254740992, node_id: "x" } });
    const result = await createPullRequestReview(
      mockOctokit(createReview),
      INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("rejects a response without a node id as an unexpected shape", async () => {
    const createReview = vi.fn().mockResolvedValue({ data: { id: 512 } });
    const result = await createPullRequestReview(
      mockOctokit(createReview),
      INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("classifies a commit_id 422 as unknown-commit without leaking the body", async () => {
    const createReview = vi.fn().mockRejectedValue(
      makeValidation422({
        message: "Validation Failed",
        errors: [
          {
            resource: "PullRequestReview",
            code: "invalid",
            field: "commit_id",
          },
        ],
        token: LEAKED_TOKEN,
      }),
    );
    const result = await createPullRequestReview(
      mockOctokit(createReview),
      INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.status).toBe(422);
    expect(result.error.validation).toBe(
      ReviewValidationClasses.UNKNOWN_COMMIT,
    );
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(LEAKED_TOKEN);
    expect(serialized).not.toContain("Validation Failed");
    expect(serialized).not.toContain("commit_id");
  });

  it("classifies a 422 whose only signal is the top-level message", async () => {
    const createReview = vi.fn().mockRejectedValue(
      makeValidation422({
        message: "No commit found for SHA: deadbeef",
        errors: [],
      }),
    );
    const result = await createPullRequestReview(
      mockOctokit(createReview),
      INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.validation).toBe(
      ReviewValidationClasses.UNKNOWN_COMMIT,
    );
    expect(JSON.stringify(result.error)).not.toContain("deadbeef");
  });

  it("classifies a stale pending review 422 as pending-review-exists", async () => {
    const createReview = vi.fn().mockRejectedValue(
      makeValidation422({
        message: "Validation Failed",
        errors: ["User can only have one pending review per pull request"],
      }),
    );
    const result = await createPullRequestReview(
      mockOctokit(createReview),
      INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.validation).toBe(
      ReviewValidationClasses.PENDING_REVIEW_EXISTS,
    );
    expect(JSON.stringify(result.error)).not.toContain("pending review");
  });

  it("prefers pending-review-exists when the body also mentions a commit", async () => {
    const createReview = vi.fn().mockRejectedValue(
      makeValidation422({
        message: "Validation Failed",
        errors: [
          "User can only have one pending review per pull request on this commit",
        ],
      }),
    );
    const result = await createPullRequestReview(
      mockOctokit(createReview),
      INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.validation).toBe(
      ReviewValidationClasses.PENDING_REVIEW_EXISTS,
    );
  });

  it("classifies an unrecognizable 422 body as unknown", async () => {
    const createReview = vi
      .fn()
      .mockRejectedValue(makeValidation422({ message: "Validation Failed" }));
    const result = await createPullRequestReview(
      mockOctokit(createReview),
      INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.validation).toBe(ReviewValidationClasses.UNKNOWN);
  });

  it("maps a non-422 failure through the shared taxonomy without a class", async () => {
    const createReview = vi.fn().mockRejectedValue(makeRequestError(403));
    const result = await createPullRequestReview(
      mockOctokit(createReview),
      INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(result.error.validation).toBeUndefined();
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });
});
