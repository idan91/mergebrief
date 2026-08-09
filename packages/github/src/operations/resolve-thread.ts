// Thread-resolution mutations: resolve / unresolve one PR review thread with
// the VIEWER's own token — GitHub itself enforces who may flip a thread, so no
// local role model is involved. GraphQL only: REST exposes no
// thread-resolution surface at all.
//
// The mutations take a thread NODE id, and a GraphQL review thread carries no
// `databaseId` — so the only way in from a domain id is to walk the PR's
// `reviewThreads` connection and match the thread's FIRST comment's
// `fullDatabaseId` against the caller's `rootCommentId`. The node id never
// leaves this module.
//
// Convergence: a thread ALREADY in the requested state short-circuits the
// mutation and reports `alreadyInTargetState: true`.
//
// Mutation-level races are NOT special-cased: GitHub publishes no
// machine-readable discriminator nor verified message text for this mutation,
// and guessing one would silently swallow real permission/validation failures.
// A raced call returns a sanitized error; the caller's refetch reconciles.
import type { Octokit } from "octokit";
import { z } from "zod";
import {
  GitHubApiErrorCode,
  mapGraphqlError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result } from "../types";

export interface SetReviewThreadResolutionInput {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  /**
   * The thread's ROOT comment id (`ConversationThread.rootCommentId`) — the
   * thread's stable domain identity. Resolved to a GraphQL node id internally.
   */
  readonly rootCommentId: number;
  /** Target state: `true` resolves the thread, `false` unresolves it. */
  readonly resolved: boolean;
}

export interface SetReviewThreadResolutionResult {
  /**
   * True when the thread was ALREADY in the requested state at read time, so no
   * mutation ran. A converged state, not a failure.
   */
  readonly alreadyInTargetState: boolean;
}

const CONTEXT = "set review thread resolution";

// ---------------------------------------------------------------------------
// Wire schemas — Zod-validated at the boundary (no bare `as` off the wire).
// ---------------------------------------------------------------------------

// Deliberately lean — this walk can burn up to 20 pages, and every extra field
// multiplies GraphQL node cost against the shared rate budget.
const wireThreadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  comments: z.object({
    nodes: z
      .array(z.object({ fullDatabaseId: z.string().nullable() }).nullable())
      .nullable(),
  }),
});

// `repository` and `pullRequest` are nullable in GitHub's schema — a missing or
// inaccessible resource can arrive as a null FIELD in a 2xx response, not only
// as a GraphQL error. Connection `nodes` are likewise nullable lists of
// nullable elements.
const threadPageResponseSchema = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({
          reviewThreads: z.object({
            pageInfo: z.object({
              hasNextPage: z.boolean(),
              endCursor: z.string().nullable(),
            }),
            nodes: z.array(wireThreadSchema.nullable()).nullable(),
          }),
        })
        .nullable(),
    })
    .nullable(),
});

const threadStateSchema = z.object({ isResolved: z.boolean() }).nullable();

const resolveMutationResponseSchema = z.object({
  resolveReviewThread: z.object({ thread: threadStateSchema }).nullable(),
});
const unresolveMutationResponseSchema = z.object({
  unresolveReviewThread: z.object({ thread: threadStateSchema }).nullable(),
});

// ---------------------------------------------------------------------------
// Queries — variables only; nothing caller-supplied is ever interpolated.
// ---------------------------------------------------------------------------

// `$cursor` is NULLABLE so one query serves both the first page and every
// continuation (`after: null` reads from the start).
const THREAD_IDS_QUERY = `
query PullRequestReviewThreadIds($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes {
              fullDatabaseId
            }
          }
        }
      }
    }
  }
}`;

const RESOLVE_MUTATION = `
mutation ResolveReviewThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      isResolved
    }
  }
}`;

const UNRESOLVE_MUTATION = `
mutation UnresolveReviewThread($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) {
    thread {
      isResolved
    }
  }
}`;

/**
 * Safety cap on the thread walk: an unbounded cursor loop would burn the shared
 * rate budget. Hitting the cap without a match reports not-found.
 */
const MAX_THREAD_PAGES = 20;

/** Sanitized not-found for a null repository/pullRequest field. */
function pullRequestNotFoundError(): GitHubApiError {
  return {
    code: GitHubApiErrorCode.NOT_FOUND,
    message: `failed to ${CONTEXT}: pull request not found`,
  };
}

/** Sanitized not-found for a `rootCommentId` that matches no thread on the PR. */
function threadNotFoundError(): GitHubApiError {
  return {
    code: GitHubApiErrorCode.NOT_FOUND,
    message: `failed to ${CONTEXT}: review thread not found`,
  };
}

/**
 * Parse a wire `fullDatabaseId` (GitHub's BigInt scalar, serialized as a
 * string) into the domain's number id; `undefined` for null/unparseable/unsafe
 * values, which cannot match a caller's id.
 */
function parseDatabaseId(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** The thread on this page whose ROOT comment is `rootCommentId`, if any. */
function findThreadByRootComment(
  nodes: ReadonlyArray<z.infer<typeof wireThreadSchema> | null>,
  rootCommentId: number,
): z.infer<typeof wireThreadSchema> | undefined {
  for (const node of nodes) {
    if (node === null) {
      continue;
    }
    // `comments(first: 1)` makes nodes[0] the root by construction; a thread
    // whose root is hidden or carries no usable id cannot be addressed by
    // domain id at all, so it is skipped rather than failing the walk.
    const root = node.comments.nodes?.[0];
    if (root === null || root === undefined) {
      continue;
    }
    if (parseDatabaseId(root.fullDatabaseId) === rootCommentId) {
      return node;
    }
  }
  return undefined;
}

/**
 * Resolve or unresolve one PR review thread, acting as whoever the octokit's
 * token identifies. Walks the PR's review threads (capped, cursor-paged) to map
 * `rootCommentId` to the thread's node id, then runs the matching mutation. A
 * thread already in the requested state converges without mutating; a
 * `rootCommentId` matching no thread — including one past the cap — is
 * not-found.
 */
export async function setReviewThreadResolution(
  octokit: Octokit,
  input: SetReviewThreadResolutionInput,
): Promise<Result<SetReviewThreadResolutionResult, GitHubApiError>> {
  const variables = {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
  };

  let cursor: string | null = null;
  let thread: z.infer<typeof wireThreadSchema> | undefined;

  for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
    let response: unknown;
    try {
      response = await octokit.graphql(THREAD_IDS_QUERY, {
        ...variables,
        cursor,
      });
    } catch (error) {
      return { ok: false, error: mapGraphqlError(error, CONTEXT) };
    }

    const parsed = threadPageResponseSchema.safeParse(response);
    if (!parsed.success) {
      return { ok: false, error: unexpectedResponseError(CONTEXT) };
    }
    const pullRequest = parsed.data.repository?.pullRequest;
    if (pullRequest === null || pullRequest === undefined) {
      // Also covers the PR vanishing mid-walk (deleted / access revoked).
      return { ok: false, error: pullRequestNotFoundError() };
    }

    const connection = pullRequest.reviewThreads;
    thread = findThreadByRootComment(
      connection.nodes ?? [],
      input.rootCommentId,
    );
    if (thread !== undefined) {
      break;
    }
    if (
      !connection.pageInfo.hasNextPage ||
      connection.pageInfo.endCursor === null
    ) {
      break;
    }
    cursor = connection.pageInfo.endCursor;
  }

  if (thread === undefined) {
    return { ok: false, error: threadNotFoundError() };
  }

  // Already in the requested state at read time — converged, no mutation.
  if (thread.isResolved === input.resolved) {
    return { ok: true, value: { alreadyInTargetState: true } };
  }

  const mutation = input.resolved ? RESOLVE_MUTATION : UNRESOLVE_MUTATION;
  const mutationResponseSchema = input.resolved
    ? resolveMutationResponseSchema
    : unresolveMutationResponseSchema;

  try {
    const mutated = await octokit.graphql(mutation, { threadId: thread.id });
    // Shape only: the returned `isResolved` is NOT gated on, since a concurrent
    // flip back is another client's write, not a failure of ours.
    if (!mutationResponseSchema.safeParse(mutated).success) {
      return { ok: false, error: unexpectedResponseError(CONTEXT) };
    }
    return { ok: true, value: { alreadyInTargetState: false } };
  } catch (error) {
    return { ok: false, error: mapGraphqlError(error, CONTEXT) };
  }
}
