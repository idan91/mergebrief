// Thread-resolution mutation tests: the lean `reviewThreads` page walk that
// maps a root comment id to the thread's node id, the converged read-time
// paths, the multi-page cursor walk and its page cap, the not-found paths, and
// the sanitized failure paths. GraphQL is stubbed at the `octokit.graphql`
// interface. No throttle concerns, since GraphQL calls are not on the
// notification-triggering REST throttle list.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { setReviewThreadResolution } from "../src/operations/resolve-thread";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  LEAKED_TOKEN,
  UPSTREAM_TEXT,
  graphqlResponseError,
} from "./fixtures/graphql-error";

function mockGraphqlOctokit(graphql: ReturnType<typeof vi.fn>): Octokit {
  const stub = { graphql };
  return stub as unknown as Octokit;
}

const ROOT_COMMENT_ID = 4_242_424_242;
const THREAD_NODE_ID = "PRRT_kwDOABCD";
const OTHER_THREAD_NODE_ID = "PRRT_kwDOZZZZ";

const RESOLVE_INPUT = {
  owner: "o",
  repo: "r",
  prNumber: 7,
  rootCommentId: ROOT_COMMENT_ID,
  resolved: true,
} as const;
const UNRESOLVE_INPUT = { ...RESOLVE_INPUT, resolved: false } as const;

function threadNode(options: {
  readonly id: string;
  readonly isResolved: boolean;
  /**
   * `null` models a thread whose root comment carries no usable database id. A
   * string passes through verbatim, so tests can plant raw wire values the
   * BigInt parse must reject (non-numeric, or past 2^53).
   */
  readonly rootCommentId: number | string | null;
}): unknown {
  return {
    id: options.id,
    isResolved: options.isResolved,
    comments: {
      nodes: [
        options.rootCommentId === null
          ? { fullDatabaseId: null }
          : { fullDatabaseId: String(options.rootCommentId) },
      ],
    },
  };
}

/**
 * A `reviewThreads` page. `hasNextPage` defaults to "there is a cursor" but is
 * independently settable, so a DEGENERATE page (GitHub promising another page
 * while withholding the cursor) can be expressed.
 */
function walkPage(
  nodes: readonly unknown[],
  endCursor: string | null = null,
  hasNextPage: boolean = endCursor !== null,
): unknown {
  return {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage, endCursor },
          nodes,
        },
      },
    },
  };
}

function mutationResponse(
  field: "resolveReviewThread" | "unresolveReviewThread",
  isResolved: boolean,
): unknown {
  return { [field]: { thread: { isResolved } } };
}

describe("setReviewThreadResolution", () => {
  it("resolves a thread found on page 1: mutation carries the thread node id", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        walkPage([
          threadNode({
            id: OTHER_THREAD_NODE_ID,
            isResolved: false,
            rootCommentId: 99,
          }),
          threadNode({
            id: THREAD_NODE_ID,
            isResolved: false,
            rootCommentId: ROOT_COMMENT_ID,
          }),
        ]),
      )
      .mockResolvedValueOnce(mutationResponse("resolveReviewThread", true));

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.alreadyInTargetState).toBe(false);
    expect(graphql).toHaveBeenCalledTimes(2);
    // The walk carries owner/repo/number as variables (never interpolated).
    const [, walkVars] = graphql.mock.calls[0] ?? [];
    expect(walkVars).toEqual({
      owner: "o",
      repo: "r",
      prNumber: 7,
      cursor: null,
    });
    // The mutation carries the found thread's NODE id, never the PR number or
    // the root comment id.
    const [mutationQuery, mutationVars] = graphql.mock.calls[1] ?? [];
    expect(String(mutationQuery)).toContain("resolveReviewThread");
    expect(mutationVars).toEqual({ threadId: THREAD_NODE_ID });
  });

  it("unresolves a resolved thread through the unresolve mutation", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        walkPage([
          threadNode({
            id: THREAD_NODE_ID,
            isResolved: true,
            rootCommentId: ROOT_COMMENT_ID,
          }),
        ]),
      )
      .mockResolvedValueOnce(mutationResponse("unresolveReviewThread", false));

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      UNRESOLVE_INPUT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.alreadyInTargetState).toBe(false);
    expect(graphql).toHaveBeenCalledTimes(2);
    const [mutationQuery, mutationVars] = graphql.mock.calls[1] ?? [];
    expect(String(mutationQuery)).toContain("unresolveReviewThread");
    expect(mutationVars).toEqual({ threadId: THREAD_NODE_ID });
  });

  it("converges without mutating when the thread is already resolved", async () => {
    const graphql = vi.fn().mockResolvedValueOnce(
      walkPage([
        threadNode({
          id: THREAD_NODE_ID,
          isResolved: true,
          rootCommentId: ROOT_COMMENT_ID,
        }),
      ]),
    );

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.alreadyInTargetState).toBe(true);
    // No mutation call: the read-time state short-circuits.
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("converges without mutating when the thread is already unresolved", async () => {
    const graphql = vi.fn().mockResolvedValueOnce(
      walkPage([
        threadNode({
          id: THREAD_NODE_ID,
          isResolved: false,
          rootCommentId: ROOT_COMMENT_ID,
        }),
      ]),
    );

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      UNRESOLVE_INPUT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.alreadyInTargetState).toBe(true);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("carries the cursor forward and mutates a thread found on page 2", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        walkPage(
          [
            threadNode({
              id: OTHER_THREAD_NODE_ID,
              isResolved: false,
              rootCommentId: 99,
            }),
          ],
          "CURSOR_1",
        ),
      )
      .mockResolvedValueOnce(
        walkPage([
          threadNode({
            id: THREAD_NODE_ID,
            isResolved: false,
            rootCommentId: ROOT_COMMENT_ID,
          }),
        ]),
      )
      .mockResolvedValueOnce(mutationResponse("resolveReviewThread", true));

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.alreadyInTargetState).toBe(false);
    expect(graphql).toHaveBeenCalledTimes(3);
    const [, secondWalkVars] = graphql.mock.calls[1] ?? [];
    expect(secondWalkVars).toEqual({
      owner: "o",
      repo: "r",
      prNumber: 7,
      cursor: "CURSOR_1",
    });
    const [, mutationVars] = graphql.mock.calls[2] ?? [];
    expect(mutationVars).toEqual({ threadId: THREAD_NODE_ID });
  });

  it("not-found when the root comment id matches no thread on any page", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        walkPage(
          [
            threadNode({
              id: OTHER_THREAD_NODE_ID,
              isResolved: false,
              rootCommentId: 99,
            }),
          ],
          "CURSOR_1",
        ),
      )
      .mockResolvedValueOnce(
        walkPage([
          threadNode({
            id: "PRRT_other2",
            isResolved: false,
            rootCommentId: 100,
          }),
        ]),
      );

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    // Walked both pages, never mutated.
    expect(graphql).toHaveBeenCalledTimes(2);
  });

  it("skips a thread whose root comment carries no usable database id", async () => {
    const graphql = vi.fn().mockResolvedValueOnce(
      walkPage([
        threadNode({
          id: THREAD_NODE_ID,
          isResolved: false,
          rootCommentId: null,
        }),
      ]),
    );

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("skips a thread whose root database id is not a number", async () => {
    const graphql = vi.fn().mockResolvedValueOnce(
      walkPage([
        threadNode({
          id: THREAD_NODE_ID,
          isResolved: false,
          rootCommentId: "abc",
        }),
      ]),
    );

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("skips an unsafe-integer root database id rather than match it rounded", async () => {
    // `Number("9007199254740993")` ROUNDS to 9007199254740992. Drop the
    // safe-integer guard and this thread would falsely match a request for the
    // rounded id, mutating the WRONG thread. The correct outcome is not-found.
    const roundsTo = 9_007_199_254_740_992;
    const graphql = vi.fn().mockResolvedValueOnce(
      walkPage([
        threadNode({
          id: OTHER_THREAD_NODE_ID,
          isResolved: false,
          rootCommentId: 99,
        }),
        threadNode({
          id: THREAD_NODE_ID,
          isResolved: false,
          rootCommentId: "9007199254740993",
        }),
      ]),
    );

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      {
        ...RESOLVE_INPUT,
        rootCommentId: roundsTo,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    // Nothing was mutated: no second call at all.
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("skips a null thread node and still mutates the matching thread", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        walkPage([
          null,
          threadNode({
            id: THREAD_NODE_ID,
            isResolved: false,
            rootCommentId: ROOT_COMMENT_ID,
          }),
        ]),
      )
      .mockResolvedValueOnce(mutationResponse("resolveReviewThread", true));

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.alreadyInTargetState).toBe(false);
    const [, mutationVars] = graphql.mock.calls[1] ?? [];
    expect(mutationVars).toEqual({ threadId: THREAD_NODE_ID });
  });

  it("terminates the walk when hasNextPage is true but the cursor is null", async () => {
    // Degenerate page: without the endCursor guard the walk would re-request
    // page 1 (cursor still null) until the cap, 20 identical calls deep.
    const graphql = vi.fn().mockResolvedValue(
      walkPage(
        [
          threadNode({
            id: OTHER_THREAD_NODE_ID,
            isResolved: false,
            rootCommentId: 99,
          }),
        ],
        null,
        true,
      ),
    );

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("not-found when the repository field is null", async () => {
    const graphql = vi.fn().mockResolvedValueOnce({ repository: null });
    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
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
    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("stops at the page cap and reports not-found without further calls", async () => {
    // Every page claims another page and never matches: the walk must stop at
    // the cap, not loop unbounded against a pathological PR.
    const graphql = vi
      .fn()
      .mockImplementation((_query: string, variables: unknown) =>
        typeof variables === "object" &&
        variables !== null &&
        "cursor" in variables
          ? Promise.resolve(walkPage([], "CURSOR_NEXT"))
          : Promise.reject(new Error("mutation must not be called")),
      );

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(graphql).toHaveBeenCalledTimes(20);
  });

  it("maps a forbidden walk-time error to a failure without mutating", async () => {
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(
        graphqlResponseError([{ type: "FORBIDDEN", message: "no access" }]),
      );

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(graphql).toHaveBeenCalledTimes(1);
    // No secret/upstream text leaks through the sanitization chokepoint.
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
    expect(JSON.stringify(result.error)).not.toContain(UPSTREAM_TEXT);
    expect(JSON.stringify(result.error)).not.toContain("no access");
  });

  it("maps a mutation-time transport failure to a sanitized failure", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        walkPage([
          threadNode({
            id: THREAD_NODE_ID,
            isResolved: false,
            rootCommentId: ROOT_COMMENT_ID,
          }),
        ]),
      )
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

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("never converges on a mutation-time GraphQL error, whatever its message", async () => {
    // Deliberate: this op has no verified already-in-state discriminator for
    // the mutation, so a mutation-level race stays a sanitized error (the FE
    // refetch reconciles) rather than being guessed from upstream text.
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        walkPage([
          threadNode({
            id: THREAD_NODE_ID,
            isResolved: false,
            rootCommentId: ROOT_COMMENT_ID,
          }),
        ]),
      )
      .mockRejectedValueOnce(
        graphqlResponseError([
          { type: "FORBIDDEN", message: "Thread is already resolved" },
        ]),
      );

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
    expect(JSON.stringify(result.error)).not.toContain("already resolved");
  });

  it("flags an ill-shaped walk response as an unexpected-shape failure", async () => {
    const graphql = vi.fn().mockResolvedValueOnce({
      repository: { pullRequest: { reviewThreads: { nodes: [] } } },
    });

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("flags an ill-shaped mutation response as an unexpected-shape failure", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        walkPage([
          threadNode({
            id: THREAD_NODE_ID,
            isResolved: false,
            rootCommentId: ROOT_COMMENT_ID,
          }),
        ]),
      )
      .mockResolvedValueOnce({
        resolveReviewThread: { thread: { isResolved: "yes" } },
      });

    const result = await setReviewThreadResolution(
      mockGraphqlOctokit(graphql),
      RESOLVE_INPUT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });
});
