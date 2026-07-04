// The tenant-scoped repository — the ONLY database surface this package
// exposes to callers (ADR 0018 D2b). `forTenant(db, ctx)` binds an
// `installation_id` once; every method then filters (reads) or stamps (writes)
// that same id, so a caller can never address another tenant's rows per call.
//
// CRITICAL INVARIANT (stage-2 security review): the DB does NOT tie a child
// row's `installation_id` to its parent `pull_request`'s. This repository is
// the enforcement point:
//   (a) every per-PR child WRITE stamps `installation_id` from ctx AND resolves
//       the parent `pull_request` by (ctx.installationId, id) in the same
//       transaction — a parent belonging to another tenant yields a Result
//       error, never a DB write;
//   (b) every READ filters by ctx.installationId on the queried table's own
//       column (one-index read, D2a), which is safe precisely because (a)
//       guarantees a child's own `installation_id` matches its parent's.
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { type AppDatabase, internal } from "./db";
import { checkpoint } from "./schema/checkpoint";
import { pullRequest } from "./schema/pull-request";
import { reviewerSession } from "./schema/reviewer-session";
import {
  type InstallationId,
  isInstallationId,
  type PrState,
  type PullRequestRowId,
  type Result,
  type ReviewerId,
  type RepoId,
  type ValueOf,
} from "./types";

// ---------------------------------------------------------------------------
// Tenant context — the shape shared by the web (authz middleware) and worker
// (job payload) boundaries. Both validate untrusted input into it with Zod.
// ---------------------------------------------------------------------------

/** Bound tenant identity. Extensible (repo/reviewer scope may join later). */
export interface TenantContext {
  readonly installationId: InstallationId;
}

/** Coerce a JSON-ish scalar to a bigint; `undefined` when it isn't integral. */
function coerceBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  return undefined;
}

/** Zod schema for a branded `InstallationId` (bigint isn't JSON-native). */
const installationIdSchema = z.unknown().transform((value, ctx): InstallationId => {
  const big = coerceBigInt(value);
  if (big === undefined || !isInstallationId(big)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "installationId must be a positive integer",
    });
    return z.NEVER;
  }
  return big;
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Normalize snake_case (worker payload) / camelCase (web) into one shape. */
function normalizeContext(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }
  return { installationId: raw["installationId"] ?? raw["installation_id"] };
}

/**
 * Validates untrusted input (job payload / request context) into a
 * `TenantContext`. Accepts `installationId` or `installation_id`, as a bigint,
 * an integer number, or a numeric string.
 */
export const TenantContextSchema = z.preprocess(
  normalizeContext,
  z.object({ installationId: installationIdSchema }),
);

/** Parse into a `TenantContext`, throwing `ZodError` on invalid input. */
export function parseTenantContext(input: unknown): TenantContext {
  return TenantContextSchema.parse(input);
}

/** Non-throwing parse for callers that prefer a Result at their boundary. */
export function safeParseTenantContext(input: unknown): Result<TenantContext, string> {
  const parsed = TenantContextSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { ok: false, error: parsed.error.message };
}

// ---------------------------------------------------------------------------
// Repository errors — expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const RepositoryErrorCode = {
  /** A per-PR write named a `pull_request` that is not in ctx's tenant. */
  PARENT_NOT_IN_TENANT: "parent-not-in-tenant",
  /** A scoped mutation matched no row in ctx's tenant. */
  NOT_FOUND: "not-found",
} as const;
export type RepositoryErrorCode = ValueOf<typeof RepositoryErrorCode>;

export interface RepositoryError {
  readonly code: RepositoryErrorCode;
  readonly message: string;
}

function fail(code: RepositoryErrorCode, message: string): Result<never, RepositoryError> {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Row + input shapes.
// ---------------------------------------------------------------------------

export type PullRequestRow = typeof pullRequest.$inferSelect;
export type CheckpointRow = typeof checkpoint.$inferSelect;
export type ReviewerSessionRow = typeof reviewerSession.$inferSelect;

export interface PullRequestUpsertInput {
  readonly repoId: RepoId;
  readonly prNumber: number;
  readonly repoSlug?: string;
  readonly state: PrState;
  readonly closedAt?: Date;
  readonly purgeAfter?: Date;
}

export interface PullRequestStatePatch {
  readonly state: PrState;
  readonly closedAt?: Date;
  readonly purgeAfter?: Date;
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
  readonly ghTokenCiphertext: string;
  readonly keyRef: string;
  readonly expiresAt: Date;
}

// ---------------------------------------------------------------------------
// The repository surface.
// ---------------------------------------------------------------------------

export interface PullRequestRepository {
  /** Content-addressed upsert on the natural key; idempotent per D6. */
  upsert(input: PullRequestUpsertInput): Promise<PullRequestRow>;
  /** Tenant-scoped read by (repo, number). Absence is a normal `undefined`. */
  getByNumber(repoId: RepoId, prNumber: number): Promise<PullRequestRow | undefined>;
  /** Scoped lifecycle mutation; `notFound` if no row in ctx's tenant. */
  setState(
    pullRequestId: PullRequestRowId,
    patch: PullRequestStatePatch,
  ): Promise<Result<PullRequestRow, RepositoryError>>;
}

export interface CheckpointRepository {
  /**
   * Idempotent upsert of a reviewer's checkpoint. Verifies the parent
   * `pull_request` belongs to ctx (invariant (a)); returns `parentNotInTenant`
   * without writing when it does not.
   */
  upsertOnSubmit(input: CheckpointSubmitInput): Promise<Result<CheckpointRow, RepositoryError>>;
  /** Tenant-scoped read; absence is a normal `undefined`. */
  get(pullRequestId: PullRequestRowId, reviewerId: ReviewerId): Promise<CheckpointRow | undefined>;
}

export interface SessionRepository {
  /** Stamp the tenant and insert. `reviewer_session` has no PR parent (D11). */
  create(input: SessionCreateInput): Promise<ReviewerSessionRow>;
  /** Scoped read by token hash; absence is a normal `undefined`. */
  getByTokenHash(sessionTokenHash: string): Promise<ReviewerSessionRow | undefined>;
  /** TTL sweep within the tenant; returns the number deleted. */
  deleteExpired(now: Date): Promise<number>;
  /** Logout / reviewer offboarding within the tenant; returns number deleted. */
  deleteByReviewer(reviewerId: ReviewerId): Promise<number>;
}

export interface TenantRepository {
  readonly ctx: TenantContext;
  readonly pullRequests: PullRequestRepository;
  readonly checkpoints: CheckpointRepository;
  readonly sessions: SessionRepository;
}

/**
 * Build a tenant-scoped repository over an opaque `AppDatabase`. `ctx` is the
 * one place an `installation_id` enters; no method accepts another.
 */
export function forTenant(handle: AppDatabase, ctx: TenantContext): TenantRepository {
  const db = internal(handle);
  const { installationId } = ctx;

  const pullRequests: PullRequestRepository = {
    async upsert(input) {
      const rows = await db
        .insert(pullRequest)
        .values({
          installationId,
          repoId: input.repoId,
          prNumber: input.prNumber,
          repoSlug: input.repoSlug,
          state: input.state,
          closedAt: input.closedAt,
          purgeAfter: input.purgeAfter,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [pullRequest.installationId, pullRequest.repoId, pullRequest.prNumber],
          set: {
            state: input.state,
            repoSlug: input.repoSlug,
            closedAt: input.closedAt,
            purgeAfter: input.purgeAfter,
            updatedAt: new Date(),
          },
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
            eq(pullRequest.installationId, installationId),
            eq(pullRequest.repoId, repoId),
            eq(pullRequest.prNumber, prNumber),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async setState(pullRequestId, patch) {
      const rows = await db
        .update(pullRequest)
        .set({
          state: patch.state,
          closedAt: patch.closedAt,
          purgeAfter: patch.purgeAfter,
          updatedAt: new Date(),
        })
        .where(
          and(eq(pullRequest.installationId, installationId), eq(pullRequest.id, pullRequestId)),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) {
        return fail(
          RepositoryErrorCode.NOT_FOUND,
          `pull_request ${pullRequestId} not found in tenant ${installationId}`,
        );
      }
      return { ok: true, value: row };
    },
  };

  const checkpoints: CheckpointRepository = {
    async upsertOnSubmit(input) {
      return db.transaction(async (tx) => {
        // Invariant (a): resolve the parent within ctx's tenant BEFORE writing.
        const parents = await tx
          .select({ id: pullRequest.id })
          .from(pullRequest)
          .where(
            and(
              eq(pullRequest.installationId, installationId),
              eq(pullRequest.id, input.pullRequestId),
            ),
          )
          .limit(1);
        if (parents[0] === undefined) {
          // Nothing written; the (empty) tx commits cleanly.
          return fail(
            RepositoryErrorCode.PARENT_NOT_IN_TENANT,
            `pull_request ${input.pullRequestId} not in tenant ${installationId}`,
          );
        }
        const rows = await tx
          .insert(checkpoint)
          .values({
            installationId,
            pullRequestId: input.pullRequestId,
            reviewerId: input.reviewerId,
            reviewerLogin: input.reviewerLogin,
            lastSubmittedSha: input.lastSubmittedSha,
            submittedAt: input.submittedAt,
          })
          .onConflictDoUpdate({
            target: [checkpoint.installationId, checkpoint.pullRequestId, checkpoint.reviewerId],
            set: {
              reviewerLogin: input.reviewerLogin,
              lastSubmittedSha: input.lastSubmittedSha,
              submittedAt: input.submittedAt,
            },
          })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error("checkpoint upsert returned no row");
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
            eq(checkpoint.installationId, installationId),
            eq(checkpoint.pullRequestId, pullRequestId),
            eq(checkpoint.reviewerId, reviewerId),
          ),
        )
        .limit(1);
      return rows[0];
    },
  };

  const sessions: SessionRepository = {
    async create(input) {
      const rows = await db
        .insert(reviewerSession)
        .values({
          installationId,
          sessionTokenHash: input.sessionTokenHash,
          reviewerId: input.reviewerId,
          reviewerLogin: input.reviewerLogin,
          ghTokenCiphertext: input.ghTokenCiphertext,
          keyRef: input.keyRef,
          expiresAt: input.expiresAt,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error("reviewer_session insert returned no row");
      }
      return row;
    },

    async getByTokenHash(sessionTokenHash) {
      const rows = await db
        .select()
        .from(reviewerSession)
        .where(
          and(
            eq(reviewerSession.installationId, installationId),
            eq(reviewerSession.sessionTokenHash, sessionTokenHash),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async deleteExpired(now) {
      const rows = await db
        .delete(reviewerSession)
        .where(
          and(
            eq(reviewerSession.installationId, installationId),
            lt(reviewerSession.expiresAt, now),
          ),
        )
        .returning({ id: reviewerSession.id });
      return rows.length;
    },

    async deleteByReviewer(reviewerId) {
      const rows = await db
        .delete(reviewerSession)
        .where(
          and(
            eq(reviewerSession.installationId, installationId),
            eq(reviewerSession.reviewerId, reviewerId),
          ),
        )
        .returning({ id: reviewerSession.id });
      return rows.length;
    },
  };

  return {
    ctx,
    pullRequests,
    checkpoints,
    sessions,
  };
}
