// The live read's storage side for url rows: which rows are due for a read,
// what a read writes back, and how a row GitHub stopped showing is marked.
// Owner scope only: installation rows are kept current by webhooks.
import { and, asc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { type AppDatabase, internal } from "../db/handle";
import { pullRequest } from "../schema/pull-request";
import { resolveScope } from "./scope";
import type { OwnerContext } from "./scope-context";
import {
  buildLifecycleColumns,
  RepositoryErrorCodes,
  type PullRequestLifecycle,
  type PullRequestRow,
  type PullRequestUpdateSet,
  type RepositoryError,
} from "./tenant";
import type { PullRequestRowId } from "../types";
import type { Result } from "types/utils";
import { PrStates } from "types/pull-requests";

/** What a paste or a live read stamps: when GitHub answered and which head it reported. */
export interface LiveReadStamp {
  readonly readAt: Date;
  readonly headSha: string;
}

/** Everything one live read writes back onto a url row. */
export interface LiveReadFacts extends LiveReadStamp {
  /** The repository's current `owner/name`, refreshing the stored label. */
  readonly repoSlug: string;
  readonly title: string;
  readonly draft: boolean;
  readonly githubUpdatedAt: Date;
  /** Applied as read: a live open beats a stored closed. */
  readonly lifecycle: PullRequestLifecycle;
  /** Absent when the account is gone; the stored login then stays. */
  readonly authorLogin?: string;
}

export interface LiveReadDueInput {
  readonly now: Date;
  /** A row read within this window is not due. */
  readonly staleMs: number;
  readonly limit: number;
}

export interface LiveReadStore {
  readonly ctx: OwnerContext;
  /**
   * The owner's url rows due for a read, never-read rows first and then the
   * oldest read, capped at `limit`. A merged row is final and never due; a
   * closed one is due because it can reopen.
   */
  listDue(input: LiveReadDueInput): Promise<PullRequestRow[]>;
  /** Write what GitHub reported and clear any unreachable mark. */
  record(
    pullRequestId: PullRequestRowId,
    facts: LiveReadFacts,
  ): Promise<Result<PullRequestRow, RepositoryError>>;
  /**
   * GitHub no longer shows the row to the owner: stamp the read so the row
   * backs off, and keep the first sighting as the unreachable time.
   */
  /**
   * GitHub gave no answer for the row this round: stamp the read so the row
   * waits the window like any other, and change nothing else.
   */
  stampAttempt(
    pullRequestId: PullRequestRowId,
    readAt: Date,
  ): Promise<Result<PullRequestRow, RepositoryError>>;
  markUnreachable(
    pullRequestId: PullRequestRowId,
    readAt: Date,
  ): Promise<Result<PullRequestRow, RepositoryError>>;
}

function refuseNotFound(
  pullRequestId: PullRequestRowId,
  label: string,
): Result<never, RepositoryError> {
  return {
    ok: false,
    error: {
      code: RepositoryErrorCodes.NOT_FOUND,
      message: `pull_request ${pullRequestId} not found in ${label}`,
    },
  };
}

export function createLiveReadStore(
  handle: AppDatabase,
  ctx: OwnerContext,
): LiveReadStore {
  const db = internal(handle);
  const scope = resolveScope(ctx);

  return {
    ctx,

    async listDue({ now, staleMs, limit }) {
      const dueBefore = new Date(now.getTime() - staleMs);
      return db
        .select()
        .from(pullRequest)
        .where(
          and(
            scope.matchesPullRequest(),
            ne(pullRequest.state, PrStates.MERGED),
            or(
              isNull(pullRequest.githubReadAt),
              lt(pullRequest.githubReadAt, dueBefore),
            ),
          ),
        )
        .orderBy(
          sql`${pullRequest.githubReadAt} asc nulls first`,
          asc(pullRequest.id),
        )
        .limit(limit);
    },

    async record(pullRequestId, facts) {
      const set: PullRequestUpdateSet = {
        repoSlug: facts.repoSlug,
        title: facts.title,
        draft: facts.draft,
        githubUpdatedAt: facts.githubUpdatedAt,
        githubHeadSha: facts.headSha,
        githubReadAt: facts.readAt,
        githubUnreachableAt: null,
        ...buildLifecycleColumns(facts.lifecycle),
        updatedAt: new Date(),
      };
      if (facts.authorLogin !== undefined) set.authorLogin = facts.authorLogin;
      const rows = await db
        .update(pullRequest)
        .set(set)
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) return refuseNotFound(pullRequestId, scope.label);
      return { ok: true, value: row };
    },

    async stampAttempt(pullRequestId, readAt) {
      const rows = await db
        .update(pullRequest)
        .set({ githubReadAt: readAt, updatedAt: new Date() })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) return refuseNotFound(pullRequestId, scope.label);
      return { ok: true, value: row };
    },

    async markUnreachable(pullRequestId, readAt) {
      const rows = await db
        .update(pullRequest)
        .set({
          githubReadAt: readAt,
          githubUnreachableAt: sql`coalesce(${pullRequest.githubUnreachableAt}, ${readAt})`,
          updatedAt: new Date(),
        })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) return refuseNotFound(pullRequestId, scope.label);
      return { ok: true, value: row };
    },
  };
}
