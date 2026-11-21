// The scope-bound repository, the ONLY database surface this package
// exposes. `createTenantRepository(db, ctx)` resolves its ctx once and every
// method filters or stamps through that one `RowScope`. INVARIANT: the DB
// does not tie a child row's scope to its parent `pull_request`'s, so every
// per-PR child WRITE stamps the scope's world mark and resolves the parent
// within the scope in the same transaction, and every READ filters on the
// queried table's own columns (`matchesChild` adds the owner world's PR
// semi-join), which is safe because writes guarantee the marks match.
import { and, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { traceStore } from "./trace-store";
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
import {
  buildNextRowVersion,
  upsertPullRequestRow,
} from "./pull-request-upsert";
import { resolveScope, ScopeViolationError, type RowScope } from "./scope";
import type { LiveReadStamp } from "./live-read";
import type { ScopeContext } from "./scope-context";
import {
  EntryCommentSwapErrorCodes,
  type PullRequestRowId,
  type ReviewerId,
  type RepoId,
} from "../types";
import type { PrStates } from "types/pull-requests";
import type { Result } from "types/utils";

// ---------------------------------------------------------------------------
// Row + input shapes.
// ---------------------------------------------------------------------------

export type PullRequestRow = typeof pullRequest.$inferSelect;
export type CheckpointRow = typeof checkpoint.$inferSelect;

/** Another writer swapped first; the row holds `entryCommentId` now. */
export interface EntryCommentSwapLost {
  readonly code: typeof EntryCommentSwapErrorCodes.SWAP_LOST;
  readonly entryCommentId: bigint | null;
}

export interface EntryCommentSwapNotFound {
  readonly code: typeof EntryCommentSwapErrorCodes.NOT_FOUND;
}

export type EntryCommentSwapError =
  | EntryCommentSwapLost
  | EntryCommentSwapNotFound;

/**
 * Lifecycle pair, discriminated on `state` so the type system forbids a stale
 * close time: an OPEN patch must null `closed_at` (a reopened PR must never
 * stay visible to the retention sweep), and a terminal patch must carry it.
 */
interface OpenLifecycle {
  readonly state: typeof PrStates.OPEN;
  /** Optional-but-null-only: a Date cannot be smuggled onto an open PR. */
  readonly closedAt?: null;
}

interface TerminalLifecycle {
  readonly state: typeof PrStates.CLOSED | typeof PrStates.MERGED;
  readonly closedAt: Date;
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
  /** GitHub's `pull_request.created_at`; an omitted value preserves the stored one. */
  readonly githubCreatedAt?: Date;
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
   * Compare-and-set the Entry comment id: `next` is written only while the
   * row still holds `seen`, so of two runs that both posted, one id is
   * stored. A plain GitHub comment id (no branded type); `null` means none.
   * A row holding another id refuses with `swap-lost` and the id it holds;
   * no row in ctx's scope refuses with `not-found`.
   */
  swapEntryComment(
    pullRequestId: PullRequestRowId,
    swap: { readonly seen: bigint | null; readonly next: bigint | null },
  ): Promise<Result<PullRequestRow, EntryCommentSwapError>>;
  /**
   * Flip the local `draft` mirror after a mark-ready mutation: a narrow
   * update by row id, never the lifecycle (`recordState` is the webhook's full
   * upsert). Idempotent. `githubUpdatedAt` is GitHub's time for the flip: a
   * row a webhook already stamped later keeps its draft and is returned as it
   * stands, and the mirror never writes `github_updated_at`, which webhooks
   * own. `undefined` if no row in ctx's scope (a PR deleted mid-request); the
   * later `ready_for_review` webhook reconciles.
   */
  setDraft(
    pullRequestId: PullRequestRowId,
    draft: boolean,
    githubUpdatedAt: Date,
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
  /**
   * Turn off generating on every push. A head released while it was on
   * keeps its Generate stamp and skips the conditions; any other head,
   * queued or pushed later, faces them when it runs. A row already off
   * writes nothing, `row_version` included, and is returned as it is.
   * `undefined` if no row in ctx's scope. Turning it on is ingest's, since
   * it may release a held head.
   */
  turnOffGenerateEveryPush(
    pullRequestId: PullRequestRowId,
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

type PullRequestWriteExecutor = Pick<
  ReturnType<typeof internal>,
  "update" | "select"
>;

interface GuardedPullRequestUpdate {
  readonly pullRequestId: PullRequestRowId;
  readonly set: PgUpdateSetSource<typeof pullRequest>;
  /** The write lands only on a row this holds for. */
  readonly guard: SQL;
}

/**
 * Write `set` on the scope's row while `guard` holds, moving `row_version`.
 * A row the guard refuses is returned as it is, unwritten; `undefined` if no
 * row in scope.
 */
async function updateGuardedPullRequest(
  executor: PullRequestWriteExecutor,
  scope: RowScope,
  { pullRequestId, set, guard }: GuardedPullRequestUpdate,
): Promise<PullRequestRow | undefined> {
  const inScope = and(
    scope.matchesPullRequest(),
    eq(pullRequest.id, pullRequestId),
  );
  const written = await executor
    .update(pullRequest)
    .set({ ...set, rowVersion: buildNextRowVersion(), updatedAt: new Date() })
    .where(and(inScope, guard))
    .returning();
  if (written[0] !== undefined) {
    return written[0];
  }

  const current = await executor
    .select()
    .from(pullRequest)
    .where(inScope)
    .limit(1);
  return current[0];
}

/**
 * Record a collaborator's Trigger approval. The first approval stands: a
 * later call writes nothing, `row_version` included, and returns the row
 * as it is. `undefined` if no row in scope. Ingest runs it inside its own
 * transaction.
 */
export async function approvePullRequestTrigger(
  executor: PullRequestWriteExecutor,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
  reviewerId: ReviewerId,
): Promise<PullRequestRow | undefined> {
  return updateGuardedPullRequest(executor, scope, {
    pullRequestId,
    set: { triggerApprovedBy: reviewerId, triggerApprovedAt: sql`now()` },
    guard: isNull(pullRequest.triggerApprovedAt),
  });
}

/**
 * Record who turned on generating on every push. The first stamp stands: a
 * later call writes nothing, `row_version` included, and returns the row as
 * it is. `undefined` if no row in scope. Ingest runs it inside its own
 * transaction, under the pull request's row lock.
 */
export async function turnOnPullRequestEveryPush(
  executor: PullRequestWriteExecutor,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
  userId: ReviewerId,
): Promise<PullRequestRow | undefined> {
  return updateGuardedPullRequest(executor, scope, {
    pullRequestId,
    set: { generateEveryPushBy: userId, generateEveryPushAt: sql`now()` },
    guard: isNull(pullRequest.generateEveryPushAt),
  });
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
          rowVersion: buildNextRowVersion(),
        })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      return rows[0];
    },

    async swapEntryComment(pullRequestId, { seen, next }) {
      const holdsSeen =
        seen === null
          ? isNull(pullRequest.entryCommentId)
          : eq(pullRequest.entryCommentId, seen);
      const rows = await db
        .update(pullRequest)
        .set({
          entryCommentId: next,
          rowVersion: buildNextRowVersion(),
          updatedAt: new Date(),
        })
        .where(
          and(
            scope.matchesPullRequest(),
            eq(pullRequest.id, pullRequestId),
            holdsSeen,
          ),
        )
        .returning();
      const swapped = rows[0];
      if (swapped !== undefined) {
        return { ok: true, value: swapped };
      }

      const held = await db
        .select({ entryCommentId: pullRequest.entryCommentId })
        .from(pullRequest)
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .limit(1);
      const current = held[0];
      if (current === undefined) {
        return {
          ok: false,
          error: { code: EntryCommentSwapErrorCodes.NOT_FOUND },
        };
      }
      return {
        ok: false,
        error: {
          code: EntryCommentSwapErrorCodes.SWAP_LOST,
          entryCommentId: current.entryCommentId,
        },
      };
    },

    async setDraft(pullRequestId, draft, githubUpdatedAt) {
      const notNewer = sql`(${pullRequest.githubUpdatedAt} is null or ${pullRequest.githubUpdatedAt} <= ${githubUpdatedAt})`;
      const rows = await db
        .update(pullRequest)
        .set({
          draft,
          rowVersion: buildNextRowVersion(),
          updatedAt: new Date(),
        })
        .where(
          and(
            scope.matchesPullRequest(),
            eq(pullRequest.id, pullRequestId),
            notNewer,
          ),
        )
        .returning();
      const flipped = rows[0];
      if (flipped !== undefined) {
        return flipped;
      }
      return pullRequests.getById(pullRequestId);
    },

    async recordStack(pullRequestId, input) {
      const rows = await db
        .update(pullRequest)
        .set({
          stack: input.stack,
          stackReadAt: input.readAt,
          rowVersion: buildNextRowVersion(),
          updatedAt: new Date(),
        })
        .where(
          and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      return rows[0];
    },

    async turnOffGenerateEveryPush(pullRequestId) {
      return updateGuardedPullRequest(db, scope, {
        pullRequestId,
        set: { generateEveryPushBy: null, generateEveryPushAt: null },
        guard: isNotNull(pullRequest.generateEveryPushAt),
      });
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
    pullRequests: traceStore("pullRequests", pullRequests),
    checkpoints: traceStore("checkpoints", checkpoints),
    archives: createInboxArchiveStore(handle, ctx),
    reviewSessions: createReviewSessionRepository(db, scope),
  };
}
