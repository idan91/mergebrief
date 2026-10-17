// The scope-bound repository, the ONLY database surface this package
// exposes. `createTenantRepository(db, ctx)` resolves its ctx once and every
// method filters or stamps through that one `RowScope`. INVARIANT: the DB
// does not tie a child row's scope to its parent `pull_request`'s, so every
// per-PR child WRITE stamps the scope's world mark and resolves the parent
// within the scope in the same transaction, and every READ filters on the
// queried table's own columns (`matchesChild` adds the owner world's PR
// semi-join), which is safe because writes guarantee the marks match.
import { and, eq, sql } from "drizzle-orm";
import { type AppDatabase, internal } from "../db/handle";
import { checkpoint } from "../schema/checkpoint";
import { pullRequest } from "../schema/pull-request";
import {
  type ReviewSessionRepository,
  createReviewSessionRepository,
} from "./review-session";
import {
  createInboxArchiveStore,
  type InboxArchiveStore,
} from "./inbox-archive";
import { upsertPullRequestRow } from "./pull-request-upsert";
import { resolveScope, ScopeViolationError } from "./scope";
import type { LiveReadStamp } from "./live-read";
import type { ScopeContext } from "./scope-context";
import type { PullRequestRowId, ReviewerId, RepoId } from "../types";
import type { PrStates } from "types/pull-requests";

// ---------------------------------------------------------------------------
// Row + input shapes.
// ---------------------------------------------------------------------------

export type PullRequestRow = typeof pullRequest.$inferSelect;
export type CheckpointRow = typeof checkpoint.$inferSelect;

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

/** The stack a resolve produced and when; the caller never passes a null stack. */
export interface PullRequestStackInput {
  readonly stack: unknown;
  readonly readAt: Date;
}

export interface CheckpointSubmitInput {
  readonly pullRequestId: PullRequestRowId;
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin?: string;
  readonly lastSubmittedSha: string;
  readonly submittedAt: Date;
}

// ---------------------------------------------------------------------------
// The repository surface.
// ---------------------------------------------------------------------------

export interface PullRequestRepository {
  /**
   * Idempotent natural-key upsert: an input carrying `githubUpdatedAt` older
   * than the stored one leaves the row as stored and returns it.
   */
  upsert(input: PullRequestUpsertInput): Promise<PullRequestRow>;
  /**
   * Record GitHub's `updated_at` as the worker read it at generate time; a
   * value older than the stored one is left alone. The one write a
   * generation makes to the row's GitHub facts. `undefined` when no row in
   * ctx's scope has the id.
   */
  advanceGithubUpdatedAt(
    pullRequestId: PullRequestRowId,
    githubUpdatedAt: Date,
  ): Promise<PullRequestRow | undefined>;
  /** Tenant-scoped read by (repo, number). Absence is a normal `undefined`. */
  getByNumber(
    repoId: RepoId,
    prNumber: number,
  ): Promise<PullRequestRow | undefined>;
  /** Tenant-scoped read by row id (the worker's job-payload entry point). */
  getById(pullRequestId: PullRequestRowId): Promise<PullRequestRow | undefined>;
  /**
   * Store/rotate the Entry comment id after a delete+repost cycle. A plain
   * GitHub comment id (no branded type); `undefined` if no row in ctx's scope.
   */
  setEntryComment(
    pullRequestId: PullRequestRowId,
    /** `null` clears the stored id (entry comment deleted). */
    entryCommentId: bigint | null,
  ): Promise<PullRequestRow | undefined>;
  /**
   * Flip the local `draft` mirror after a mark-ready mutation. A NARROW,
   * tenant-scoped update by row id, the caller already resolved the
   * row via `getByNumber`, so this never reconstructs the lifecycle (unlike
   * `recordState`, which is a full webhook upsert). Idempotent: re-running with
   * the same value is a no-op write. `undefined` if no row in ctx's scope (a
   * PR deleted mid-request); the later `ready_for_review` webhook reconciles.
   */
  setDraft(
    pullRequestId: PullRequestRowId,
    draft: boolean,
  ): Promise<PullRequestRow | undefined>;
  /**
   * Overwrite the last stack GitHub resolved for the row and its read time.
   * Callers write only a non-null resolve: a null one after every neighbour
   * merged would erase the history this column exists to keep. `undefined`
   * if no row in ctx's scope.
   */
  recordStack(
    pullRequestId: PullRequestRowId,
    input: PullRequestStackInput,
  ): Promise<PullRequestRow | undefined>;
}

export interface CheckpointRepository {
  /**
   * Idempotent, monotonic upsert of a reviewer's checkpoint -
   * newest-submission-wins: an input whose `submittedAt` is older than the
   * stored row's leaves the row untouched and returns the CURRENT row
   * (out-of-order webhook deliveries are a success, not an error).
   * Verifies the parent `pull_request` belongs to ctx (invariant (a));
   * throws `ScopeViolationError` without writing when it does not.
   */
  upsertOnSubmit(input: CheckpointSubmitInput): Promise<CheckpointRow>;
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

export interface TenantRepository {
  readonly ctx: ScopeContext;
  readonly pullRequests: PullRequestRepository;
  readonly checkpoints: CheckpointRepository;
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
      const upserted = await upsertPullRequestRow(db, scope, input, false);
      return upserted.row;
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
      return rows[0];
    },

    async setEntryComment(pullRequestId, entryCommentId) {
      const rows = await db
        .update(pullRequest)
        .set({ entryCommentId, updatedAt: new Date() })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      return rows[0];
    },

    async setDraft(pullRequestId, draft) {
      const rows = await db
        .update(pullRequest)
        .set({ draft, updatedAt: new Date() })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      return rows[0];
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
      return rows[0];
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
          throw new ScopeViolationError(
            "pull_request",
            input.pullRequestId,
            scope.label,
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
          return existing;
        }
        return row;
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

  return {
    ctx,
    pullRequests,
    checkpoints,
    archives: createInboxArchiveStore(handle, ctx),
    reviewSessions: createReviewSessionRepository(db, scope),
  };
}
