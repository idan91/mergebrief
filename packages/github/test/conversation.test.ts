// Conversation primitive: `fetchPullRequestConversation` returns the
// pre-threaded conversation in one query. Drives the wire→domain mapping
// (human thread, reply chain, resolved, outdated, bot author, PR-level comment,
// pagination page) and the sanitized failure paths. There is no fallback
// tier, so a GraphQL failure is the section's error state.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import {
  createReviewCommentReply,
  fetchPullRequestConversation,
} from "../src/operations/conversation";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  conversationResponse,
  gqlComment,
  gqlIssueComment,
  gqlReview,
  gqlThread,
} from "./fixtures/conversation-graphql";
import {
  LEAKED_TOKEN,
  UPSTREAM_TEXT,
  graphqlResponseError,
} from "./fixtures/graphql-error";

function mockGraphqlOctokit(graphql: ReturnType<typeof vi.fn>): Octokit {
  // The double assertion injects a structural mock where the full `Octokit`
  // type is expected.
  const stub = { graphql };
  return stub as unknown as Octokit;
}

const INPUT = { owner: "o", repo: "r", prNumber: 7 } as const;

describe("fetchPullRequestConversation mapping", () => {
  it("maps a human line thread with its root id, side, line, review and sha", async () => {
    const graphql = vi.fn().mockResolvedValue(
      conversationResponse({
        threads: [
          gqlThread({
            comments: [
              gqlComment({ databaseId: 1001, login: "alice" }),
              gqlComment({
                databaseId: 1002,
                login: "bob",
                body: "a reply",
                noReview: true,
              }),
            ],
          }),
        ],
      }),
    );
    const octokit = mockGraphqlOctokit(graphql);
    const result = await fetchPullRequestConversation(octokit, INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threads).toHaveLength(1);
    const thread = result.value.threads[0];
    if (thread === undefined) {
      throw new Error("expected a thread");
    }
    expect(thread.rootCommentId).toBe(1001);
    expect(thread.path).toBe("src/a.ts");
    expect(thread.line).toBe(12);
    expect(thread.side).toBe("RIGHT");
    expect(thread.startLine).toBeUndefined();
    expect(thread.isResolved).toBe(false);
    expect(thread.isOutdated).toBe(false);
    expect(thread.anchorSha).toBe("a".repeat(40));
    expect(thread.hasMoreComments).toBe(false);
    // Reply chain preserved in order; review join carried per comment.
    expect(thread.comments.map((comment) => comment.commentId)).toEqual([
      1001, 1002,
    ]);
    expect(thread.comments[0]?.reviewId).toBe(500);
    expect(thread.comments[1]?.reviewId).toBeUndefined();
    expect(thread.comments[0]?.author).toEqual({
      login: "alice",
      isBot: false,
      avatarUrl: "https://avatars.example/alice.png",
    });
    // Variables travel as GraphQL variables, never interpolated into the query.
    const [query, variables] = graphql.mock.calls[0] ?? [];
    expect(String(query)).toContain("$owner");
    expect(variables).toMatchObject({ owner: "o", repo: "r", prNumber: 7 });
  });

  it("passes resolved and outdated through, dropping outdated line numbers", async () => {
    const graphql = vi.fn().mockResolvedValue(
      conversationResponse({
        threads: [
          gqlThread({ isResolved: true }),
          gqlThread({
            isOutdated: true,
            line: null,
            comments: [gqlComment({ databaseId: 2001 })],
          }),
        ],
      }),
    );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threads[0]?.isResolved).toBe(true);
    const outdated = result.value.threads[1];
    expect(outdated?.isOutdated).toBe(true);
    expect(outdated?.line).toBeUndefined();
  });

  it("maps a multi-line thread with startLine and startSide", async () => {
    const graphql = vi.fn().mockResolvedValue(
      conversationResponse({
        threads: [
          gqlThread({
            line: 30,
            startLine: 25,
            diffSide: "LEFT",
            startDiffSide: "LEFT",
          }),
        ],
      }),
    );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    const thread = result.value.threads[0];
    expect(thread?.startLine).toBe(25);
    expect(thread?.startSide).toBe("LEFT");
    expect(thread?.side).toBe("LEFT");
  });

  it("flags a bot author by __typename and keeps a file thread's subject", async () => {
    const graphql = vi.fn().mockResolvedValue(
      conversationResponse({
        threads: [
          gqlThread({
            subjectType: "FILE",
            line: null,
            comments: [gqlComment({ login: "coderabbitai", typename: "Bot" })],
          }),
        ],
      }),
    );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    const thread = result.value.threads[0];
    expect(thread?.comments[0]?.author).toEqual({
      login: "coderabbitai",
      isBot: true,
      avatarUrl: "https://avatars.example/coderabbitai.png",
    });
    expect(thread?.subjectType).toBe("FILE");
    expect(thread?.line).toBeUndefined();
  });

  it("normalizes a deleted author to ghost", async () => {
    const graphql = vi.fn().mockResolvedValue(
      conversationResponse({
        threads: [gqlThread({ comments: [gqlComment({ ghost: true })] })],
      }),
    );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threads[0]?.comments[0]?.author).toEqual({
      login: "ghost",
      isBot: false,
    });
  });

  it("maps review verdicts and PR-level comments, skipping PENDING reviews", async () => {
    const graphql = vi.fn().mockResolvedValue(
      conversationResponse({
        reviews: [
          gqlReview({
            databaseId: 500,
            state: "CHANGES_REQUESTED",
            body: "needs work",
          }),
          gqlReview({ databaseId: 501, state: "PENDING", submittedAt: null }),
          gqlReview({ databaseId: 502, state: "APPROVED", login: "dave" }),
        ],
        issueComments: [
          gqlIssueComment({ databaseId: 9001, body: "a PR-level remark" }),
        ],
      }),
    );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.reviews.map((review) => review.reviewId)).toEqual([
      500, 502,
    ]);
    expect(result.value.reviews[0]?.state).toBe("CHANGES_REQUESTED");
    expect(result.value.reviews[0]?.body).toBe("needs work");
    expect(result.value.prComments).toHaveLength(1);
    expect(result.value.prComments[0]?.commentId).toBe(9001);
    expect(result.value.prComments[0]?.author.login).toBe("carol");
  });

  it("skips null connection nodes from deletion races instead of failing", async () => {
    // GitHub's GraphQL schema types every connection's nodes as a list of
    // NULLABLE elements: a node deleted or hidden mid-query arrives as null.
    const base = conversationResponse({
      threads: [gqlThread({ comments: [gqlComment({ databaseId: 1001 })] })],
      reviews: [gqlReview({ databaseId: 500 })],
      issueComments: [gqlIssueComment({ databaseId: 9001 })],
    });
    const withNulls = {
      repository: {
        pullRequest: {
          reviewThreads: {
            ...base.repository.pullRequest.reviewThreads,
            nodes: [
              null,
              {
                ...base.repository.pullRequest.reviewThreads.nodes[0],
                comments: {
                  pageInfo: { hasNextPage: false },
                  nodes: [gqlComment({ databaseId: 1001 }), null],
                },
              },
            ],
          },
          reviews: {
            ...base.repository.pullRequest.reviews,
            nodes: [null, ...base.repository.pullRequest.reviews.nodes],
          },
          comments: {
            ...base.repository.pullRequest.comments,
            nodes: [null, ...base.repository.pullRequest.comments.nodes],
          },
        },
      },
    };
    const graphql = vi.fn().mockResolvedValue(withNulls);
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threads).toHaveLength(1);
    expect(
      result.value.threads[0]?.comments.map((comment) => comment.commentId),
    ).toEqual([1001]);
    expect(result.value.reviews.map((review) => review.reviewId)).toEqual([
      500,
    ]);
    expect(result.value.prComments.map((comment) => comment.commentId)).toEqual(
      [9001],
    );
  });

  it("parses 64-bit ids from the BigInt-as-string fullDatabaseId scalar", async () => {
    // fullDatabaseId serializes as a string; modern REST ids already exceed
    // 32-bit Int (the deprecated databaseId).
    const graphql = vi.fn().mockResolvedValue(
      conversationResponse({
        threads: [
          gqlThread({
            comments: [
              gqlComment({
                databaseId: 5_000_000_000,
                reviewDatabaseId: 4_647_663_464,
              }),
            ],
          }),
        ],
        reviews: [gqlReview({ databaseId: 4_647_663_464 })],
        issueComments: [gqlIssueComment({ databaseId: 6_000_000_000 })],
      }),
    );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threads[0]?.rootCommentId).toBe(5_000_000_000);
    expect(result.value.threads[0]?.comments[0]?.reviewId).toBe(4_647_663_464);
    expect(result.value.reviews[0]?.reviewId).toBe(4_647_663_464);
    expect(result.value.prComments[0]?.commentId).toBe(6_000_000_000);
  });

  it("skips a thread whose ROOT comment is null, never promoting a reply", async () => {
    const graphql = vi.fn().mockResolvedValue(
      conversationResponse({
        threads: [
          gqlThread({
            commentNodes: [
              null,
              gqlComment({ databaseId: 1002, body: "a reply" }),
            ],
          }),
          gqlThread({ comments: [gqlComment({ databaseId: 2001 })] }),
        ],
      }),
    );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threads.map((thread) => thread.rootCommentId)).toEqual([
      2001,
    ]);
  });

  it("drops nodes with unparseable or unsafe ids without failing the fetch", async () => {
    const graphql = vi.fn().mockResolvedValue(
      conversationResponse({
        threads: [
          gqlThread({
            comments: [
              gqlComment({ databaseId: 1001 }),
              gqlComment({ rawFullDatabaseId: "not-a-number" }),
              gqlComment({ rawFullDatabaseId: "9007199254740993" }),
            ],
          }),
        ],
        reviews: [
          gqlReview({ rawFullDatabaseId: "junk" }),
          gqlReview({ databaseId: 502 }),
        ],
      }),
    );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(
      result.value.threads[0]?.comments.map((comment) => comment.commentId),
    ).toEqual([1001]);
    expect(result.value.reviews.map((review) => review.reviewId)).toEqual([
      502,
    ]);
  });

  it("treats a null nodes LIST on any connection as empty", async () => {
    const base = conversationResponse({
      threads: [gqlThread({ comments: [gqlComment({ databaseId: 1001 })] })],
    });
    const withNullLists = {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              base.repository.pullRequest.reviewThreads.nodes[0],
              // A thread whose comments LIST is null has no root identity.
              {
                ...gqlThread({}),
                comments: { pageInfo: { hasNextPage: false }, nodes: null },
              },
            ],
          },
          reviews: { pageInfo: { hasNextPage: false }, nodes: null },
          comments: { pageInfo: { hasNextPage: false }, nodes: null },
        },
      },
    };
    const graphql = vi.fn().mockResolvedValue(withNullLists);
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threads.map((thread) => thread.rootCommentId)).toEqual([
      1001,
    ]);
    expect(result.value.reviews).toEqual([]);
    expect(result.value.prComments).toEqual([]);
  });

  it("treats a null thread nodes list on a pagination page as an empty page", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        conversationResponse({
          threadsHasNextPage: true,
          threadsEndCursor: "CURSOR_1",
        }),
      )
      .mockResolvedValueOnce({
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: null,
            },
          },
        },
      });
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threads).toHaveLength(1);
  });
});

describe("fetchPullRequestConversation pagination and overflow", () => {
  it("cursor-pages review threads to exhaustion and concatenates pages", async () => {
    const pageOne = conversationResponse({
      threads: [gqlThread({ comments: [gqlComment({ databaseId: 1001 })] })],
      threadsHasNextPage: true,
      threadsEndCursor: "CURSOR_1",
    });
    const pageTwo = {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              gqlThread({ comments: [gqlComment({ databaseId: 2001 })] }),
            ],
          },
        },
      },
    };
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(pageOne)
      .mockResolvedValueOnce(pageTwo);
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threads.map((thread) => thread.rootCommentId)).toEqual([
      1001, 2001,
    ]);
    expect(result.value.hasMoreThreads).toBe(false);
    expect(graphql).toHaveBeenCalledTimes(2);
    // The follow-up page passes the cursor as a variable and re-fetches ONLY threads.
    const [pageQuery, pageVariables] = graphql.mock.calls[1] ?? [];
    expect(pageVariables).toMatchObject({
      owner: "o",
      repo: "r",
      prNumber: 7,
      cursor: "CURSOR_1",
    });
    expect(String(pageQuery)).toContain("after: $cursor");
    expect(String(pageQuery)).not.toContain("reviews(");
  });

  it("stops at the page safety cap and flags hasMoreThreads", async () => {
    const endlessPage = conversationResponse({
      threadsHasNextPage: true,
      threadsEndCursor: "CURSOR_N",
    });
    const graphql = vi.fn().mockResolvedValue(endlessPage);
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(graphql).toHaveBeenCalledTimes(20);
    expect(result.value.hasMoreThreads).toBe(true);
  });

  it("notes thread, review and PR-comment overflow without paging them", async () => {
    const graphql = vi.fn().mockResolvedValue(
      conversationResponse({
        threads: [gqlThread({ commentsHasNextPage: true })],
        reviewsHasNextPage: true,
        issueCommentsHasNextPage: true,
      }),
    );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.threads[0]?.hasMoreComments).toBe(true);
    expect(result.value.hasMoreReviews).toBe(true);
    expect(result.value.hasMorePrComments).toBe(true);
    expect(graphql).toHaveBeenCalledTimes(1);
  });
});

describe("fetchPullRequestConversation failure paths", () => {
  it("maps a GraphQL NOT_FOUND to a sanitized not-found with no fallback", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValue(
        graphqlResponseError([{ type: "NOT_FOUND", message: UPSTREAM_TEXT }]),
      );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(LEAKED_TOKEN);
    expect(serialized).not.toContain("Could not resolve");
  });

  it("maps a null repository or pullRequest to not-found", async () => {
    // Both fields are nullable in GitHub's schema: a missing resource can be a
    // null field in a 2xx response.
    for (const data of [
      { repository: null },
      { repository: { pullRequest: null } },
    ]) {
      const graphql = vi.fn().mockResolvedValue(data);
      const result = await fetchPullRequestConversation(
        mockGraphqlOctokit(graphql),
        INPUT,
      );
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("unreachable");
      }
      expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
      expect(result.error.message).not.toContain("unexpected");
    }
  });

  it("maps a malformed 2xx response shape to request-failed", async () => {
    const graphql = vi.fn().mockResolvedValue({ repository: 42 });
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(result.error.message).toContain(
      "unexpected GitHub API response shape",
    );
  });

  it("maps a null reviews connection to an empty verdict list", async () => {
    const base = conversationResponse({});
    const withNullReviews = {
      repository: {
        pullRequest: {
          ...base.repository.pullRequest,
          reviews: null,
        },
      },
    };
    const graphql = vi.fn().mockResolvedValue(withNullReviews);
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.reviews).toEqual([]);
    expect(result.value.hasMoreReviews).toBe(false);
    expect(result.value.threads).toHaveLength(1);
  });

  it("fails a mid-pagination error whole, never returning the first page", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        conversationResponse({
          threadsHasNextPage: true,
          threadsEndCursor: "CURSOR_1",
        }),
      )
      .mockRejectedValueOnce(
        graphqlResponseError([{ type: "RATE_LIMITED", message: "x" }]),
      );
    const result = await fetchPullRequestConversation(
      mockGraphqlOctokit(graphql),
      INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.RATE_LIMITED);
  });
});

function mockReplyOctokit(createReply: ReturnType<typeof vi.fn>): Octokit {
  const stub = {
    rest: { pulls: { createReplyForReviewComment: createReply } },
  };
  return stub as unknown as Octokit;
}

describe("createReviewCommentReply", () => {
  it("posts the reply to the root comment and returns the created comment id", async () => {
    const createReply = vi.fn().mockResolvedValue({ data: { id: 7001 } });
    const result = await createReviewCommentReply(
      mockReplyOctokit(createReply),
      {
        owner: "o",
        repo: "r",
        prNumber: 7,
        commentId: 1001,
        body: "a follow-up",
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.commentId).toBe(7001);
    expect(createReply).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 7,
      comment_id: 1001,
      body: "a follow-up",
    });
  });

  it("rejects a created id past the safe-integer range", async () => {
    const createReply = vi
      .fn()
      .mockResolvedValue({ data: { id: 9007199254740992 } });
    const result = await createReviewCommentReply(
      mockReplyOctokit(createReply),
      {
        owner: "o",
        repo: "r",
        prNumber: 7,
        commentId: 1001,
        body: "x",
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("maps a 404 for a deleted root comment to a sanitized not-found", async () => {
    const createReply = vi.fn().mockRejectedValue(
      new RequestError("HTTP 404", 404, {
        request: {
          method: "POST",
          url: "https://api.github.com/repos/o/r/pulls/7/comments/1001/replies",
          headers: { authorization: `token ${LEAKED_TOKEN}` },
        },
        response: {
          status: 404,
          url: "https://api.github.com/repos/o/r/pulls/7/comments/1001/replies",
          headers: {},
          data: { message: "Not Found" },
        },
      }),
    );
    const result = await createReviewCommentReply(
      mockReplyOctokit(createReply),
      {
        owner: "o",
        repo: "r",
        prNumber: 7,
        commentId: 1001,
        body: "x",
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });
});
