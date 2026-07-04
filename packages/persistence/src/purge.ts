// Purge + retention routines (ADR 0018 D5 / D9 / D11) — the deletion seam,
// tenant-ctx-bound like every other DB surface in this package. Built over the
// opaque `AppDatabase`, unwrapped in-package with `internal()` (never
// re-exported), so consumers still cannot reach a raw query handle (D2b).
//
// Erasure completeness is the DB's job, not ours: every per-PR child table
// (`brief`, `delta`, `diff_snapshot`, `revision_narrative`, `comparison_marks`,
// `checkpoint`, `disposition`, `generation`) FKs `pull_request.id`
// `ON DELETE CASCADE`, so deleting a `pull_request` row — or predicate-deleting
// a set of them — cascades every child with no forgotten table (D5). The only
// non-PR table a purge touches is `reviewer_session` (D11, not FK'd); it is
// deleted explicitly on installation offboarding. `audit_log` is RETAINED
// (numeric-only, never purged, no FK — D9): a purge APPENDS a `delete` entry to
// it and never removes from it.
//
// AUDIT ORDERING: every routine's deletes and its `delete` audit emit run in
// ONE transaction, so they commit atomically. `purgePullRequest` emits BEFORE
// the delete (D9's "log the delete, then the target is gone" — proving the
// no-FK ledger survives the very row it records); the count-bearing routines
// (`purgeRepo`, `purgeInstallation`, `sweepExpired`) emit AFTER, since the count
// they summarize is the delete's own result. Order within the tx is immaterial
// to survival — atomic commit is what guarantees it.
//
// ACTOR CHOICE: explicit, admin/webhook-triggered purges (`purgePullRequest`,
// `purgeRepo`, `purgeInstallation`) are `app`; the automated retention sweep
// (`sweepExpired`) is `system`. `sweepExpiredSessions` emits NO audit entry —
// see its doc comment.
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { insertAudit } from "./audit.js";
import { type AppDatabase, internal } from "./db.js";
import { pullRequest } from "./schema/pull-request.js";
import { reviewerSession } from "./schema/reviewer-session.js";
import type { PullRequestRow, TenantContext } from "./tenant.js";
import {
  AuditAction,
  AuditActorType,
  type PullRequestRowId,
  type RepoId,
  type Result,
  type ValueOf,
} from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Open-ended `audit_log.target_type` classes (D9 leaves this vocabulary open).
const AUDIT_TARGET_PULL_REQUEST = "pull_request";
const AUDIT_TARGET_REPO = "repo";
const AUDIT_TARGET_INSTALLATION = "installation";

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

function fail(code: PurgeErrorCode, message: string): Result<never, PurgeError> {
  return { ok: false, error: { code, message } };
}

/** Row counts from an installation offboarding (D5). */
export interface InstallationPurgeCounts {
  readonly pullRequests: number;
  readonly sessions: number;
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
  purgePullRequest(prRowId: PullRequestRowId): Promise<Result<number, PurgeError>>;
  /**
   * Scoped predicate-delete of every `pull_request` for `(ctx, repoId)`
   * (children cascade) + a `delete` audit entry carrying the count. Returns the
   * number of PRs purged (0 if the repo held none).
   */
  purgeRepo(repoId: RepoId): Promise<number>;
  /**
   * Offboard the whole tenant: predicate-delete ALL `pull_request` rows for ctx
   * (children cascade) + explicit delete of the tenant's `reviewer_session`
   * rows (the one non-PR table, D5/D11). `audit_log` is retained untouched
   * (numeric-only, never purged) — this APPENDS an `installation` `delete`
   * entry. Returns both row counts.
   */
  purgeInstallation(): Promise<InstallationPurgeCounts>;
  /**
   * Set `purge_after = closedAt + graceDays`, or NULL when `graceDays` is null
   * (retention disabled / "never" — the row is never swept, D5). Also stamps
   * `closed_at`. Tenant-verified: `notFound` if the PR is not in ctx.
   */
  setRetention(
    prRowId: PullRequestRowId,
    closedAt: Date,
    graceDays: number | null,
  ): Promise<Result<PullRequestRow, PurgeError>>;
  /**
   * Retention sweep (D5): delete every `pull_request` for ctx with
   * `purge_after IS NOT NULL AND purge_after < now` (uses the partial index;
   * children cascade). Emits one `delete` audit entry summarizing the count
   * when anything was purged. Returns the number purged.
   */
  sweepExpired(now: Date): Promise<number>;
  /**
   * Session TTL sweep (D11): delete every `reviewer_session` for ctx with
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
export function purgeRoutines(handle: AppDatabase, ctx: TenantContext): PurgeRoutines {
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
          .where(and(eq(pullRequest.installationId, installationId), eq(pullRequest.id, prRowId)))
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
          action: AuditAction.DELETE,
          targetType: AUDIT_TARGET_PULL_REQUEST,
          targetId: prRowId,
        });
        const deleted = await tx
          .delete(pullRequest)
          .where(and(eq(pullRequest.installationId, installationId), eq(pullRequest.id, prRowId)))
          .returning({ id: pullRequest.id });
        return { ok: true, value: deleted.length };
      });
    },

    async purgeRepo(repoId) {
      return db.transaction(async (tx) => {
        const deleted = await tx
          .delete(pullRequest)
          .where(and(eq(pullRequest.installationId, installationId), eq(pullRequest.repoId, repoId)))
          .returning({ id: pullRequest.id });
        const count = deleted.length;
        await insertAudit(tx, {
          installationId,
          actorType: AuditActorType.APP,
          action: AuditAction.DELETE,
          targetType: AUDIT_TARGET_REPO,
          targetId: repoId,
          metadata: { count },
        });
        return count;
      });
    },

    async purgeInstallation() {
      return db.transaction(async (tx) => {
        const purgedPrs = await tx
          .delete(pullRequest)
          .where(eq(pullRequest.installationId, installationId))
          .returning({ id: pullRequest.id });
        const purgedSessions = await tx
          .delete(reviewerSession)
          .where(eq(reviewerSession.installationId, installationId))
          .returning({ id: reviewerSession.id });
        await insertAudit(tx, {
          installationId,
          actorType: AuditActorType.APP,
          action: AuditAction.DELETE,
          targetType: AUDIT_TARGET_INSTALLATION,
          targetId: installationId,
          metadata: { count: purgedPrs.length },
        });
        return { pullRequests: purgedPrs.length, sessions: purgedSessions.length };
      });
    },

    async setRetention(prRowId, closedAt, graceDays) {
      // Guard the primitive itself: a negative/NaN grace would silently make
      // the row instantly sweepable — a data-loss footgun no upstream
      // validation should be trusted to catch (D5).
      if (graceDays !== null && (!Number.isFinite(graceDays) || graceDays < 0)) {
        return fail(PurgeErrorCode.INVALID_GRACE, `graceDays must be a non-negative finite number, got ${graceDays}`);
      }
      const purgeAfter =
        graceDays === null ? null : new Date(closedAt.getTime() + graceDays * MS_PER_DAY);
      const rows = await db
        .update(pullRequest)
        .set({ closedAt, purgeAfter, updatedAt: new Date() })
        .where(and(eq(pullRequest.installationId, installationId), eq(pullRequest.id, prRowId)))
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
        // Low-volume rule (D9): only append a ledger entry when the sweep
        // actually erased something; an empty sweep is not a boundary event.
        if (count > 0) {
          await insertAudit(tx, {
            installationId,
            actorType: AuditActorType.SYSTEM,
            action: AuditAction.DELETE,
            targetType: AUDIT_TARGET_PULL_REQUEST,
            metadata: { count },
          });
        }
        return count;
      });
    },

    async sweepExpiredSessions(now) {
      // NO audit emit (D9 low-volume rule): reviewer sessions are short-lived
      // churn (D11 — deleted on expiry/logout by design), so a per-sweep
      // `delete` entry would flood the never-purged ledger with the exact kind
      // of high-frequency, low-signal noise D9 routes to the purgeable web
      // access log instead. Session erasure of record happens at installation
      // offboarding (`purgeInstallation`), which IS audited.
      const deleted = await db
        .delete(reviewerSession)
        .where(
          and(eq(reviewerSession.installationId, installationId), lt(reviewerSession.expiresAt, now)),
        )
        .returning({ id: reviewerSession.id });
      return deleted.length;
    },
  };
}
