// Thread mutation tests: the LINE and FILE payload shapes, the three-way
// split between a rejected anchor (HTTP 200, `thread: null`, no errors), a
// GraphQL error and a transport error, and the sanitized failure paths.
// GraphQL is stubbed at the `octokit.graphql` interface.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  addPullRequestReviewThread,
  ReviewCommentSides,
  ReviewSubjectTypes,
  ReviewThreadFailureKinds,
} from "../src/operations/review-thread";
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
const THREAD_ID = "PRRT_kwDOEFGH";

const LINE_INPUT = {
  reviewNodeId: REVIEW_NODE_ID,
  subjectType: ReviewSubjectTypes.LINE,
  path: "src/a.ts",
  line: 12,
  side: ReviewCommentSides.RIGHT,
  body: "anchored note",
} as const;

const FILE_INPUT = {
  reviewNodeId: REVIEW_NODE_ID,
  subjectType: ReviewSubjectTypes.FILE,
  path: "src/app.ts",
  body: "on the file",
} as const;

function makeThreadResponse(id: string | null): unknown {
  return {
    addPullRequestReviewThread: { thread: id === null ? null : { id } },
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

describe("addPullRequestReviewThread", () => {
  it("posts a single-line thread with line and side only", async () => {
    const graphql = vi.fn().mockResolvedValue(makeThreadResponse(THREAD_ID));
    const result = await addPullRequestReviewThread(
      mockGraphqlOctokit(graphql),
      LINE_INPUT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threadId).toBe(THREAD_ID);
    const [mutation] = graphql.mock.calls[0] ?? [];
    expect(String(mutation)).toContain("addPullRequestReviewThread");
    expect(readSentInput(graphql)).toEqual({
      pullRequestReviewId: REVIEW_NODE_ID,
      path: "src/a.ts",
      body: "anchored note",
      subjectType: "LINE",
      line: 12,
      side: "RIGHT",
    });
  });

  it("posts a range thread with the start pair spelled out", async () => {
    const graphql = vi.fn().mockResolvedValue(makeThreadResponse(THREAD_ID));
    await addPullRequestReviewThread(mockGraphqlOctokit(graphql), {
      ...LINE_INPUT,
      line: 30,
      side: ReviewCommentSides.LEFT,
      startLine: 25,
      startSide: ReviewCommentSides.LEFT,
    });

    expect(readSentInput(graphql)).toMatchObject({
      subjectType: "LINE",
      line: 30,
      side: "LEFT",
      startLine: 25,
      startSide: "LEFT",
    });
  });

  it("posts a file thread with no line coordinate at all", async () => {
    const graphql = vi.fn().mockResolvedValue(makeThreadResponse(THREAD_ID));
    const result = await addPullRequestReviewThread(
      mockGraphqlOctokit(graphql),
      FILE_INPUT,
    );

    expect(result.ok).toBe(true);
    const sent = readSentInput(graphql);
    expect(sent).toEqual({
      pullRequestReviewId: REVIEW_NODE_ID,
      path: "src/app.ts",
      body: "on the file",
      subjectType: "FILE",
    });
    expect("line" in sent).toBe(false);
    expect("side" in sent).toBe(false);
    expect("startLine" in sent).toBe(false);
    expect("startSide" in sent).toBe(false);
  });

  it("reports a null thread on a 200 as a rejected anchor", async () => {
    const graphql = vi.fn().mockResolvedValue(makeThreadResponse(null));
    const result = await addPullRequestReviewThread(
      mockGraphqlOctokit(graphql),
      FILE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error).toEqual({
      kind: ReviewThreadFailureKinds.ANCHOR_REJECTED,
    });
  });

  it("folds a thrown UNPROCESSABLE entry as a rejected anchor", async () => {
    const graphql = vi.fn().mockRejectedValue(
      graphqlResponseError([
        {
          type: "UNPROCESSABLE",
          message: "pull_request_review_thread.line must be part of the diff",
        },
      ]),
    );
    const result = await addPullRequestReviewThread(
      mockGraphqlOctokit(graphql),
      LINE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error).toEqual({
      kind: ReviewThreadFailureKinds.ANCHOR_REJECTED,
    });
    expect(JSON.stringify(result.error)).not.toContain("part of the diff");
  });

  it("keeps a mixed errors array as a request failure", async () => {
    const graphql = vi.fn().mockRejectedValue(
      graphqlResponseError([
        { type: "RATE_LIMITED", message: "slow down" },
        { type: "UNPROCESSABLE", message: "line must be part of the diff" },
      ]),
    );
    const result = await addPullRequestReviewThread(
      mockGraphqlOctokit(graphql),
      LINE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.kind).toBe(ReviewThreadFailureKinds.REQUEST_FAILED);
    if (result.error.kind !== ReviewThreadFailureKinds.REQUEST_FAILED) {
      throw new Error("unreachable");
    }
    expect(result.error.error.code).toBe(GitHubApiErrorCodes.RATE_LIMITED);
  });

  it("maps a GraphQL error to a sanitized request failure, not a rejection", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValue(
        graphqlResponseError([{ type: "FORBIDDEN", message: "no access" }]),
      );
    const result = await addPullRequestReviewThread(
      mockGraphqlOctokit(graphql),
      LINE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.kind).toBe(ReviewThreadFailureKinds.REQUEST_FAILED);
    if (result.error.kind !== ReviewThreadFailureKinds.REQUEST_FAILED) {
      throw new Error("unreachable");
    }
    expect(result.error.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(LEAKED_TOKEN);
    expect(serialized).not.toContain(UPSTREAM_TEXT);
    expect(serialized).not.toContain("no access");
  });

  it("maps a transport error to a sanitized request failure", async () => {
    const graphql = vi.fn().mockRejectedValue(
      new RequestError("Server Error", 502, {
        request: {
          method: "POST",
          url: "https://api.github.com/graphql",
          headers: { authorization: `token ${LEAKED_TOKEN}` },
        },
        response: {
          status: 502,
          url: "https://api.github.com/graphql",
          headers: {},
          data: {},
        },
      }),
    );
    const result = await addPullRequestReviewThread(
      mockGraphqlOctokit(graphql),
      LINE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.kind).toBe(ReviewThreadFailureKinds.REQUEST_FAILED);
    if (result.error.kind !== ReviewThreadFailureKinds.REQUEST_FAILED) {
      throw new Error("unreachable");
    }
    expect(result.error.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(result.error.error.status).toBe(502);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });

  it("flags an ill-shaped mutation response as a request failure", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue({ addPullRequestReviewThread: { thread: { id: 1 } } });
    const result = await addPullRequestReviewThread(
      mockGraphqlOctokit(graphql),
      LINE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.kind).toBe(ReviewThreadFailureKinds.REQUEST_FAILED);
    if (result.error.kind !== ReviewThreadFailureKinds.REQUEST_FAILED) {
      throw new Error("unreachable");
    }
    expect(result.error.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });
});
