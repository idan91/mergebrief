// The scope-bound repository, the ONLY database surface this package
// exposes. `createTenantRepository(db, ctx)` resolves its ctx once and every
// method filters or stamps through that one `RowScope`. INVARIANT: the DB
// does not tie a child row's scope to its parent `pull_request`'s, so every
// per-PR child WRITE stamps the scope's world mark and resolves the parent
// within the scope in the same transaction, and every READ filters on the
// queried table's own columns (`matchesChild` adds the owner world's PR
// semi-join), which is safe because writes guarantee the marks match.
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { type AppDatabase, internal } from "../db/handle";
import { deleteOrphanedGrants } from "../auth/grant";
import { checkpoint } from "../schema/checkpoint";
import { pullRequest } from "../schema/pull-request";
import { authSession } from "../schema/auth-session";
import {
  type ReviewSessionRepository,
  createReviewSessionRepository,
} from "./review-session";
import {
  createInboxArchiveStore,
  type InboxArchiveStore,
} from "./inbox-archive";
import { resolveScope } from "./scope";
import type { LiveReadStamp } from "./live-read";
import type { ScopeContext } from "./scope-context";
import type {
  GrantRowId,
  PullRequestRowId,
  ReviewerId,
  RepoId,
} from "../types";
import type { Result, ValueOf } from "types/utils";
import { PrStates, type PrState } from "types/pull-requests";

// ---------------------------------------------------------------------------
// Repository errors, expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const RepositoryErrorCodes = {
  /** A per-PR write named a `pull_request` that is not in ctx's tenant. */
  PARENT_NOT_IN_TENANT: "parent-not-in-tenant",
  /** A scoped mutation matched no row in ctx's tenant. */
  NOT_FOUND: "not-found",
} as const;
export type RepositoryErrorCode = ValueOf<typeof RepositoryErrorCodes>;

export interface RepositoryError {
  readonly code: RepositoryErrorCode;
  readonly message: string;
}

function fail(
  code: RepositoryErrorCode,
  message: string,
): Result<never, RepositoryError> {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Row + input shapes.
// ---------------------------------------------------------------------------

export type PullRequestRow = typeof pullRequest.$inferSelect;
export type CheckpointRow = typeof checkpoint.$inferSelect;
export type AuthSessionRow = typeof authSession.$inferSelect;

/**
 * Lifecycle trio, discriminated on `state` so the type system forbids stale
 * retention fields: an OPEN patch must explicitly null `closed_at` and
 * `purge_after` (a reopened PR must never stay armed for the sweep), and a
 * terminal patch must carry `closedAt`. `purgeAfter` stays caller-supplied
 * here; grace math lives in `createPurgeRoutines.setRetention`.
 */
interface OpenLifecycle {
  readonly state: typeof PrStates.OPEN;
  /** Optional-but-null-only: a Date cannot be smuggled onto an open PR. */
  readonly closedAt?: null;
  readonly purgeAfter?: null;
}

interface TerminalLifecycle {
  readonly state: typeof PrStates.CLOSED | typeof PrStates.MERGED;
  readonly closedAt: Date;
  readonly purgeAfter: Date | null;
}

export type PullRequestLifecycle = OpenLifecycle | TerminalLifecycle;

interface BasePullRequestUpsertInput {
  readonly repoId: RepoId;
  readonly prNumber: number;
  readonly repoSlug?: string;
  /** Purgeable display label, refreshed on every webhook. */
  readonly title?: string;
  /**
   * PR-base SHA, refreshed by `pull_request` events. Optional because
   * `pull_request_review` payloads don't carry it, an omitted value
   * preserves the stored one instead of nulling it.
   */
  readonly baseSha?: string;
  /**
   * Whether the PR is a GitHub draft. Optional because `pull_request_review`
   * payloads don't carry it, an omitted value preserves the stored one (and
   * the column's `false` default on first insert) instead of forcing it false.
   */
  readonly draft?: boolean;
  /**
   * PR author login, refreshed by `pull_request` events. Optional for the same
   * reason as `baseSha`: review payloads (and deleted authors) omit it, and an
   * omitted value preserves the stored one.
   */
  readonly authorLogin?: string;
  /**
   * GitHub's `pull_request.updated_at`. Review events and pastes carry none;
   * with one, the ingest upsert applies only when it is not older than the
   * stored value.
   */
  readonly githubUpdatedAt?: Date;
  /**
   * A paste is a live read: stamp when GitHub answered and the head it
   * reported, and clear any unreachable mark. Webhook events carry none.
   */
  readonly liveRead?: LiveReadStamp;
}

export type PullRequestUpsertInput = BasePullRequestUpsertInput &
  PullRequestLifecycle;

export type PullRequestStatePatch = PullRequestLifecycle;

/** The stack a resolve produced and when; the caller never passes a null stack. */
export interface PullRequestStackInput {
  readonly stack: unknown;
  readonly readAt: Date;
}

/**
 * Normalize a lifecycle to explicit column values from the discriminant:
 * OPEN always writes NULLs (drizzle skips `undefined`, and a reopened PR
 * must disarm the retention sweep), terminal states write what they carry.
 * Exported for IN-PACKAGE reuse only (`ingest.ts` replicates the upsert
 * inside its transaction); `index.ts` never re-exports it.
 */
/**
 * The columns an upsert's conflict branch may name, drizzle's own update
 * shape, so a column may take a value or a SQL expression. Partial by design:
 * a key left off is a column drizzle does not touch, which is how an omitted
 * input field preserves the stored value.
 */
export type PullRequestUpdateSet = PgUpdateSetSource<typeof pullRequest>;

/** The three live-read columns a stamp writes; the unreachable mark clears. */
export function buildLiveReadColumns(stamp: LiveReadStamp): {
  githubReadAt: Date;
  githubHeadSha: string;
  githubUnreachableAt: null;
} {
  return {
    githubReadAt: stamp.readAt,
    githubHeadSha: stamp.headSha,
    githubUnreachableAt: null,
  };
}

export function buildLifecycleColumns(lc: PullRequestLifecycle): {
  state: PrState;
  closedAt: Date | null;
  purgeAfter: Date | null;
} {
  if (lc.state === PrStates.OPEN) {
    return { state: lc.state, closedAt: null, purgeAfter: null };
  }
  return { state: lc.state, closedAt: lc.closedAt, purgeAfter: lc.purgeAfter };
}

export interface CheckpointSubmitInput {
  readonly pullRequestId: PullRequestRowId;
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin?: string;
  readonly lastSubmittedSha: string;
  readonly submittedAt: Date;
}

export interface SessionCreateInput {
  readonly sessionTokenHash: string;
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin?: string;
  /** The GitHub credential pair lives on the grant row, link, never copy. */
  readonly grantId: GrantRowId;
  readonly expiresAt: Date;
}

// ---------------------------------------------------------------------------
// The repository surface.
// ---------------------------------------------------------------------------

export interface PullRequestRepository {
  /**
   * Idempotent natural-key upsert. The ordering guard on `githubUpdatedAt`
   * lives in the ingest routines, which every webhook write goes through.
   */
  upsert(input: PullRequestUpsertInput): Promise<PullRequestRow>;
  /**
   * Record GitHub's `updated_at` as the worker read it at generate time; a
   * value older than the stored one is left alone. The one write a
   * generation makes to the row's GitHub facts.
   */
  advanceGithubUpdatedAt(
    pullRequestId: PullRequestRowId,
    githubUpdatedAt: Date,
  ): Promise<Result<PullRequestRow, RepositoryError>>;
  /** Tenant-scoped read by (repo, number). Absence is a normal `undefined`. */
  getByNumber(
    repoId: RepoId,
    prNumber: number,
  ): Promise<PullRequestRow | undefined>;
  /**
   * The tenant's PRs across an ALLOWED repo set (the viewer's GitHub-derived
   * installation∩user intersection), newest `updated_at` first,
   * capped at `limit`. An empty allowed set returns no rows (fail closed) -
   * the caller must never fall back to an unfiltered tenant listing.
   */
  listForRepos(
    repoIds: readonly RepoId[],
    limit: number,
  ): Promise<PullRequestRow[]>;
  /** Tenant-scoped read by row id (the worker's job-payload entry point). */
  getById(pullRequestId: PullRequestRowId): Promise<PullRequestRow | undefined>;
  /**
   * The OWNER world's rows, newest `updated_at` first, capped at `limit` -
   * the "your briefs" home list. Owner scope only: the installation world's
   * listing is `listForRepos` over the fail-closed allowed set, and an
   * unfiltered tenant listing must not exist.
   */
  listOwned(limit: number): Promise<PullRequestRow[]>;
  /** Scoped lifecycle mutation; `notFound` if no row in ctx's tenant. */
  setState(
    pullRequestId: PullRequestRowId,
    patch: PullRequestStatePatch,
  ): Promise<Result<PullRequestRow, RepositoryError>>;
  /**
   * Store/rotate the Entry comment id after a delete+repost cycle. A plain
   * GitHub comment id (no branded type); `notFound` if no row in ctx's tenant.
   */
  setEntryComment(
    pullRequestId: PullRequestRowId,
    /** `null` clears the stored id (entry comment deleted). */
    entryCommentId: bigint | null,
  ): Promise<Result<PullRequestRow, RepositoryError>>;
  /**
   * Flip the local `draft` mirror after a mark-ready mutation. A NARROW,
   * tenant-scoped update by row id, the caller already resolved the
   * row via `getByNumber`, so this never reconstructs the lifecycle (unlike
   * `recordState`, which is a full webhook upsert). Idempotent: re-running with
   * the same value is a no-op write. `notFound` if no row in ctx's tenant (a
   * PR deleted mid-request); the later `ready_for_review` webhook reconciles.
   */
  setDraft(
    pullRequestId: PullRequestRowId,
    draft: boolean,
  ): Promise<Result<PullRequestRow, RepositoryError>>;
  /**
   * Overwrite the last stack GitHub resolved for the row and its read time.
   * Callers write only a non-null resolve: a null one after every neighbour
   * merged would erase the history this column exists to keep.
   */
  recordStack(
    pullRequestId: PullRequestRowId,
    input: PullRequestStackInput,
  ): Promise<Result<PullRequestRow, RepositoryError>>;
}

export interface CheckpointRepository {
  /**
   * Idempotent, monotonic upsert of a reviewer's checkpoint -
   * newest-submission-wins: an input whose `submittedAt` is older than the
   * stored row's leaves the row untouched and returns the CURRENT row
   * (out-of-order webhook deliveries are a success, not an error).
   * Verifies the parent `pull_request` belongs to ctx (invariant (a));
   * returns `parentNotInTenant` without writing when it does not.
   */
  upsertOnSubmit(
    input: CheckpointSubmitInput,
  ): Promise<Result<CheckpointRow, RepositoryError>>;
  /** Tenant-scoped read; absence is a normal `undefined`. */
  get(
    pullRequestId: PullRequestRowId,
    reviewerId: ReviewerId,
  ): Promise<CheckpointRow | undefined>;
  /**
   * All checkpoints on a PR, the worker derives the DISTINCT checkpoint SHAs
   * to pre-warm delta cores for.
   */
  listForPullRequest(pullRequestId: PullRequestRowId): Promise<CheckpointRow[]>;
}

/**
 * A session holds no installation: it belongs to its reviewer. The owner
 * world narrows every method to the owner's own sessions; an installation
 * scope has nothing to narrow by and addresses them all.
 */
export interface SessionRepository {
  /** Insert. `auth_session` has no PR parent and no tenant stamp. */
  create(input: SessionCreateInput): Promise<AuthSessionRow>;
  /** Read by token hash; absence is a normal `undefined`. */
  getByTokenHash(sessionTokenHash: string): Promise<AuthSessionRow | undefined>;
  /** TTL sweep; returns the number deleted. */
  deleteExpired(now: Date): Promise<number>;
  /** Logout / reviewer offboarding; returns number deleted. */
  deleteByReviewer(reviewerId: ReviewerId): Promise<number>;
}

export interface TenantRepository {
  readonly ctx: ScopeContext;
  readonly pullRequests: PullRequestRepository;
  readonly checkpoints: CheckpointRepository;
  readonly sessions: SessionRepository;
  /** The reviewer's own archive of Inbox rows, see `stores/inbox-archive.ts`. */
  readonly archives: InboxArchiveStore;
  /** The reviewer's Review Session work, see `stores/review-session.ts`. */
  readonly reviewSessions: ReviewSessionRepository;
}

/**
 * Build a scope-bound repository over an opaque `AppDatabase`. `ctx` is the
 * one place a scope identity enters; no method accepts another.
 */
export function createTenantRepository(
  handle: AppDatabase,
  ctx: ScopeContext,
): TenantRepository {
  const db = internal(handle);
  const scope = resolveScope(ctx);

  const pullRequests: PullRequestRepository = {
    async upsert(input) {
      const lifecycle = buildLifecycleColumns(input);
      const set: PullRequestUpdateSet = {
        repoSlug: input.repoSlug,
        title: input.title,
        ...lifecycle,
        updatedAt: new Date(),
      };
      // Omitted (review events) preserves the stored value, drizzle skips an
      // absent key, so the column is only ever named when the input carries it.
      if (input.baseSha !== undefined) {
        set.baseSha = input.baseSha;
      }
      if (input.draft !== undefined) {
        set.draft = input.draft;
      }
      if (input.authorLogin !== undefined) {
        set.authorLogin = input.authorLogin;
      }
      if (input.githubUpdatedAt !== undefined) {
        set.githubUpdatedAt = input.githubUpdatedAt;
      }
      if (input.liveRead !== undefined) {
        Object.assign(set, buildLiveReadColumns(input.liveRead));
      }
      const insert = db.insert(pullRequest).values({
        installationId: scope.installationId,
        ownerUserId: scope.ownerUserId,
        source: scope.source,
        repoId: input.repoId,
        prNumber: input.prNumber,
        repoSlug: input.repoSlug,
        title: input.title,
        baseSha: input.baseSha,
        draft: input.draft,
        authorLogin: input.authorLogin,
        githubUpdatedAt: input.githubUpdatedAt,
        githubReadAt: input.liveRead?.readAt,
        githubHeadSha: input.liveRead?.headSha,
        ...lifecycle,
        updatedAt: new Date(),
      });
      // Each world conflicts on ITS natural key: the tenant unique constraint,
      // or the owner partial index (targetWhere must mirror its predicate).
      const rows =
        scope.ownerUserId === null
          ? await insert
              .onConflictDoUpdate({
                target: [
                  pullRequest.installationId,
                  pullRequest.repoId,
                  pullRequest.prNumber,
                ],
                set,
              })
              .returning()
          : await insert
              .onConflictDoUpdate({
                target: [
                  pullRequest.ownerUserId,
                  pullRequest.repoId,
                  pullRequest.prNumber,
                ],
                targetWhere: sql`${pullRequest.installationId} is null`,
                set,
              })
              .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error("pull_request upsert returned no row");
      }
      return row;
    },

    async getByNumber(repoId, prNumber) {
      const rows = await db
        .select()
        .from(pullRequest)
        .where(
          and(
            scope.matchesPullRequest(),
            eq(pullRequest.repoId, repoId),
            eq(pullRequest.prNumber, prNumber),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async listForRepos(repoIds, limit) {
      // `inArray` with an empty list is invalid SQL, and an empty ALLOWED set
      // must return nothing, never "everything" (fail closed).
      if (repoIds.length === 0) {
        return [];
      }
      return db
        .select()
        .from(pullRequest)
        .where(
          and(
            scope.matchesPullRequest(),
            inArray(pullRequest.repoId, [...repoIds]),
          ),
        )
        .orderBy(desc(pullRequest.updatedAt), desc(pullRequest.id))
        .limit(limit);
    },

    async listOwned(limit) {
      if (scope.ownerUserId === null) {
        // Programmer error: see the interface note.
        throw new Error("listOwned is an owner-scope surface");
      }
      return db
        .select()
        .from(pullRequest)
        .where(scope.matchesPullRequest())
        .orderBy(desc(pullRequest.updatedAt), desc(pullRequest.id))
        .limit(limit);
    },

    async getById(pullRequestId) {
      const rows = await db
        .select()
        .from(pullRequest)
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .limit(1);
      return rows[0];
    },

    async advanceGithubUpdatedAt(pullRequestId, githubUpdatedAt) {
      // A held stamp is a no-op for the row: its own updated_at, which the
      // pulls list sorts by, moves only when the GitHub time does.
      const advances = sql`${pullRequest.githubUpdatedAt} is null or ${pullRequest.githubUpdatedAt} < ${githubUpdatedAt}`;
      const rows = await db
        .update(pullRequest)
        .set({
          githubUpdatedAt: sql`greatest(${pullRequest.githubUpdatedAt}, ${githubUpdatedAt})`,
          updatedAt: sql`case when ${advances} then now() else ${pullRequest.updatedAt} end`,
        })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) {
        return fail(
          RepositoryErrorCodes.NOT_FOUND,
          `pull_request ${pullRequestId} not found in ${scope.label}`,
        );
      }
      return { ok: true, value: row };
    },

    async setState(pullRequestId, patch) {
      const rows = await db
        .update(pullRequest)
        .set({
          ...buildLifecycleColumns(patch),
          updatedAt: new Date(),
        })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) {
        return fail(
          RepositoryErrorCodes.NOT_FOUND,
          `pull_request ${pullRequestId} not found in ${scope.label}`,
        );
      }
      return { ok: true, value: row };
    },

    async setEntryComment(pullRequestId, entryCommentId) {
      const rows = await db
        .update(pullRequest)
        .set({ entryCommentId, updatedAt: new Date() })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) {
        return fail(
          RepositoryErrorCodes.NOT_FOUND,
          `pull_request ${pullRequestId} not found in ${scope.label}`,
        );
      }
      return { ok: true, value: row };
    },

    async setDraft(pullRequestId, draft) {
      const rows = await db
        .update(pullRequest)
        .set({ draft, updatedAt: new Date() })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) {
        return fail(
          RepositoryErrorCodes.NOT_FOUND,
          `pull_request ${pullRequestId} not found in ${scope.label}`,
        );
      }
      return { ok: true, value: row };
    },

    async recordStack(pullRequestId, input) {
      const rows = await db
        .update(pullRequest)
        .set({
          stack: input.stack,
          stackReadAt: input.readAt,
          updatedAt: new Date(),
        })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) {
        return fail(
          RepositoryErrorCodes.NOT_FOUND,
          `pull_request ${pullRequestId} not found in ${scope.label}`,
        );
      }
      return { ok: true, value: row };
    },
  };

  const checkpoints: CheckpointRepository = {
    async upsertOnSubmit(input) {
      return db.transaction(async (tx) => {
        // Invariant (a): resolve the parent within ctx's scope BEFORE writing.
        const parents = await tx
          .select({ id: pullRequest.id })
          .from(pullRequest)
          .where(
            and(
              scope.matchesPullRequest(),
              eq(pullRequest.id, input.pullRequestId),
            ),
          )
          .limit(1);
        if (parents[0] === undefined) {
          // Nothing written; the (empty) tx commits cleanly.
          return fail(
            RepositoryErrorCodes.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in ${scope.label}`,
          );
        }
        const rows = await tx
          .insert(checkpoint)
          .values({
            installationId: scope.installationId,
            pullRequestId: input.pullRequestId,
            reviewerId: input.reviewerId,
            reviewerLogin: input.reviewerLogin,
            lastSubmittedSha: input.lastSubmittedSha,
            submittedAt: input.submittedAt,
          })
          .onConflictDoUpdate({
            target: [
              checkpoint.installationId,
              checkpoint.pullRequestId,
              checkpoint.reviewerId,
            ],
            set: {
              reviewerLogin: input.reviewerLogin,
              lastSubmittedSha: input.lastSubmittedSha,
              submittedAt: input.submittedAt,
            },
            // Newest-submission-wins: an out-of-order delivery (older
            // submitted_at) must never regress the row; equality re-applies,
            // keeping redeliveries idempotent.
            setWhere: sql`${checkpoint.submittedAt} <= excluded.submitted_at`,
          })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          // The conflict update was suppressed by the monotonic guard, the
          // stored row is newer. Return the current state (a stale delivery
          // is a success, not an error).
          const current = await tx
            .select()
            .from(checkpoint)
            .where(
              and(
                scope.matchesChild(
                  checkpoint.installationId,
                  checkpoint.pullRequestId,
                ),
                eq(checkpoint.pullRequestId, input.pullRequestId),
                eq(checkpoint.reviewerId, input.reviewerId),
              ),
            )
            .limit(1);
          const existing = current[0];
          if (existing === undefined) {
            throw new Error("checkpoint upsert returned no row");
          }
          return { ok: true, value: existing };
        }
        return { ok: true, value: row };
      });
    },

    async get(pullRequestId, reviewerId) {
      const rows = await db
        .select()
        .from(checkpoint)
        .where(
          and(
            scope.matchesChild(
              checkpoint.installationId,
              checkpoint.pullRequestId,
            ),
            eq(checkpoint.pullRequestId, pullRequestId),
            eq(checkpoint.reviewerId, reviewerId),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async listForPullRequest(pullRequestId) {
      return db
        .select()
        .from(checkpoint)
        .where(
          and(
            scope.matchesChild(
              checkpoint.installationId,
              checkpoint.pullRequestId,
            ),
            eq(checkpoint.pullRequestId, pullRequestId),
          ),
        );
    },
  };

  const sessions: SessionRepository = {
    async create(input) {
      const rows = await db
        .insert(authSession)
        .values({
          sessionTokenHash: input.sessionTokenHash,
          reviewerId: input.reviewerId,
          reviewerLogin: input.reviewerLogin,
          grantId: input.grantId,
          expiresAt: input.expiresAt,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error("auth_session insert returned no row");
      }
      return row;
    },

    async getByTokenHash(sessionTokenHash) {
      const conditions = [eq(authSession.sessionTokenHash, sessionTokenHash)];
      if (scope.ownerUserId !== null) {
        conditions.push(eq(authSession.reviewerId, scope.ownerUserId));
      }
      const rows = await db
        .select()
        .from(authSession)
        .where(and(...conditions))
        .limit(1);
      return rows[0];
    },

    async deleteExpired(now) {
      // Orphan-clean the grants of the deleted sessions, same tx.
      const conditions = [lt(authSession.expiresAt, now)];
      if (scope.ownerUserId !== null) {
        conditions.push(eq(authSession.reviewerId, scope.ownerUserId));
      }
      return db.transaction(async (tx) => {
        const rows = await tx
          .delete(authSession)
          .where(and(...conditions))
          .returning({ grantId: authSession.grantId });
        await deleteOrphanedGrants(
          tx,
          rows.map((row) => row.grantId),
        );
        return rows.length;
      });
    },

    async deleteByReviewer(reviewerId) {
      // Owner world: only the owner's own sessions are addressable, a
      // foreign reviewer id is a no-op, never a cross-owner delete.
      if (scope.ownerUserId !== null && reviewerId !== scope.ownerUserId) {
        return 0;
      }
      // Orphan-clean the grants of the deleted sessions, same tx.
      return db.transaction(async (tx) => {
        const rows = await tx
          .delete(authSession)
          .where(eq(authSession.reviewerId, reviewerId))
          .returning({ grantId: authSession.grantId });
        await deleteOrphanedGrants(
          tx,
          rows.map((row) => row.grantId),
        );
        return rows.length;
      });
    },
  };

  return {
    ctx,
    pullRequests,
    checkpoints,
    sessions,
    archives: createInboxArchiveStore(handle, ctx),
    reviewSessions: createReviewSessionRepository(db, scope),
  };
}
