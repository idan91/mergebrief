// Submit mutation tests: the event and body ride as variables, an absent body
// stays absent, and every failure is sanitized. GraphQL is stubbed at the
// `octokit.graphql` interface.
import type { Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  ReviewEvents,
  submitPullRequestReview,
} from "../src/operations/review-submit";
import {
  LEAKED_TOKEN,
  UPSTREAM_TEXT,
  graphqlResponseError,
} from "./fixtures/graphql-error";

function mockGraphqlOctokit(graphql: ReturnType<typeof vi.fn>): Octokit {
  const stub = { graphql };
  return stub as unknown as Octokit;
}

const REVIEW_NODE_ID = "PRR_kwDOABCD";

function makeSubmitResponse(): unknown {
  return {
    submitPullRequestReview: { pullRequestReview: { id: REVIEW_NODE_ID } },
  };
}

function readSentInput(graphql: ReturnType<typeof vi.fn>): object {
  const [, variables] = graphql.mock.calls[0] ?? [];
  const input: unknown =
    typeof variables === "object" && variables !== null && "input" in variables
      ? variables.input
      : undefined;
  if (typeof input !== "object" || input === null) {
    throw new Error("expected a mutation input");
  }
  return input;
}

describe("submitPullRequestReview", () => {
  it("submits the pending review with the event and body as variables", async () => {
    const graphql = vi.fn().mockResolvedValue(makeSubmitResponse());
    const result = await submitPullRequestReview(mockGraphqlOctokit(graphql), {
      reviewNodeId: REVIEW_NODE_ID,
      event: ReviewEvents.REQUEST_CHANGES,
      body: "overall verdict",
    });

    expect(result.ok).toBe(true);
    const [mutation] = graphql.mock.calls[0] ?? [];
    expect(String(mutation)).toContain("submitPullRequestReview");
    expect(readSentInput(graphql)).toEqual({
      pullRequestReviewId: REVIEW_NODE_ID,
      event: "REQUEST_CHANGES",
      body: "overall verdict",
    });
  });

  it("omits the body entirely when absent", async () => {
    const graphql = vi.fn().mockResolvedValue(makeSubmitResponse());
    await submitPullRequestReview(mockGraphqlOctokit(graphql), {
      reviewNodeId: REVIEW_NODE_ID,
      event: ReviewEvents.APPROVE,
    });

    const sent = readSentInput(graphql);
    expect(sent).toEqual({
      pullRequestReviewId: REVIEW_NODE_ID,
      event: "APPROVE",
    });
    expect("body" in sent).toBe(false);
  });

  it("maps a GraphQL error to a sanitized failure", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValue(
        graphqlResponseError([{ type: "FORBIDDEN", message: "no access" }]),
      );
    const result = await submitPullRequestReview(mockGraphqlOctokit(graphql), {
      reviewNodeId: REVIEW_NODE_ID,
      event: ReviewEvents.COMMENT,
      body: "note",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(LEAKED_TOKEN);
    expect(serialized).not.toContain(UPSTREAM_TEXT);
    expect(serialized).not.toContain("no access");
  });

  it("treats a null mutation payload on a 2xx as submitted", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue({ submitPullRequestReview: null });
    const result = await submitPullRequestReview(mockGraphqlOctokit(graphql), {
      reviewNodeId: REVIEW_NODE_ID,
      event: ReviewEvents.COMMENT,
      body: "note",
    });

    expect(result.ok).toBe(true);
  });

  it("treats a null review inside the payload as submitted", async () => {
    const graphql = vi.fn().mockResolvedValue({
      submitPullRequestReview: { pullRequestReview: null },
    });
    const result = await submitPullRequestReview(mockGraphqlOctokit(graphql), {
      reviewNodeId: REVIEW_NODE_ID,
      event: ReviewEvents.COMMENT,
      body: "note",
    });

    expect(result.ok).toBe(true);
  });

  it("flags an ill-shaped mutation response as an unexpected shape", async () => {
    const graphql = vi.fn().mockResolvedValue({ submitPullRequestReview: 1 });
    const result = await submitPullRequestReview(mockGraphqlOctokit(graphql), {
      reviewNodeId: REVIEW_NODE_ID,
      event: ReviewEvents.COMMENT,
      body: "note",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });
});
