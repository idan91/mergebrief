// Purge + retention: everything that DELETES data, in one place, tenant-ctx
// bound. Erasure completeness is the DB's job: every per-PR child table FKs
// `pull_request.id` ON DELETE CASCADE, and the Review Session graph hangs off
// `brief`. Sessions and API tokens bind no installation and outlive the
// tenant; only the session TTL sweep touches `auth_session`. `audit_log` is
// RETAINED by every tenant-scoped purge: a purge APPENDS a `delete` entry in
// the same transaction, and only `sweepAuditLog` removes from it. Explicit
// purges are `app`; the retention sweep is `system`.
import {
  and,
  count as countRows,
  eq,
  inArray,
  isNotNull,
  lt,
} from "drizzle-orm";
import { deleteOrphanedGrants } from "../auth/grant";
import { insertAudit } from "./audit";
import { type AppDatabase, internal } from "../db/handle";
import { auditLog } from "../schema/audit-log";
import { AUDIT_RETENTION_FLOOR_DAYS } from "../db/config";
import { pullRequest } from "../schema/pull-request";
import { authSession } from "../schema/auth-session";
import type { PullRequestRow } from "./tenant";
import { resolveScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import {
  AuditActorTypes,
  AuditOutcomes,
  PrStates,
  PullRequestSources,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type Result,
  type ValueOf,
} from "../types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The sweeps' own `audit_log.operation` token, these routines are not
// Product Operations, so they name themselves.
const AUDIT_OPERATION_DELETE = "delete";

// Open-ended `audit_log.target_type` classes.
const AUDIT_TARGET_PULL_REQUEST = "pull_request";
const AUDIT_TARGET_REPO = "repo";
const AUDIT_TARGET_INSTALLATION = "installation";
const AUDIT_TARGET_AUDIT_LOG = "audit_log";

// ---------------------------------------------------------------------------
// Errors, expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const PurgeErrorCodes = {
  /** A tenant-scoped purge/retention op named a `pull_request` not in ctx. */
  NOT_FOUND: "not-found",
  /** `graceDays` was negative, fractional-invalid (NaN/Infinity), or absurd. */
  INVALID_GRACE: "invalid-grace",
} as const;
export type PurgeErrorCode = ValueOf<typeof PurgeErrorCodes>;

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
}

// ---------------------------------------------------------------------------
// Surface.
// ---------------------------------------------------------------------------

export interface PurgeRoutines {
  readonly ctx: ScopeContext;
  /**
   * Erase one PR: verify it belongs to ctx, emit a `delete` audit entry, then
   * delete the `pull_request` row (all 8 child tables die by FK cascade, the
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
   * `removed` webhook: one `repo_id = ANY(...)` delete plus one `delete`
   * audit entry PER repo, a repo that held none included. One query rather
   * than a per-repo `Promise.all`, which would open N pool connections on a
   * large deselection. Returns the total number of PRs purged; empty
   * `repoIds` is 0 with no tx.
   */
  purgeRepos(repoIds: readonly RepoId[]): Promise<number>;
  /**
   * Offboard the whole tenant: predicate-delete ALL `pull_request` rows for
   * ctx (children cascade). Sessions and API tokens bind no installation and
   * stay: access ends because GitHub stops confirming it. `audit_log` is
   * retained untouched by this routine, which APPENDS an `installation`
   * `delete` entry. Returns the row count.
   */
  purgeInstallation(): Promise<InstallationPurgeCounts>;
  /**
   * The close-time retention boundary: atomically records the terminal
   * `state` and sets `purge_after = closedAt + graceDays`, or NULL when
   * `graceDays` is null (retention disabled / "never", the row is never
   * swept). Carrying the terminal state in the signature keeps this API
   * aligned with the `pull_request_open_retention_shape` CHECK, an open PR
   * can never be armed, by construction rather than by DB error.
   * Tenant-verified: `notFound` if the PR is not in ctx.
   */
  setRetention(
    prRowId: PullRequestRowId,
    state: typeof PrStates.CLOSED | typeof PrStates.MERGED,
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
 * `ctx` is the one place an `installation_id` enters; every routine that
 * touches a tenant row filters or stamps that same id, so a caller can never
 * erase another tenant's rows. The one exception is `sweepExpiredSessions`:
 * a session holds no installation, so under an installation scope the sweep
 * is instance-wide, and only the owner world narrows it.
 */
export function createPurgeRoutines(
  handle: AppDatabase,
  ctx: ScopeContext,
): PurgeRoutines {
  const db = internal(handle);
  const scope = resolveScope(ctx);

  // The webhook-driven, whole-tenant routines have no owner-world meaning;
  // reaching one from an owner scope is a programmer error.
  function requireInstallation(routine: string): InstallationId {
    if (scope.installationId === null) {
      throw new Error(`${routine} is installation-scoped`);
    }
    return scope.installationId;
  }

  return {
    ctx,

    async purgePullRequest(prRowId) {
      return db.transaction(async (tx) => {
        // Verify the row belongs to ctx BEFORE writing anything.
        const parents = await tx
          .select({ id: pullRequest.id })
          .from(pullRequest)
          .where(and(scope.matchesPullRequest(), eq(pullRequest.id, prRowId)))
          .limit(1);
        if (parents[0] === undefined) {
          return fail(
            PurgeErrorCodes.NOT_FOUND,
            `pull_request ${prRowId} not found in ${scope.label}`,
          );
        }
        // Emit the audit BEFORE the delete lands, same tx, so it survives the
        // cascade it records (audit_log has no FK to pull_request).
        await insertAudit(tx, {
          installationId: scope.installationId,
          source: scope.source,
          actorType: AuditActorTypes.APP,
          operation: AUDIT_OPERATION_DELETE,
          outcome: AuditOutcomes.OK,
          targetType: AUDIT_TARGET_PULL_REQUEST,
          targetId: prRowId,
        });
        const deleted = await tx
          .delete(pullRequest)
          .where(and(scope.matchesPullRequest(), eq(pullRequest.id, prRowId)))
          .returning({ id: pullRequest.id });
        return { ok: true, value: deleted.length };
      });
    },

    async purgeRepo(repoId) {
      return db.transaction(async (tx) => {
        const deleted = await tx
          .delete(pullRequest)
          .where(
            and(scope.matchesPullRequest(), eq(pullRequest.repoId, repoId)),
          )
          .returning({ id: pullRequest.id });
        const count = deleted.length;
        await insertAudit(tx, {
          installationId: scope.installationId,
          source: scope.source,
          actorType: AuditActorTypes.APP,
          operation: AUDIT_OPERATION_DELETE,
          outcome: AuditOutcomes.OK,
          targetType: AUDIT_TARGET_REPO,
          targetId: repoId,
          metadata: { count },
        });
        return count;
      });
    },

    async purgeRepos(repoIds) {
      // Dedupe (a payload may repeat) and skip an empty set, an empty
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
              scope.matchesPullRequest(),
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
            installationId: scope.installationId,
            source: scope.source,
            actorType: AuditActorTypes.APP,
            operation: AUDIT_OPERATION_DELETE,
            outcome: AuditOutcomes.OK,
            targetType: AUDIT_TARGET_REPO,
            targetId: repoId,
            metadata: { count },
          });
        }
        return deleted.length;
      });
    },

    async purgeInstallation() {
      const installationId = requireInstallation("purgeInstallation");
      return db.transaction(async (tx) => {
        // Sessions and tokens stay: neither holds an installation, and access
        // ends because GitHub stops confirming it.
        const purgedPrs = await tx
          .delete(pullRequest)
          .where(scope.matchesPullRequest())
          .returning({ id: pullRequest.id });
        await insertAudit(tx, {
          installationId: scope.installationId,
          source: scope.source,
          actorType: AuditActorTypes.APP,
          operation: AUDIT_OPERATION_DELETE,
          outcome: AuditOutcomes.OK,
          targetType: AUDIT_TARGET_INSTALLATION,
          targetId: installationId,
          metadata: { count: purgedPrs.length },
        });
        return { pullRequests: purgedPrs.length };
      });
    },

    async setRetention(prRowId, state, closedAt, graceDays) {
      if (state !== PrStates.CLOSED && state !== PrStates.MERGED) {
        throw new Error("setRetention requires a terminal PR state");
      }
      // Guard the primitive itself: a negative/NaN grace would silently make
      // the row instantly sweepable, a data-loss footgun no upstream
      // validation should be trusted to catch.
      if (
        graceDays !== null &&
        (!Number.isFinite(graceDays) || graceDays < 0)
      ) {
        return fail(
          PurgeErrorCodes.INVALID_GRACE,
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
        .where(and(scope.matchesPullRequest(), eq(pullRequest.id, prRowId)))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        return fail(
          PurgeErrorCodes.NOT_FOUND,
          `pull_request ${prRowId} not found in ${scope.label}`,
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
              scope.matchesPullRequest(),
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
            installationId: scope.installationId,
            source: scope.source,
            actorType: AuditActorTypes.SYSTEM,
            operation: AUDIT_OPERATION_DELETE,
            outcome: AuditOutcomes.OK,
            targetType: AUDIT_TARGET_PULL_REQUEST,
            metadata: { count },
          });
        }
        return count;
      });
    },

    async sweepExpiredSessions(now) {
      // NO audit emit: reviewer sessions are short-lived churn, so a per-sweep
      // `delete` entry would flood the ledger with low-signal noise. Sessions
      // outlive installation offboarding by design, as they hold no
      // installation; access ends when GitHub stops confirming it.
      return db.transaction(async (tx) => {
        // A session holds no installation; the owner world narrows to the
        // owner's own sessions.
        const conditions = [lt(authSession.expiresAt, now)];
        if (scope.ownerUserId !== null) {
          conditions.push(eq(authSession.reviewerId, scope.ownerUserId));
        }
        const deleted = await tx
          .delete(authSession)
          .where(and(...conditions))
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
// Audit retention, the one purge that is NOT tenant-scoped.
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
    // committed after this count, so the recorded count is a floor, and rows
    // that young cannot be past a 30-day cutoff anyway.
    const counted = await tx
      .select({
        installationId: auditLog.installationId,
        count: countRows(auditLog.id),
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
        source:
          installationId === null
            ? PullRequestSources.URL
            : PullRequestSources.INSTALLATION,
        actorType: AuditActorTypes.SYSTEM,
        operation: AUDIT_OPERATION_DELETE,
        outcome: AuditOutcomes.OK,
        targetType: AUDIT_TARGET_AUDIT_LOG,
        metadata: { count },
      });
    }
    return total;
  });
}
