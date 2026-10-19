// The live read's storage side: which rows are due for a read, what a read
// writes back, and how a url row GitHub stopped showing is marked. Either
// scope: an installation row is read as a backstop for a missed webhook.
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { traceStore } from "./trace-store";
import { type AppDatabase, internal } from "../db/handle";
import { pullRequest } from "../schema/pull-request";
import { resolveScope } from "./scope";
import { isOwnerContext, type ScopeContext } from "./scope-context";
import {
  buildLifecycleColumns,
  buildNextRowVersion,
  type PullRequestUpdateSet,
} from "./pull-request-upsert";
import type { PullRequestLifecycle, PullRequestRow } from "./tenant";
import type { PullRequestRowId, RepoId } from "../types";
import { PrStates } from "types/pull-requests";

/** What a paste or a live read stamps: when GitHub answered and which head it reported. */
export interface LiveReadStamp {
  readonly readAt: Date;
  readonly headSha: string;
}

/** Everything one live read writes back onto a row. */
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

/** What the row held when the read was planned. */
export interface LiveReadBaseline {
  readonly rowVersion: number;
}

export interface LiveReadDueInput {
  readonly now: Date;
  /** A row read within this window is not due. */
  readonly staleMs: number;
  readonly limit: number;
  /** Only rows in these repositories: the ones the reader's token can see. */
  readonly repoIds?: readonly RepoId[] | undefined;
}

export interface LiveReadStore {
  readonly ctx: ScopeContext;
  /**
   * The scope's rows due for a read, never-read rows first and then the
   * oldest read, capped at `limit`. A merged row is final and never due; a
   * closed url row is due because it can reopen, an installation row only
   * while open.
   */
  listDue(input: LiveReadDueInput): Promise<PullRequestRow[]>;
  /**
   * Write what GitHub reported and clear any unreachable mark. A row with a
   * newer `github_updated_at` or a later read, a merged row read as not
   * merged, or a closed row read as open at the same time keeps its facts
   * and only takes the read stamp, which never moves back. Webhooks own an
   * installation row's `github_updated_at`: the read never writes it, and
   * ties it only while the row is still at the `baseline` the read was
   * planned against. Each write returns `undefined` when the scope holds no
   * row with the id.
   */
  record(
    pullRequestId: PullRequestRowId,
    facts: LiveReadFacts,
    baseline?: LiveReadBaseline,
  ): Promise<PullRequestRow | undefined>;
  /**
   * GitHub gave no answer for the row this round: stamp the read so the row
   * waits the window like any other, and change nothing else.
   */
  stampAttempt(
    pullRequestId: PullRequestRowId,
    readAt: Date,
  ): Promise<PullRequestRow | undefined>;
  /**
   * GitHub no longer shows the row to the owner: stamp the read so the row
   * backs off, and keep the first sighting as the unreachable time.
   */
  markUnreachable(
    pullRequestId: PullRequestRowId,
    readAt: Date,
  ): Promise<PullRequestRow | undefined>;
}

/** A read stamp never moves back: two reads can land out of order. */
function keepLatestRead(readAt: Date): SQL {
  return sql`greatest(${pullRequest.githubReadAt}, ${readAt})`;
}

/** Facts from a read that started before the stored one are stale. */
function buildReadOrderGuard(readAt: Date): SQL | undefined {
  return or(
    isNull(pullRequest.githubReadAt),
    lte(pullRequest.githubReadAt, readAt),
  );
}

/**
 * Facts GitHub reported at an older time are stale. On an installation row a
 * webhook or the worker can write the read's own time while it is in flight,
 * so a read ties the stored time only while the row is unwritten since the
 * read was planned; a write that landed since wins the tie.
 */
function buildFreshnessGuard(
  ctx: ScopeContext,
  readTime: Date,
  baseline: LiveReadBaseline | undefined,
): SQL | undefined {
  const stored = pullRequest.githubUpdatedAt;
  if (isOwnerContext(ctx)) {
    return or(isNull(stored), lte(stored, readTime));
  }
  const newer = or(isNull(stored), lt(stored, readTime));
  if (baseline === undefined) {
    return newer;
  }
  const unwritten = eq(pullRequest.rowVersion, baseline.rowVersion);
  const unwrittenTie = and(eq(stored, readTime), unwritten);
  return or(newer, unwrittenTie);
}

/**
 * A merge is final, and a closed row reopens only on a strictly newer read:
 * equal timestamps do not order a snapshot against the webhook it raced.
 */
function buildLifecycleGuard(facts: LiveReadFacts): SQL | undefined {
  const { state } = facts.lifecycle;
  if (state === PrStates.MERGED) {
    return undefined;
  }
  const notMerged = ne(pullRequest.state, PrStates.MERGED);
  if (state !== PrStates.OPEN) {
    return notMerged;
  }
  const reopenOrdered = or(
    eq(pullRequest.state, PrStates.OPEN),
    isNull(pullRequest.githubUpdatedAt),
    lt(pullRequest.githubUpdatedAt, facts.githubUpdatedAt),
  );
  return and(notMerged, reopenOrdered);
}

export function createLiveReadStore(
  handle: AppDatabase,
  ctx: ScopeContext,
): LiveReadStore {
  const db = internal(handle);
  const scope = resolveScope(ctx);

  async function stampRead(
    pullRequestId: PullRequestRowId,
    readAt: Date,
  ): Promise<PullRequestRow | undefined> {
    const rows = await db
      .update(pullRequest)
      .set({
        githubReadAt: keepLatestRead(readAt),
        rowVersion: buildNextRowVersion(),
        updatedAt: new Date(),
      })
      .where(and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)))
      .returning();
    return rows[0];
  }

  return traceStore("liveRead", {
    ctx,

    async listDue({ now, staleMs, limit, repoIds }) {
      if (repoIds?.length === 0) {
        return [];
      }
      const dueBefore = new Date(now.getTime() - staleMs);
      const inRepos =
        repoIds === undefined
          ? undefined
          : inArray(pullRequest.repoId, [...repoIds]);
      // A url row is due until merged, since a closed one can reopen and no
      // webhook says so; an installation row only while open.
      const readableState = isOwnerContext(ctx)
        ? ne(pullRequest.state, PrStates.MERGED)
        : eq(pullRequest.state, PrStates.OPEN);
      return db
        .select()
        .from(pullRequest)
        .where(
          and(
            scope.matchesPullRequest(),
            inRepos,
            readableState,
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

    async record(pullRequestId, facts, baseline) {
      const set: PullRequestUpdateSet = {
        repoSlug: facts.repoSlug,
        title: facts.title,
        draft: facts.draft,
        githubHeadSha: facts.headSha,
        githubReadAt: facts.readAt,
        githubUnreachableAt: null,
        ...buildLifecycleColumns(facts.lifecycle),
        rowVersion: buildNextRowVersion(),
        updatedAt: new Date(),
      };
      if (facts.authorLogin !== undefined) {
        set.authorLogin = facts.authorLogin;
      }
      if (isOwnerContext(ctx)) {
        set.githubUpdatedAt = facts.githubUpdatedAt;
      }
      const fresh = buildFreshnessGuard(ctx, facts.githubUpdatedAt, baseline);
      const lifecycleOrdered = buildLifecycleGuard(facts);
      const readOrdered = buildReadOrderGuard(facts.readAt);
      const rows = await db
        .update(pullRequest)
        .set(set)
        .where(
          and(
            scope.matchesPullRequest(),
            eq(pullRequest.id, pullRequestId),
            fresh,
            lifecycleOrdered,
            readOrdered,
          ),
        )
        .returning();
      const recorded = rows[0];
      if (recorded !== undefined) {
        return recorded;
      }
      return stampRead(pullRequestId, facts.readAt);
    },

    stampAttempt: stampRead,

    async markUnreachable(pullRequestId, readAt) {
      const rows = await db
        .update(pullRequest)
        .set({
          githubReadAt: keepLatestRead(readAt),
          githubUnreachableAt: sql`coalesce(${pullRequest.githubUnreachableAt}, ${readAt})`,
          rowVersion: buildNextRowVersion(),
          updatedAt: new Date(),
        })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      return rows[0];
    },
  });
}
