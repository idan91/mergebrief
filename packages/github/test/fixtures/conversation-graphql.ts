// GraphQL response fixtures for the conversation primitive: builders mirroring
// the wire shape `octokit.graphql` resolves with — the `data` content directly,
// no envelope. Covers human thread, reply chain, resolved, outdated, bot
// author, PR-level comment, and a pagination page.

interface GqlCommentOverrides {
  readonly databaseId?: number | null;
  /** Raw wire override for malformed-id tests (wins over databaseId). */
  readonly rawFullDatabaseId?: string | null;
  readonly login?: string;
  readonly typename?: string;
  readonly ghost?: boolean;
  readonly body?: string;
  readonly reviewDatabaseId?: number | null;
  readonly noReview?: boolean;
  readonly oid?: string | null;
}

function fullId(
  id: number | null | undefined,
  raw: string | null | undefined,
  fallback: number,
): string | null {
  if (raw !== undefined) return raw;
  const value = id === undefined ? fallback : id;
  return value === null ? null : String(value);
}

export function gqlComment(overrides: GqlCommentOverrides = {}) {
  return {
    fullDatabaseId: fullId(
      overrides.databaseId,
      overrides.rawFullDatabaseId,
      1001,
    ),
    author: overrides.ghost
      ? null
      : {
          login: overrides.login ?? "alice",
          __typename: overrides.typename ?? "User",
          avatarUrl: `https://avatars.example/${overrides.login ?? "alice"}.png`,
        },
    body: overrides.body ?? "a human comment",
    createdAt: "2026-07-01T10:00:00Z",
    url: "https://github.com/o/r/pull/7#discussion_r1001",
    pullRequestReview: overrides.noReview
      ? null
      : {
          fullDatabaseId: fullId(overrides.reviewDatabaseId, undefined, 500),
        },
    originalCommit:
      overrides.oid === null ? null : { oid: overrides.oid ?? "a".repeat(40) },
  };
}

interface GqlThreadOverrides {
  readonly isResolved?: boolean;
  readonly isOutdated?: boolean;
  readonly path?: string;
  readonly line?: number | null;
  readonly startLine?: number | null;
  readonly diffSide?: "LEFT" | "RIGHT";
  readonly startDiffSide?: "LEFT" | "RIGHT" | null;
  readonly subjectType?: "LINE" | "FILE";
  readonly comments?: ReturnType<typeof gqlComment>[];
  /** Raw nodes override (nullable entries) for deletion-race tests. */
  readonly commentNodes?: (ReturnType<typeof gqlComment> | null)[];
  readonly commentsHasNextPage?: boolean;
}

export function gqlThread(overrides: GqlThreadOverrides = {}) {
  return {
    isResolved: overrides.isResolved ?? false,
    isOutdated: overrides.isOutdated ?? false,
    path: overrides.path ?? "src/a.ts",
    line: overrides.line === undefined ? 12 : overrides.line,
    startLine: overrides.startLine === undefined ? null : overrides.startLine,
    diffSide: overrides.diffSide ?? "RIGHT",
    startDiffSide: overrides.startDiffSide ?? null,
    subjectType: overrides.subjectType ?? "LINE",
    comments: {
      pageInfo: { hasNextPage: overrides.commentsHasNextPage ?? false },
      nodes: overrides.commentNodes ?? overrides.comments ?? [gqlComment()],
    },
  };
}

interface GqlReviewOverrides {
  readonly databaseId?: number | null;
  readonly rawFullDatabaseId?: string | null;
  readonly login?: string;
  readonly typename?: string;
  readonly state?: string;
  readonly body?: string;
  readonly submittedAt?: string | null;
}

export function gqlReview(overrides: GqlReviewOverrides = {}) {
  return {
    fullDatabaseId: fullId(
      overrides.databaseId,
      overrides.rawFullDatabaseId,
      500,
    ),
    author: {
      login: overrides.login ?? "alice",
      __typename: overrides.typename ?? "User",
      avatarUrl: `https://avatars.example/${overrides.login ?? "alice"}.png`,
    },
    state: overrides.state ?? "COMMENTED",
    body: overrides.body ?? "",
    submittedAt:
      overrides.submittedAt === undefined
        ? "2026-07-01T10:00:00Z"
        : overrides.submittedAt,
    url: "https://github.com/o/r/pull/7#pullrequestreview-500",
  };
}

interface GqlIssueCommentOverrides {
  readonly databaseId?: number;
  readonly login?: string;
  readonly typename?: string;
  readonly body?: string;
}

export function gqlIssueComment(overrides: GqlIssueCommentOverrides = {}) {
  return {
    fullDatabaseId: String(overrides.databaseId ?? 9001),
    author: {
      login: overrides.login ?? "carol",
      __typename: overrides.typename ?? "User",
      avatarUrl: `https://avatars.example/${overrides.login ?? "carol"}.png`,
    },
    body: overrides.body ?? "a PR-level remark",
    createdAt: "2026-07-02T09:00:00Z",
    url: "https://github.com/o/r/pull/7#issuecomment-9001",
  };
}

interface GqlResponseOverrides {
  readonly threads?: ReturnType<typeof gqlThread>[];
  readonly threadsHasNextPage?: boolean;
  readonly threadsEndCursor?: string | null;
  readonly reviews?: ReturnType<typeof gqlReview>[];
  readonly reviewsHasNextPage?: boolean;
  readonly issueComments?: ReturnType<typeof gqlIssueComment>[];
  readonly issueCommentsHasNextPage?: boolean;
}

export function conversationResponse(overrides: GqlResponseOverrides = {}) {
  return {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: {
            hasNextPage: overrides.threadsHasNextPage ?? false,
            endCursor: overrides.threadsEndCursor ?? null,
          },
          nodes: overrides.threads ?? [gqlThread()],
        },
        reviews: {
          pageInfo: { hasNextPage: overrides.reviewsHasNextPage ?? false },
          nodes: overrides.reviews ?? [gqlReview()],
        },
        comments: {
          pageInfo: {
            hasNextPage: overrides.issueCommentsHasNextPage ?? false,
          },
          nodes: overrides.issueComments ?? [gqlIssueComment()],
        },
      },
    },
  };
}
