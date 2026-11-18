// Purge + retention: everything that DELETES data, in one place. The tenant
// purges bind a ctx; the retention sweeps are instance-wide. Erasure
// completeness is the DB's job: every per-PR child table FKs
// `pull_request.id` ON DELETE CASCADE, and the Review Session graph hangs off
// `brief`. Sessions and API tokens bind no installation and outlive the
// tenant; no routine here touches them. `audit_log` is RETAINED by every
// purge: a purge APPENDS a `delete` entry in the same transaction, and only
// `sweepAuditLog` removes from it. Explicit purges are `app`; sweeps `system`.
import {
  and,
  count as countRows,
  eq,
  inArray,
  lt,
  type SQL,
} from "drizzle-orm";
import { traceStore } from "./trace-store";
import type { Mutable } from "types";
import { insertAudit, type AuditEntry } from "./audit";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { auditLog } from "../schema/audit-log";
import {
  AUDIT_RETENTION_FLOOR_DAYS,
  PR_RETENTION_FLOOR_DAYS,
} from "../db/config";
import { pullRequest } from "../schema/pull-request";
import { resolveScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import {
  AuditActorTypes,
  AuditOutcomes,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../types";
import { PullRequestSources } from "types/pull-requests";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Rows per transaction. The first sweep after an operator sets retention
 * meets every pull request closed since the instance began, and one
 * transaction over that backlog would hold its locks and cascade for the
 * whole run.
 */
const PULL_REQUEST_SWEEP_BATCH_SIZE = 500;

// The sweeps' own `audit_log.operation` token, these routines are not
// Product Operations, so they name themselves.
const AUDIT_OPERATION_DELETE = "delete";

// Open-ended `audit_log.target_type` classes.
const AUDIT_TARGET_PULL_REQUEST = "pull_request";
const AUDIT_TARGET_REPO = "repo";
const AUDIT_TARGET_INSTALLATION = "installation";
const AUDIT_TARGET_AUDIT_LOG = "audit_log";

/** The reviewer a purge names on its audit row; absent writes `app`. */
export interface PurgeActor {
  readonly reviewerId: ReviewerId;
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
   * DB guarantees erasure completeness). False, with nothing written, if the
   * row is not in ctx's scope. `actor` names the reviewer on the audit row;
   * the webhook and sweep callers pass none and stay `app`.
   */
  purgePullRequest(
    prRowId: PullRequestRowId,
    actor?: PurgeActor,
  ): Promise<boolean>;
  /**
   * Set-based purge for the `installation_repositories`
   * `removed` webhook: one `repo_id = ANY(...)` delete plus one `delete`
   * audit entry PER repo that held a row, since any account can repeat this
   * event on an "Any account" App and the log has no default retention. One query rather
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
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/**
 * Build the tenant-scoped purge + retention routines over the opaque handle.
 * `ctx` is the one place an `installation_id` enters; every routine that
 * touches a tenant row filters or stamps that same id, so a caller can never
 * erase another tenant's rows.
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

  return traceStore("purge", {
    ctx,

    async purgePullRequest(prRowId, actor) {
      return db.transaction(async (tx) => {
        // Verify the row belongs to ctx BEFORE writing anything.
        const parents = await tx
          .select({ id: pullRequest.id })
          .from(pullRequest)
          .where(and(scope.matchesPullRequest(), eq(pullRequest.id, prRowId)))
          .limit(1);
        if (parents[0] === undefined) {
          return false;
        }
        // Emit the audit BEFORE the delete lands, same tx, so it survives the
        // cascade it records (audit_log has no FK to pull_request).
        const entry: Mutable<AuditEntry> = {
          installationId: scope.installationId,
          source: scope.source,
          actorType: AuditActorTypes.APP,
          operation: AUDIT_OPERATION_DELETE,
          outcome: AuditOutcomes.OK,
          targetType: AUDIT_TARGET_PULL_REQUEST,
          targetId: prRowId,
        };
        if (actor !== undefined) {
          entry.actorType = AuditActorTypes.REVIEWER;
          entry.actorId = actor.reviewerId;
        }
        await insertAudit(tx, entry);
        const scopedPullRequest = and(
          scope.matchesPullRequest(),
          eq(pullRequest.id, prRowId),
        );
        await tx.delete(pullRequest).where(scopedPullRequest);
        return true;
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
          if (count === 0) {
            continue;
          }
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
        if (purgedPrs.length === 0) {
          return { pullRequests: 0 };
        }
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
  });
}

// ---------------------------------------------------------------------------
// Pull request retention, instance-wide rather than tenant-scoped.
// ---------------------------------------------------------------------------

/**
 * Delete every pull request, in either scope world, closed or merged before
 * the operator's retention window, children by FK cascade. Instance-wide on
 * purpose: retention is an env setting owned by whoever operates the
 * instance, so there is no ctx to bind to, and a row closed before the
 * setting existed is swept like any other. `retentionDays === null` (the
 * default) keeps everything and runs no query. Batched, each batch its own
 * transaction with one `delete` audit entry per installation or owner it
 * erased from. Nothing schedules this here.
 */
export async function sweepClosedPullRequests(
  handle: AppDatabase,
  retentionDays: number | null,
  now: Date,
): Promise<number> {
  if (retentionDays === null) {
    return 0;
  }
  const isWholeWindow =
    Number.isInteger(retentionDays) && retentionDays >= PR_RETENTION_FLOOR_DAYS;
  if (!isWholeWindow) {
    throw new Error(
      `pull request retention must be a whole number of days, at least ${PR_RETENTION_FLOOR_DAYS}, got ${retentionDays}`,
    );
  }
  const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error(
      `pull request retention of ${retentionDays} days has no cutoff`,
    );
  }

  // An open row has a NULL close time, which no range predicate matches.
  const isPastRetention = lt(pullRequest.closedAt, cutoff);
  const db = internal(handle);
  let total = 0;
  for (;;) {
    const deleted = await db.transaction((tx) =>
      sweepClosedBatch(tx, isPastRetention),
    );
    total += deleted;
    if (deleted < PULL_REQUEST_SWEEP_BATCH_SIZE) {
      return total;
    }
  }
}

/** Must run inside the caller's transaction: the audit entries share it. */
async function sweepClosedBatch(
  tx: AppDrizzle,
  isPastRetention: SQL,
): Promise<number> {
  const batch = tx
    .select({ id: pullRequest.id })
    .from(pullRequest)
    .where(isPastRetention)
    .orderBy(pullRequest.closedAt)
    .limit(PULL_REQUEST_SWEEP_BATCH_SIZE);
  // The outer predicate is re-checked on a row a concurrent reopen moved, so
  // a pull request reopened after the batch was picked survives.
  const inBatch = inArray(pullRequest.id, batch);
  const deleted = await tx
    .delete(pullRequest)
    .where(and(inBatch, isPastRetention))
    .returning({
      installationId: pullRequest.installationId,
      ownerUserId: pullRequest.ownerUserId,
    });

  for (const group of groupBySweepScope(deleted).values()) {
    await insertAudit(tx, {
      installationId: group.installationId,
      source:
        group.installationId === null
          ? PullRequestSources.URL
          : PullRequestSources.INSTALLATION,
      actorType: AuditActorTypes.SYSTEM,
      operation: AUDIT_OPERATION_DELETE,
      outcome: AuditOutcomes.OK,
      targetType: AUDIT_TARGET_PULL_REQUEST,
      metadata: { count: group.count },
    });
  }
  return deleted.length;
}

interface SweptScopeRow {
  readonly installationId: InstallationId | null;
  readonly ownerUserId: ReviewerId | null;
}

interface SweptScopeCount {
  readonly installationId: InstallationId | null;
  count: number;
}

/** One group per installation and per url-box owner; an audit row is one scope. */
function groupBySweepScope(
  rows: readonly SweptScopeRow[],
): Map<string, SweptScopeCount> {
  const groups = new Map<string, SweptScopeCount>();
  for (const row of rows) {
    const key =
      row.installationId === null
        ? `owner:${row.ownerUserId}`
        : `installation:${row.installationId}`;
    const group = groups.get(key) ?? {
      installationId: row.installationId,
      count: 0,
    };
    group.count += 1;
    groups.set(key, group);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Audit retention, instance-wide rather than tenant-scoped.
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
