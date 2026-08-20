// Purge + retention: everything that DELETES data, in one place.
//
// Tenant-ctx-bound like every other DB surface in this package: built over the
// opaque `AppDatabase`, unwrapped in-package with `internal()` (never
// re-exported), so consumers still cannot reach a raw query handle.
//
// Nobody calls these from a UI: the close webhook arms retention
// (`setRetention`), a scheduled worker job runs the sweeps, the app-uninstall
// webhook triggers `purgeInstallation`, and an operator can purge a single
// PR/repo directly. Forgetting is a CAPABILITY, not a mandate — retention
// "never" (null grace) keeps everything.
//
// Erasure completeness is the DB's job, not ours: every per-PR child table
// (`brief`, `delta`, `diff_snapshot`, `revision_narrative`, `comparison_marks`,
// `hunk_span`, `checkpoint`, `generation`) FKs `pull_request.id`
// `ON DELETE CASCADE`, so deleting a `pull_request` row — or predicate-deleting
// a set of them — cascades every child with no forgotten table. The Review
// Session graph — `review_session` and the six tables it owns, `disposition`
// among them — is reached through `brief`, two hops rather than one. The only
// non-PR tables a purge touches are `auth_session` and `api_token` (neither
// FK'd); both are deleted explicitly on installation offboarding. `audit_log`
// is RETAINED by every tenant-scoped purge (no FK): a purge APPENDS a `delete`
// entry to it and never removes from it. Only `sweepAuditLog` — instance-wide,
// off by default — deletes from that table.
//
// AUDIT ORDERING: every routine's deletes and its `delete` audit emit run in
// ONE transaction, so they commit atomically. `purgePullRequest` emits BEFORE
// the delete; the count-bearing routines emit AFTER, since the count they
// summarize is the delete's own result. Order within the tx is immaterial to
// survival — atomic commit is what guarantees it.
//
// ACTOR CHOICE: explicit, admin/webhook-triggered purges (`purgePullRequest`,
// `purgeRepo`, `purgeInstallation`) are `app`; the automated retention sweep
// (`sweepExpired`) is `system`. `sweepExpiredSessions` emits NO audit entry —
// see its doc comment.
import { and, count as countOf, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { deleteOrphanedGrants } from "../auth/grant";
import { insertAudit } from "./audit";
import { type AppDatabase, internal } from "../db/handle";
import { apiToken } from "../schema/api-token";
import { auditLog } from "../schema/audit-log";
import { AUDIT_RETENTION_FLOOR_DAYS } from "../db/config";
import { pullRequest } from "../schema/pull-request";
import { authSession } from "../schema/auth-session";
import type { PullRequestRow, TenantContext } from "./tenant";
import {
  AuditAction,
  AuditActorType,
  AuditOutcome,
  type PrState,
  type PullRequestRowId,
  type RepoId,
  type Result,
  type ValueOf,
} from "../types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Open-ended `audit_log.target_type` classes.
const AUDIT_TARGET_PULL_REQUEST = "pull_request";
const AUDIT_TARGET_REPO = "repo";
const AUDIT_TARGET_INSTALLATION = "installation";
const AUDIT_TARGET_AUDIT_LOG = "audit_log";

// ---------------------------------------------------------------------------
// Errors — expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const PurgeErrorCode = {
  /** A tenant-scoped purge/retention op named a `pull_request` not in ctx. */
  NOT_FOUND: "not-found",
  /** `graceDays` was negative, fractional-invalid (NaN/Infinity), or absurd. */
  INVALID_GRACE: "invalid-grace",
} as const;
export type PurgeErrorCode = ValueOf<typeof PurgeErrorCode>;

export interface PurgeError {
  readonly code: PurgeErrorCode;
  readonly message: string;
}

function fail(
  code: PurgeErrorCode,
  message: string,
): Result<never, PurgeError> {
  return { ok: false, error: { code, message } };
}

/** Row counts from an installation offboarding. */
export interface InstallationPurgeCounts {
  readonly pullRequests: number;
  readonly sessions: number;
  readonly apiTokens: number;
}

// ---------------------------------------------------------------------------
// Surface.
// ---------------------------------------------------------------------------

export interface PurgeRoutines {
  readonly ctx: TenantContext;
  /**
   * Erase one PR: verify it belongs to ctx, emit a `delete` audit entry, then
   * delete the `pull_request` row (all 8 child tables die by FK cascade — the
   * DB guarantees erasure completeness). `notFound` (nothing deleted) if the
   * row is not in ctx's tenant. Returns the number of `pull_request` rows
   * deleted (1 on success).
   */
  purgePullRequest(
    prRowId: PullRequestRowId,
  ): Promise<Result<number, PurgeError>>;
  /**
   * Scoped predicate-delete of every `pull_request` for `(ctx, repoId)`
   * (children cascade) + a `delete` audit entry carrying the count. Returns the
   * number of PRs purged (0 if the repo held none).
   */
  purgeRepo(repoId: RepoId): Promise<number>;
  /**
   * Set-based sibling of `purgeRepo` for the `installation_repositories`
   * `removed` webhook: purge every `pull_request` for `(ctx, repoId ∈ repoIds)`
   * in ONE transaction — a single `repo_id = ANY(...)` delete (children
   * cascade) plus one `delete` audit entry PER repo (count grouped from the
   * deleted rows; a repo that held none still gets a count-0 entry, matching
   * `purgeRepo`). Deliberately one query rather than a per-repo `Promise.all`,
   * which would open N concurrent pool connections and could exhaust the pool
   * on a large deselection. Returns the total number of PRs purged. Empty
   * `repoIds` → 0, no tx.
   */
  purgeRepos(repoIds: readonly RepoId[]): Promise<number>;
  /**
   * Offboard the whole tenant: predicate-delete ALL `pull_request` rows for ctx
   * (children cascade) + explicit delete of the tenant's `auth_session`
   * and `api_token` rows (the non-PR secret-bearing tables — installation-bound
   * tokens must not outlive their tenant).
   * `audit_log` is retained untouched by this routine — this
   * APPENDS an `installation` `delete` entry. Returns all three row counts.
   */
  purgeInstallation(): Promise<InstallationPurgeCounts>;
  /**
   * The close-time retention boundary: atomically records the terminal
   * `state` and sets `purge_after = closedAt + graceDays`, or NULL when
   * `graceDays` is null (retention disabled / "never" — the row is never
   * swept). Carrying the terminal state in the signature keeps this API
   * aligned with the `pull_request_open_retention_shape` CHECK — an open PR
   * can never be armed, by construction rather than by DB error.
   * Tenant-verified: `notFound` if the PR is not in ctx.
   */
  setRetention(
    prRowId: PullRequestRowId,
    state: typeof PrState.CLOSED | typeof PrState.MERGED,
    closedAt: Date,
    graceDays: number | null,
  ): Promise<Result<PullRequestRow, PurgeError>>;
  /**
   * Retention sweep: delete every `pull_request` for ctx with
   * `purge_after IS NOT NULL AND purge_after < now` (uses the partial index;
   * children cascade). Emits one `delete` audit entry summarizing the count
   * when anything was purged. Returns the number purged.
   */
  sweepExpired(now: Date): Promise<number>;
  /**
   * Session TTL sweep: delete every `auth_session` for ctx with
   * `expires_at < now`. Returns the number deleted.
   */
  sweepExpiredSessions(now: Date): Promise<number>;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/**
 * Build the tenant-scoped purge + retention routines over the opaque handle.
 * `ctx` is the one place an `installation_id` enters; every routine filters or
 * stamps that same id, so a caller can never erase another tenant's rows.
 */
export function purgeRoutines(
  handle: AppDatabase,
  ctx: TenantContext,
): PurgeRoutines {
  const db = internal(handle);
  const { installationId } = ctx;

  return {
    ctx,

    async purgePullRequest(prRowId) {
      return db.transaction(async (tx) => {
        // Verify the row belongs to ctx BEFORE writing anything.
        const parents = await tx
          .select({ id: pullRequest.id })
          .from(pullRequest)
          .where(
            and(
              eq(pullRequest.installationId, installationId),
              eq(pullRequest.id, prRowId),
            ),
          )
          .limit(1);
        if (parents[0] === undefined) {
          return fail(
            PurgeErrorCode.NOT_FOUND,
            `pull_request ${prRowId} not found in tenant ${installationId}`,
          );
        }
        // Emit the audit BEFORE the delete lands — same tx, so it survives the
        // cascade it records (audit_log has no FK to pull_request).
        await insertAudit(tx, {
          installationId,
          actorType: AuditActorType.APP,
          operation: AuditAction.DELETE,
          outcome: AuditOutcome.OK,
          targetType: AUDIT_TARGET_PULL_REQUEST,
          targetId: prRowId,
        });
        const deleted = await tx
          .delete(pullRequest)
          .where(
            and(
              eq(pullRequest.installationId, installationId),
              eq(pullRequest.id, prRowId),
            ),
          )
          .returning({ id: pullRequest.id });
        return { ok: true, value: deleted.length };
      });
    },

    async purgeRepo(repoId) {
      return db.transaction(async (tx) => {
        const deleted = await tx
          .delete(pullRequest)
          .where(
            and(
              eq(pullRequest.installationId, installationId),
              eq(pullRequest.repoId, repoId),
            ),
          )
          .returning({ id: pullRequest.id });
        const count = deleted.length;
        await insertAudit(tx, {
          installationId,
          actorType: AuditActorType.APP,
          operation: AuditAction.DELETE,
          outcome: AuditOutcome.OK,
          targetType: AUDIT_TARGET_REPO,
          targetId: repoId,
          metadata: { count },
        });
        return count;
      });
    },

    async purgeRepos(repoIds) {
      // Dedupe (a payload may repeat) and skip an empty set — an empty
      // `inArray` is a degenerate query and there is nothing to audit.
      const uniqueRepoIds = [...new Set(repoIds)];
      if (uniqueRepoIds.length === 0) {
        return 0;
      }
      return db.transaction(async (tx) => {
        // One set-based delete (one pool connection, one round trip); children
        // cascade off `pull_request`. `returning` carries `repoId` so the
        // per-repo audit counts are grouped without a second query.
        const deleted = await tx
          .delete(pullRequest)
          .where(
            and(
              eq(pullRequest.installationId, installationId),
              inArray(pullRequest.repoId, uniqueRepoIds),
            ),
          )
          .returning({ id: pullRequest.id, repoId: pullRequest.repoId });
        const countByRepo = new Map<RepoId, number>();
        for (const repoId of uniqueRepoIds) {
          countByRepo.set(repoId, 0);
        }
        for (const row of deleted) {
          countByRepo.set(row.repoId, (countByRepo.get(row.repoId) ?? 0) + 1);
        }
        // One `delete` audit entry per repo, same tx.
        for (const [repoId, count] of countByRepo) {
          await insertAudit(tx, {
            installationId,
            actorType: AuditActorType.APP,
            operation: AuditAction.DELETE,
            outcome: AuditOutcome.OK,
            targetType: AUDIT_TARGET_REPO,
            targetId: repoId,
            metadata: { count },
          });
        }
        return deleted.length;
      });
    },

    async purgeInstallation() {
      return db.transaction(async (tx) => {
        const purgedPrs = await tx
          .delete(pullRequest)
          .where(eq(pullRequest.installationId, installationId))
          .returning({ id: pullRequest.id });
        const purgedSessions = await tx
          .delete(authSession)
          .where(eq(authSession.installationId, installationId))
          .returning({ grantId: authSession.grantId });
        const purgedTokens = await tx
          .delete(apiToken)
          .where(eq(apiToken.installationId, installationId))
          .returning({ grantId: apiToken.grantId });
        // Orphan-clean the grants of every deleted referent, same tx.
        await deleteOrphanedGrants(tx, [
          ...purgedSessions.map((row) => row.grantId),
          ...purgedTokens.map((row) => row.grantId),
        ]);
        await insertAudit(tx, {
          installationId,
          actorType: AuditActorType.APP,
          operation: AuditAction.DELETE,
          outcome: AuditOutcome.OK,
          targetType: AUDIT_TARGET_INSTALLATION,
          targetId: installationId,
          metadata: { count: purgedPrs.length },
        });
        return {
          pullRequests: purgedPrs.length,
          sessions: purgedSessions.length,
          apiTokens: purgedTokens.length,
        };
      });
    },

    async setRetention(prRowId, state, closedAt, graceDays) {
      // Guard the primitive itself: a negative/NaN grace would silently make
      // the row instantly sweepable — a data-loss footgun no upstream
      // validation should be trusted to catch.
      if (
        graceDays !== null &&
        (!Number.isFinite(graceDays) || graceDays < 0)
      ) {
        return fail(
          PurgeErrorCode.INVALID_GRACE,
          `graceDays must be a non-negative finite number, got ${graceDays}`,
        );
      }
      const purgeAfter =
        graceDays === null
          ? null
          : new Date(closedAt.getTime() + graceDays * MS_PER_DAY);
      const rows = await db
        .update(pullRequest)
        .set({ state, closedAt, purgeAfter, updatedAt: new Date() })
        .where(
          and(
            eq(pullRequest.installationId, installationId),
            eq(pullRequest.id, prRowId),
          ),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) {
        return fail(
          PurgeErrorCode.NOT_FOUND,
          `pull_request ${prRowId} not found in tenant ${installationId}`,
        );
      }
      return { ok: true, value: row };
    },

    async sweepExpired(now) {
      return db.transaction(async (tx) => {
        const deleted = await tx
          .delete(pullRequest)
          .where(
            and(
              eq(pullRequest.installationId, installationId),
              isNotNull(pullRequest.purgeAfter),
              lt(pullRequest.purgeAfter, now),
            ),
          )
          .returning({ id: pullRequest.id });
        const count = deleted.length;
        // Only append a ledger entry when the sweep actually erased something;
        // an empty sweep is not a boundary event.
        if (count > 0) {
          await insertAudit(tx, {
            installationId,
            actorType: AuditActorType.SYSTEM,
            operation: AuditAction.DELETE,
            outcome: AuditOutcome.OK,
            targetType: AUDIT_TARGET_PULL_REQUEST,
            metadata: { count },
          });
        }
        return count;
      });
    },

    async sweepExpiredSessions(now) {
      // NO audit emit: reviewer sessions are short-lived churn, so a per-sweep
      // `delete` entry would flood the never-purged ledger with high-frequency,
      // low-signal noise. Session erasure of record happens at installation
      // offboarding (`purgeInstallation`), which IS audited.
      return db.transaction(async (tx) => {
        const deleted = await tx
          .delete(authSession)
          .where(
            and(
              eq(authSession.installationId, installationId),
              lt(authSession.expiresAt, now),
            ),
          )
          .returning({ grantId: authSession.grantId });
        // Orphan-clean the grants of the swept sessions, same tx.
        await deleteOrphanedGrants(
          tx,
          deleted.map((row) => row.grantId),
        );
        return deleted.length;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Audit retention — the one purge that is NOT tenant-scoped.
// ---------------------------------------------------------------------------

/**
 * Sweep audit rows older than the operator's retention window, across every
 * installation. Instance-wide on purpose: retention is an env setting owned by
 * whoever operates the instance, not a per-installation policy, so there is no
 * ctx to bind to. `retentionDays === null` (the default) keeps everything and
 * runs no query.
 *
 * The sweep records itself: one `delete` entry per installation whose rows it
 * erased, carrying the count, in the SAME transaction as the deletes. Nothing
 * schedules this here.
 */
export async function sweepAuditLog(
  handle: AppDatabase,
  retentionDays: number | null,
  now: Date,
): Promise<number> {
  if (retentionDays === null) {
    return 0;
  }
  // Guard the primitive itself: a short or fractional window reaching this far
  // would erase history the operator never agreed to lose.
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < AUDIT_RETENTION_FLOOR_DAYS
  ) {
    throw new Error(
      `audit retention must be a whole number of days >= ${AUDIT_RETENTION_FLOOR_DAYS}, got ${retentionDays}`,
    );
  }
  const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);
  return internal(handle).transaction(async (tx) => {
    // Count in the DB, not in JS: this is the one table designed to grow
    // unbounded, so `returning` every erased row would materialize a year of
    // history just to sum it. Under READ COMMITTED the delete can erase a row
    // committed after this count, so the recorded count is a floor — and rows
    // that young cannot be past a 30-day cutoff anyway.
    const counted = await tx
      .select({
        installationId: auditLog.installationId,
        count: countOf(auditLog.id),
      })
      .from(auditLog)
      .where(lt(auditLog.occurredAt, cutoff))
      .groupBy(auditLog.installationId);
    if (counted.length === 0) {
      return 0;
    }
    await tx.delete(auditLog).where(lt(auditLog.occurredAt, cutoff));
    let total = 0;
    for (const { installationId, count } of counted) {
      total += count;
      await insertAudit(tx, {
        installationId,
        actorType: AuditActorType.SYSTEM,
        operation: AuditAction.DELETE,
        outcome: AuditOutcome.OK,
        targetType: AUDIT_TARGET_AUDIT_LOG,
        metadata: { count },
      });
    }
    return total;
  });
}
