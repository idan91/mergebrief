// GraphQL supplies first-class thread resolution state unavailable through REST.
// Keep node ids inside this module; domain ids are numeric REST databaseIds.
// Failures use mapGraphqlError.
import type { Octokit } from "octokit";
import { z } from "zod";
import {
  GitHubApiErrorCodes,
  mapGraphqlError,
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import { ReviewCommentSides, type ReviewCommentSide } from "./review-thread";
import type { Result, ValueOf } from "../types";
import type { Mutable } from "types";

/** GitHub wire values for a review thread's subject (line-anchored or file-level). */
export const ThreadSubjectTypes = {
  LINE: "LINE",
  FILE: "FILE",
} as const;
export type ThreadSubjectType = ValueOf<typeof ThreadSubjectTypes>;

/**
 * GitHub wire values for a submitted review's state. `PENDING` is deliberately
 * absent: a pending review is a draft, and those nodes are skipped in mapping.
 */
export const ReviewVerdictStates = {
  COMMENTED: "COMMENTED",
  APPROVED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  DISMISSED: "DISMISSED",
} as const;
export type ReviewVerdictState = ValueOf<typeof ReviewVerdictStates>;

export interface ConversationAuthor {
  /** GitHub login; `"ghost"` when the account was deleted. */
  readonly login: string;
  /** True when the author is a GitHub App bot (GraphQL `__typename: "Bot"`). */
  readonly isBot: boolean;
  /** GitHub-CDN avatar (Actor.avatarUrl); absent only for ghost authors. */
  readonly avatarUrl?: string;
}

export interface ConversationComment {
  /** REST `databaseId`, the id the reply endpoint and REST tooling accept. */
  readonly commentId: number;
  readonly author: ConversationAuthor;
  readonly body: string;
  /** ISO-8601 timestamp. */
  readonly createdAt: string;
  /** GitHub permalink to this comment. */
  readonly url: string;
  /**
   * The formal review this comment belongs to, the own-comment join key
   * against the submit flow's returned review id.
   */
  readonly reviewId?: number;
}

export interface ConversationThread {
  /**
   * The thread's first comment id, the thread's stable identity AND the
   * `comment_id` a reply POST targets (GraphQL threads carry no databaseId).
   */
  readonly rootCommentId: number;
  readonly path: string;
  /** END line on the PR's current diff; absent for outdated/file-level threads. */
  readonly line?: number;
  /** First line of a multi-line anchor; absent for single-line threads. */
  readonly startLine?: number;
  readonly side?: ReviewCommentSide;
  readonly startSide?: ReviewCommentSide;
  readonly subjectType: ThreadSubjectType;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  /** Commit the thread was anchored on, the revision label for outdated threads. */
  readonly anchorSha?: string;
  /** Chronological; index 0 is the root comment, the rest are replies. */
  readonly comments: readonly ConversationComment[];
  /** True when the thread holds more comments than one page (noted, not paged in v1). */
  readonly hasMoreComments: boolean;
}

export interface ConversationReview {
  readonly reviewId: number;
  readonly author: ConversationAuthor;
  readonly state: ReviewVerdictState;
  readonly body: string;
  /** ISO-8601; absent only if GitHub omits it (dismissed edge cases). */
  readonly submittedAt?: string;
  readonly url: string;
}

/** A PR-level (issue) comment on the conversation timeline. */
export interface PrComment {
  readonly commentId: number;
  readonly author: ConversationAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
}

export interface PrConversation {
  readonly threads: readonly ConversationThread[];
  readonly reviews: readonly ConversationReview[];
  readonly prComments: readonly PrComment[];
  /** True when the thread-page safety cap was hit before exhausting pages. */
  readonly hasMoreThreads: boolean;
  readonly hasMoreReviews: boolean;
  readonly hasMorePrComments: boolean;
}

export interface FetchPullRequestConversationInput {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
}

// ---------------------------------------------------------------------------
// Wire schemas, Zod-validated at the boundary (no bare `as` off the wire).
// ---------------------------------------------------------------------------

// `avatarUrl` is `URI!` on Actor, so github.com cannot omit it, but it is
// decorative, and optional keeps a hypothetical omission (GHES, schema drift)
// from failing the whole conversation fetch.
const authorSchema = z
  .object({
    login: z.string(),
    __typename: z.string(),
    avatarUrl: z.string().optional(),
  })
  .nullable();

// `fullDatabaseId` is GitHub's BigInt scalar, serialized as a string; the
// legacy `databaseId` Int is deprecated for 64-bit ids.
const wireCommentSchema = z.object({
  fullDatabaseId: z.string().nullable(),
  author: authorSchema,
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
  pullRequestReview: z
    .object({ fullDatabaseId: z.string().nullable() })
    .nullable(),
  originalCommit: z.object({ oid: z.string() }).nullable(),
});

const diffSideSchema = z.enum([
  ReviewCommentSides.LEFT,
  ReviewCommentSides.RIGHT,
]);

const wireThreadSchema = z.object({
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string(),
  line: z.number().int().nullable(),
  startLine: z.number().int().nullable(),
  diffSide: diffSideSchema.nullable(),
  startDiffSide: diffSideSchema.nullable(),
  subjectType: z.enum([ThreadSubjectTypes.LINE, ThreadSubjectTypes.FILE]),
  comments: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean() }),
    nodes: z.array(wireCommentSchema.nullable()).nullable(),
  }),
});

// Connection `nodes` are nullable LISTS of NULLABLE elements in GitHub's
// schema, a null list reads as empty, a null element (node deleted or hidden
// mid-query) is skipped; neither is a whole-fetch failure.
const threadConnectionSchema = z.object({
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable(),
  }),
  nodes: z.array(wireThreadSchema.nullable()).nullable(),
});

const wireReviewSchema = z.object({
  fullDatabaseId: z.string().nullable(),
  author: authorSchema,
  state: z.enum(["PENDING", ...Object.values(ReviewVerdictStates)]),
  body: z.string(),
  submittedAt: z.string().nullable(),
  url: z.string(),
});

const wireIssueCommentSchema = z.object({
  fullDatabaseId: z.string().nullable(),
  author: authorSchema,
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
});

// `repository` and `pullRequest` are nullable in GitHub's schema, a missing
// or inaccessible resource can arrive as a null FIELD in a 2xx response, not
// only as a GraphQL error. `reviews` is likewise a nullable connection;
// `reviewThreads`/`comments` are NON_NULL.
const conversationResponseSchema = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({
          reviewThreads: threadConnectionSchema,
          reviews: z
            .object({
              pageInfo: z.object({ hasNextPage: z.boolean() }),
              nodes: z.array(wireReviewSchema.nullable()).nullable(),
            })
            .nullable(),
          comments: z.object({
            pageInfo: z.object({ hasNextPage: z.boolean() }),
            nodes: z.array(wireIssueCommentSchema.nullable()).nullable(),
          }),
        })
        .nullable(),
    })
    .nullable(),
});

const threadsPageResponseSchema = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({
          reviewThreads: threadConnectionSchema,
        })
        .nullable(),
    })
    .nullable(),
});

// ---------------------------------------------------------------------------
// Queries, variables only; nothing caller-supplied is ever interpolated.
// ---------------------------------------------------------------------------

const THREAD_PAGE_FIELDS = `
  pageInfo { hasNextPage endCursor }
  nodes {
    isResolved
    isOutdated
    path
    line
    startLine
    diffSide
    startDiffSide
    subjectType
    comments(first: 50) {
      pageInfo { hasNextPage }
      nodes {
        fullDatabaseId
        author { login __typename avatarUrl }
        body
        createdAt
        url
        pullRequestReview { fullDatabaseId }
        originalCommit { oid }
      }
    }
  }`;

const CONVERSATION_QUERY = `
query PullRequestConversation($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100) {${THREAD_PAGE_FIELDS}
      }
      reviews(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          fullDatabaseId
          author { login __typename avatarUrl }
          state
          body
          submittedAt
          url
        }
      }
      comments(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          fullDatabaseId
          author { login __typename avatarUrl }
          body
          createdAt
          url
        }
      }
    }
  }
}`;

const THREADS_PAGE_QUERY = `
query PullRequestConversationThreads($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100, after: $cursor) {${THREAD_PAGE_FIELDS}
      }
    }
  }
}`;

/**
 * Safety cap on thread pagination: 20 pages × 100 threads. A PR past 2,000
 * review threads is pathological; an unbounded cursor loop against it would
 * burn the shared installation rate budget. Hitting the cap sets
 * `hasMoreThreads` instead of failing.
 */
const MAX_THREAD_PAGES = 20;

const FETCH_CONTEXT = "fetch pull request conversation";

/** Sanitized not-found for a null repository/pullRequest field (expected failure). */
function resourceNotFoundError(): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.NOT_FOUND,
    message: `failed to ${FETCH_CONTEXT}: pull request not found`,
  };
}

// ---------------------------------------------------------------------------
// Wire → domain mapping.
// ---------------------------------------------------------------------------

/**
 * Parse a wire `fullDatabaseId` (BigInt-as-string) into the domain's number id.
 * `undefined` for null/unparseable/unsafe values, node-level defects drop the
 * node, envelope defects fail the fetch.
 */
function parseDatabaseId(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function mapAuthor(author: z.infer<typeof authorSchema>): ConversationAuthor {
  if (author === null) {
    return { login: "ghost", isBot: false };
  }

  const conversationAuthor: Mutable<ConversationAuthor> = {
    login: author.login,
    isBot: author.__typename === "Bot",
  };

  if (author.avatarUrl !== undefined) {
    conversationAuthor.avatarUrl = author.avatarUrl;
  }

  return conversationAuthor;
}

function mapComment(
  comment: z.infer<typeof wireCommentSchema>,
): ConversationComment | undefined {
  const commentId = parseDatabaseId(comment.fullDatabaseId);
  if (commentId === undefined) {
    return undefined;
  }
  const reviewId =
    comment.pullRequestReview === null
      ? undefined
      : parseDatabaseId(comment.pullRequestReview.fullDatabaseId);
  const conversationComment: Mutable<ConversationComment> = {
    commentId,
    author: mapAuthor(comment.author),
    body: comment.body,
    createdAt: comment.createdAt,
    url: comment.url,
  };

  if (reviewId !== undefined) conversationComment.reviewId = reviewId;

  return conversationComment;
}

function mapThread(
  thread: z.infer<typeof wireThreadSchema>,
): ConversationThread | undefined {
  // The ROOT must be nodes[0] BEFORE any filtering: a null/unmappable root
  // with visible replies skips the whole thread, never promotes a reply to
  // thread identity/reply target.
  const commentNodes = thread.comments.nodes ?? [];
  const wireRoot = commentNodes[0];
  if (wireRoot === null || wireRoot === undefined) {
    return undefined;
  }
  const root = mapComment(wireRoot);
  if (root === undefined) {
    return undefined;
  }
  const replies: ConversationComment[] = [];
  for (const node of commentNodes.slice(1)) {
    if (node === null) {
      continue;
    }
    const reply = mapComment(node);
    if (reply !== undefined) {
      replies.push(reply);
    }
  }
  const comments = [root, ...replies];
  const anchorSha = wireRoot.originalCommit?.oid;
  const conversationThread: Mutable<ConversationThread> = {
    rootCommentId: root.commentId,
    path: thread.path,
    subjectType: thread.subjectType,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    comments,
    hasMoreComments: thread.comments.pageInfo.hasNextPage,
  };

  if (thread.line !== null) conversationThread.line = thread.line;
  if (thread.startLine !== null) {
    conversationThread.startLine = thread.startLine;
  }
  if (thread.diffSide !== null) conversationThread.side = thread.diffSide;
  if (thread.startDiffSide !== null) {
    conversationThread.startSide = thread.startDiffSide;
  }
  if (anchorSha !== undefined) conversationThread.anchorSha = anchorSha;

  return conversationThread;
}

function mapReviews(
  reviews: ReadonlyArray<z.infer<typeof wireReviewSchema> | null>,
): ConversationReview[] {
  const mapped: ConversationReview[] = [];
  for (const review of reviews) {
    if (review === null || review.state === "PENDING") {
      continue;
    }
    const reviewId = parseDatabaseId(review.fullDatabaseId);
    if (reviewId === undefined) {
      // Node-level defect: drop the node, never the fetch.
      continue;
    }
    const conversationReview: Mutable<ConversationReview> = {
      reviewId,
      author: mapAuthor(review.author),
      state: review.state,
      body: review.body,
      url: review.url,
    };

    if (review.submittedAt !== null) {
      conversationReview.submittedAt = review.submittedAt;
    }

    mapped.push(conversationReview);
  }
  return mapped;
}

/**
 * Fetch a PR's full conversation in one GraphQL query, cursor-paging threads to
 * exhaustion (capped). Intended to run on an installation-token octokit, so
 * reads share one rate budget and one cache entry per PR. No REST fallback.
 */
export async function fetchPullRequestConversation(
  octokit: Octokit,
  input: FetchPullRequestConversationInput,
): Promise<Result<PrConversation, GitHubApiError>> {
  const variables = {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
  };

  let firstPage: unknown;
  try {
    firstPage = await octokit.graphql(CONVERSATION_QUERY, variables);
  } catch (error) {
    return { ok: false, error: mapGraphqlError(error, FETCH_CONTEXT) };
  }

  const parsed = conversationResponseSchema.safeParse(firstPage);
  if (!parsed.success) {
    return { ok: false, error: unexpectedResponseError(FETCH_CONTEXT) };
  }
  const pullRequest = parsed.data.repository?.pullRequest;
  if (pullRequest === null || pullRequest === undefined) {
    return { ok: false, error: resourceNotFoundError() };
  }

  const wireThreads = [...(pullRequest.reviewThreads.nodes ?? [])];
  let pageInfo = pullRequest.reviewThreads.pageInfo;
  let pagesFetched = 1;
  while (
    pageInfo.hasNextPage &&
    pageInfo.endCursor !== null &&
    pagesFetched < MAX_THREAD_PAGES
  ) {
    let nextPage: unknown;
    try {
      nextPage = await octokit.graphql(THREADS_PAGE_QUERY, {
        ...variables,
        cursor: pageInfo.endCursor,
      });
    } catch (error) {
      return { ok: false, error: mapGraphqlError(error, FETCH_CONTEXT) };
    }
    const parsedPage = threadsPageResponseSchema.safeParse(nextPage);
    if (!parsedPage.success) {
      return { ok: false, error: unexpectedResponseError(FETCH_CONTEXT) };
    }
    const pagePullRequest = parsedPage.data.repository?.pullRequest;
    if (pagePullRequest === null || pagePullRequest === undefined) {
      // The PR vanished mid-pagination (deleted / access revoked).
      return { ok: false, error: resourceNotFoundError() };
    }
    const connection = pagePullRequest.reviewThreads;
    wireThreads.push(...(connection.nodes ?? []));
    pageInfo = connection.pageInfo;
    pagesFetched += 1;
  }

  const threads: ConversationThread[] = [];
  for (const wireThread of wireThreads) {
    if (wireThread === null) {
      continue;
    }
    const thread = mapThread(wireThread);
    if (thread !== undefined) {
      threads.push(thread);
    }
  }

  const reviews = mapReviews(pullRequest.reviews?.nodes ?? []);

  const prComments: PrComment[] = [];
  for (const node of pullRequest.comments.nodes ?? []) {
    if (node === null) {
      continue;
    }
    const commentId = parseDatabaseId(node.fullDatabaseId);
    if (commentId === undefined) {
      continue;
    }
    prComments.push({
      commentId,
      author: mapAuthor(node.author),
      body: node.body,
      createdAt: node.createdAt,
      url: node.url,
    });
  }

  return {
    ok: true,
    value: {
      threads,
      reviews,
      prComments,
      hasMoreThreads: pageInfo.hasNextPage,
      hasMoreReviews: pullRequest.reviews?.pageInfo.hasNextPage ?? false,
      hasMorePrComments: pullRequest.comments.pageInfo.hasNextPage,
    },
  };
}

export interface CreateReviewCommentReplyInput {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  /** The thread's ROOT comment id (`ConversationThread.rootCommentId`). */
  readonly commentId: number;
  readonly body: string;
}

/**
 * Reply to an existing review thread, authored by whoever the octokit's token
 * identifies. Replies post IMMEDIATELY, outside any pending review,
 * create-review's `comments[]` cannot express `in_reply_to`, so there is no
 * batched alternative.
 */
export async function createReviewCommentReply(
  octokit: Octokit,
  input: CreateReviewCommentReplyInput,
): Promise<Result<{ readonly commentId: number }, GitHubApiError>> {
  try {
    const response = await octokit.rest.pulls.createReplyForReviewComment({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      comment_id: input.commentId,
      body: input.body,
    });
    // JSON.parse rounds ints past 2^53 before we see them.
    if (!Number.isSafeInteger(response.data.id)) {
      return {
        ok: false,
        error: unexpectedResponseError("create review comment reply"),
      };
    }
    return { ok: true, value: { commentId: response.data.id } };
  } catch (error) {
    return {
      ok: false,
      error: mapRequestError(error, "create review comment reply"),
    };
  }
}
