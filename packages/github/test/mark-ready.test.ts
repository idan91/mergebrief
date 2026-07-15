// Mark-ready mutation tests (BRIEF-43): drive the resolve-then-mutate flow,
// the converged paths (read-time non-draft + the "not a draft" mutation race),
// the null-resource not-found, and the sanitized failure paths. GraphQL is
// stubbed at the `octokit.graphql` seam (same structural mock as
// conversation.test.ts). No network, no throttle concerns (GraphQL calls are
// not on the notification-triggering REST throttle list).
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { markPullRequestReadyForReview } from "../src/operations/mark-ready";
import { GitHubApiErrorCode } from "../src/errors";
import { LEAKED_TOKEN, graphqlResponseError } from "./fixtures/graphql-error";

function mockGraphqlOctokit(graphql: ReturnType<typeof vi.fn>): Octokit {
  const stub = { graphql };
  return stub as unknown as Octokit;
}

const INPUT = { owner: "o", repo: "r", prNumber: 7 } as const;
const NODE_ID = "PR_kwDOABCD";

function nodeIdResponse(isDraft: boolean, id = NODE_ID): unknown {
  return { repository: { pullRequest: { id, isDraft } } };
}
function mutationResponse(): unknown {
  return { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } };
}

describe("markPullRequestReadyForReview", () => {
  it("resolves the node id then runs the mutation (draft → ready), converged=false", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(nodeIdResponse(true))
      .mockResolvedValueOnce(mutationResponse());
    const result = await markPullRequestReadyForReview(mockGraphqlOctokit(graphql), INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
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
    const result = await markPullRequestReadyForReview(mockGraphqlOctokit(graphql), INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.alreadyReady).toBe(true);
    // No mutation call — the read-time check short-circuits.
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("converges when the mutation races a concurrent ready ('not a draft')", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(nodeIdResponse(true))
      .mockRejectedValueOnce(
        graphqlResponseError([{ type: "UNPROCESSABLE", message: "Pull request is not a draft" }]),
      );
    const result = await markPullRequestReadyForReview(mockGraphqlOctokit(graphql), INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.alreadyReady).toBe(true);
    expect(graphql).toHaveBeenCalledTimes(2);
  });

  it("not-found when the repository field is null", async () => {
    const graphql = vi.fn().mockResolvedValueOnce({ repository: null });
    const result = await markPullRequestReadyForReview(mockGraphqlOctokit(graphql), INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.NOT_FOUND);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("not-found when the pullRequest field is null", async () => {
    const graphql = vi.fn().mockResolvedValueOnce({ repository: { pullRequest: null } });
    const result = await markPullRequestReadyForReview(mockGraphqlOctokit(graphql), INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.NOT_FOUND);
  });

  it("maps a resolve-time GraphQL error (forbidden) to a sanitized failure, no mutation", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(graphqlResponseError([{ type: "FORBIDDEN", message: "no access" }]));
    const result = await markPullRequestReadyForReview(mockGraphqlOctokit(graphql), INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.FORBIDDEN);
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
          request: { method: "POST", url: "https://api.github.com/graphql", headers: {} },
          response: {
            status: 502,
            url: "https://api.github.com/graphql",
            headers: {},
            data: {},
          },
        }),
      );
    const result = await markPullRequestReadyForReview(mockGraphqlOctokit(graphql), INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
  });

  it("flags an ill-shaped resolve response as an unexpected-shape failure", async () => {
    const graphql = vi.fn().mockResolvedValueOnce({ repository: { pullRequest: { id: 123 } } });
    const result = await markPullRequestReadyForReview(mockGraphqlOctokit(graphql), INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
  });
});
