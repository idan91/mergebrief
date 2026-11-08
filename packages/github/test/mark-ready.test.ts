// Mark-ready mutation tests: the resolve-then-mutate flow, the converged paths
// (read-time non-draft + the "not a draft" mutation race), the null-resource
// not-found, and the sanitized failure paths. GraphQL is stubbed at the
// `octokit.graphql` interface. No throttle concerns, since GraphQL calls are
// not on the notification-triggering REST throttle list.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { markPullRequestReadyForReview } from "../src/operations/mark-ready";
import { GitHubApiErrorCodes } from "../src/errors";
import { LEAKED_TOKEN, graphqlResponseError } from "./fixtures/graphql-error";

function mockGraphqlOctokit(graphql: ReturnType<typeof vi.fn>): Octokit {
  const stub = { graphql };
  return stub as unknown as Octokit;
}

const INPUT = { owner: "o", repo: "r", prNumber: 7 } as const;
const NODE_ID = "PR_kwDOABCD";
const READ_UPDATED_AT = "2026-09-01T10:00:00Z";
const FLIP_UPDATED_AT = "2026-09-01T10:05:00Z";

function nodeIdResponse(isDraft: boolean, id = NODE_ID): unknown {
  return {
    repository: {
      pullRequest: { id, isDraft, updatedAt: READ_UPDATED_AT },
    },
  };
}
function mutationResponse(): unknown {
  return {
    markPullRequestReadyForReview: {
      pullRequest: { isDraft: false, updatedAt: FLIP_UPDATED_AT },
    },
  };
}

describe("markPullRequestReadyForReview", () => {
  it("mark ready returns GitHub's updated time", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(nodeIdResponse(true))
      .mockResolvedValueOnce(mutationResponse());

    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        alreadyReady: false,
        githubUpdatedAt: new Date(FLIP_UPDATED_AT),
      },
    });
    const [nodeQuery] = graphql.mock.calls[0] ?? [];
    const [mutationQuery] = graphql.mock.calls[1] ?? [];
    expect(String(nodeQuery)).toContain("updatedAt");
    expect(String(mutationQuery)).toContain("updatedAt");
  });

  it("an already ready pull request returns the read's updated time", async () => {
    const graphql = vi.fn().mockResolvedValueOnce(nodeIdResponse(false));

    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );

    expect(result).toEqual({
      ok: true,
      value: { alreadyReady: true, githubUpdatedAt: new Date(READ_UPDATED_AT) },
    });
  });

  it("resolves the node id then runs the draft-to-ready mutation", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(nodeIdResponse(true))
      .mockResolvedValueOnce(mutationResponse());
    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.alreadyReady).toBe(false);
    expect(graphql).toHaveBeenCalledTimes(2);
    // Resolve carries the owner/repo/number as variables (never interpolated).
    const [, resolveVars] = graphql.mock.calls[0] ?? [];
    expect(resolveVars).toMatchObject({ owner: "o", repo: "r", prNumber: 7 });
    // Mutation carries the RESOLVED node id, never the PR number.
    const [mutationQuery, mutationVars] = graphql.mock.calls[1] ?? [];
    expect(String(mutationQuery)).toContain("markPullRequestReadyForReview");
    expect(mutationVars).toEqual({ pullRequestId: NODE_ID });
  });

  it("converges without mutating when the PR is already out of draft", async () => {
    const graphql = vi.fn().mockResolvedValueOnce(nodeIdResponse(false));
    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.alreadyReady).toBe(true);
    // No mutation call: the read-time check short-circuits.
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("converges when the mutation races a concurrent ready", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(nodeIdResponse(true))
      .mockRejectedValueOnce(
        graphqlResponseError([
          { type: "UNPROCESSABLE", message: "Pull request is not a draft" },
        ]),
      );
    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.alreadyReady).toBe(true);
    expect(result.value.githubUpdatedAt).toEqual(new Date(READ_UPDATED_AT));
    expect(graphql).toHaveBeenCalledTimes(2);
  });

  it("a flip with no pull request in its answer keeps the read's time", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(nodeIdResponse(true))
      .mockResolvedValueOnce({
        markPullRequestReadyForReview: { pullRequest: null },
      });

    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        alreadyReady: false,
        githubUpdatedAt: new Date(READ_UPDATED_AT),
      },
    });
  });

  it("not-found when the repository field is null", async () => {
    const graphql = vi.fn().mockResolvedValueOnce({ repository: null });
    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("not-found when the pullRequest field is null", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({ repository: { pullRequest: null } });
    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("maps a forbidden resolve-time error to a failure without mutating", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(
        graphqlResponseError([{ type: "FORBIDDEN", message: "no access" }]),
      );
    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(graphql).toHaveBeenCalledTimes(1);
    // No secret/upstream text leaks through the sanitization chokepoint.
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
    expect(JSON.stringify(result.error)).not.toContain("no access");
  });

  it("maps a non-converged mutation error to a sanitized failure", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(nodeIdResponse(true))
      .mockRejectedValueOnce(
        new RequestError("Server Error", 502, {
          request: {
            method: "POST",
            url: "https://api.github.com/graphql",
            headers: {},
          },
          response: {
            status: 502,
            url: "https://api.github.com/graphql",
            headers: {},
            data: {},
          },
        }),
      );
    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("flags an ill-shaped resolve response as an unexpected-shape failure", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({ repository: { pullRequest: { id: 123 } } });
    const result = await markPullRequestReadyForReview(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });
});
