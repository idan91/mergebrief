/* oxlint-disable house/comment-run -- the orphan-sweep lifecycle and the FK it
   depends on are the reason this boundary is safe to call concurrently */
// The grant boundary. A `github_grant` row is the ONE holder of a GitHub
// authorization's encrypted credential pair; `auth_session` and
// `api_token` reference it by FK, so rotation lives HERE and both
// presentation channels (cookie, Bearer) converge on it. Like
// `session.ts`/`token.ts` this is pre-tenant: a grant belongs to a GitHub
// user and spans installations, the installation binding stays on the
// referencing rows.
//
// Lifecycle: a grant dies with its LAST referent, in the same transaction,
// every referent-deleting boundary calls `deleteOrphanedGrants` on the ids it
// unlinked (module-internal, never on the `index.ts` surface). A concurrent
// mint racing the last referent's delete resolves benignly in both
// interleavings at the cost of one aborted transaction that retries clean;
// do not "fix" it by dropping the FK.
/* oxlint-enable house/comment-run */
import {
  type SQL,
  and,
  eq,
  gt,
  inArray,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod/v4";
import { traceStore } from "../stores/trace-store";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { apiToken } from "../schema/api-token";
import { githubGrant } from "../schema/github-grant";
import { authSession } from "../schema/auth-session";
import { isGrantRowId, type GrantRowId, type ReviewerId } from "../types";
import type { Result, ValueOf } from "types/utils";
import { encryptToken, type CryptoError, type KeyProvider } from "./crypto";
import { GrantSealedColumns } from "./types";

export type GithubGrantRow = typeof githubGrant.$inferSelect;

// The caller-driven refresh callback's contract: the caller decrypts the stored
// refresh token, calls GitHub and re-encrypts, and persistence only applies the
// resulting columns. `refreshExpiresAt` tracks the rotating refresh token's own
// lifetime; what each channel does with it is the caller's concern.

/** New encrypted-credential columns to persist after a successful rotation. */
export interface GrantRefreshPatch {
  readonly ghTokenCiphertext: string;
  readonly ghRefreshTokenCiphertext: string;
  readonly keyRef: string;
  readonly refreshExpiresAt: Date;
}

/**
 * The caller's refresh failed (decrypt / GitHub rotation / re-encrypt). The
 * `reason` is opaque to persistence, it just signals "do not UPDATE"; the
 * caller acts on it per channel (delete the session / 401 the Bearer).
 */
export interface GrantRefreshRejection {
  readonly reason: string;
}

export const GrantAuthErrorCodes = {
  /** No grant row for the id (last referent deleted concurrently). */
  NOT_FOUND: "not-found",
  /** The caller's `refresh` callback rejected; the row is left untouched. */
  REFRESH_REJECTED: "refresh-rejected",
  /** Another refresh held the grant past the lock bound; nothing was called. */
  LOCK_TIMEOUT: "lock-timeout",
} as const;
export type GrantAuthErrorCode = ValueOf<typeof GrantAuthErrorCodes>;

export interface GrantAuthError {
  readonly code: GrantAuthErrorCode;
  readonly message: string;
}

/**
 * A waiter on a grant another refresh holds gives up after this long, so a
 * queue of waiters cannot each hold a pool connection for a GitHub call.
 */
const GRANT_LOCK_TIMEOUT_MS = 2_000;

/** Postgres SQLSTATE `lock_not_available`, raised when `lock_timeout` fires. */
const LOCK_NOT_AVAILABLE = "55P03";

const lockTimeoutSchema = z.object({ code: z.literal(LOCK_NOT_AVAILABLE) });

/** drizzle wraps the driver's error, so the SQLSTATE sits on it or its cause. */
function isLockTimeout(error: unknown): boolean {
  if (lockTimeoutSchema.safeParse(error).success) {
    return true;
  }
  const wrapped = z.object({ cause: lockTimeoutSchema }).safeParse(error);
  return wrapped.success;
}

function fail(
  code: GrantAuthErrorCode,
  message: string,
): Result<never, GrantAuthError> {
  return { ok: false, error: { code, message } };
}

/** What retiring a dead grant removed: sessions deleted, live tokens revoked. */
export interface RetiredGrant {
  readonly sessionsDeleted: number;
  readonly tokensRevoked: number;
}

/**
 * A grant no session and no live token uses any more: what a caller needs to
 * revoke the access token at GitHub once the transaction has committed.
 */
export interface OrphanedGrant {
  readonly id: GrantRowId;
  readonly ghTokenCiphertext: string;
  readonly keyRef: string;
}

/**
 * Takes each batch's orphaned grants once that batch has committed, so a
 * sweep that fails later still hands over every grant it already removed.
 */
export type OrphanedGrantSink = (grants: readonly OrphanedGrant[]) => void;

/** Everything a login hands over to open a new grant; the pair is sealed here. */
export interface GrantCreateInput {
  readonly userId: ReviewerId;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly keyProvider: KeyProvider;
  readonly keyRef: string;
  readonly refreshExpiresAt: Date;
}

interface SealedGrantPair {
  readonly ghTokenCiphertext: string;
  readonly ghRefreshTokenCiphertext: string;
}

export interface GrantAuth {
  /**
   * Insert the grant row for a fresh GitHub authorization (login callback),
   * sealing the pair to the row's own id inside the insert's transaction. A
   * key the provider cannot resolve is a `CryptoError` and inserts nothing.
   */
  createGrant(
    input: GrantCreateInput,
  ): Promise<Result<GithubGrantRow, CryptoError>>;
  /**
   * Plain read by id, how the worker resolves a job's `grant_id` reference
   * into the ciphertext pair it lazily decrypts. Absence is a normal
   * `undefined`: the referencing session may have logged out (grant
   * orphan-cleaned) between enqueue and drain.
   */
  getGrant(grantId: GrantRowId): Promise<GithubGrantRow | undefined>;
  /**
   * Serialized rotation in ONE `SELECT … FOR UPDATE` transaction. No row gives
   * `NOT_FOUND`; a `seenTokenCiphertext` mismatch means another request already
   * rotated, so the row returns as-is rather than spending the consumed
   * single-use refresh token; a rejection is `REFRESH_REJECTED` with no write.
   * A lock held past the bound is `LOCK_TIMEOUT`, before the callback runs.
   */
  refreshGrant(
    grantId: GrantRowId,
    seenTokenCiphertext: string,
    refresh: (
      locked: GithubGrantRow,
    ) => Promise<Result<GrantRefreshPatch, GrantRefreshRejection>>,
  ): Promise<Result<GithubGrantRow, GrantAuthError>>;
  /**
   * Delete the grant iff nothing references it. This is the compensation path
   * for a login that created a grant but failed before the session insert, since
   * the lifecycle rule only cleans on referent DELETE. A referenced grant is a
   * no-op. Returns the grant it deleted, if any.
   */
  deleteIfOrphaned(grantId: GrantRowId): Promise<OrphanedGrant[]>;
  /**
   * End every sign-in riding a grant GitHub refused to rotate, in ONE
   * transaction: delete its sessions and set `revoked_at = now` on its live
   * tokens (an earlier `revoked_at` stays). The grant dies here only when no
   * token row still references it.
   */
  retireGrant(grantId: GrantRowId, now: Date): Promise<RetiredGrant>;
}

/**
 * Build the grant boundary over the opaque `AppDatabase`. Uses the in-package
 * `internal()` unwrap; never exposes a raw query surface.
 */
export function createGrantAuth(handle: AppDatabase): GrantAuth {
  const db = internal(handle);

  return traceStore("grantAuth", {
    async createGrant(input) {
      return insertSealedGrant(db, input);
    },

    async getGrant(grantId) {
      const rows = await db
        .select()
        .from(githubGrant)
        .where(eq(githubGrant.id, grantId))
        .limit(1);
      return rows[0];
    },

    async refreshGrant(grantId, seenTokenCiphertext, refresh) {
      try {
        return await rotateUnderLock(db, grantId, seenTokenCiphertext, refresh);
      } catch (error) {
        if (isLockTimeout(error)) {
          return fail(
            GrantAuthErrorCodes.LOCK_TIMEOUT,
            "github_grant is held by another refresh",
          );
        }
        throw error;
      }
    },

    async deleteIfOrphaned(grantId) {
      return deleteOrphanedGrants(db, [grantId]);
    },

    async retireGrant(grantId, now) {
      // Lock order sessions, tokens, grant, each table by id, as on every
      // credential path (`deleteUserCredentials`, the sweeps).
      return db.transaction(async (tx) => {
        await tx
          .select({ id: authSession.id })
          .from(authSession)
          .where(eq(authSession.grantId, grantId))
          .orderBy(authSession.id)
          .for("update");
        const sessions = await tx
          .delete(authSession)
          .where(eq(authSession.grantId, grantId))
          .returning({ id: authSession.id });
        await tx
          .select({ id: apiToken.id })
          .from(apiToken)
          .where(eq(apiToken.grantId, grantId))
          .orderBy(apiToken.id)
          .for("update");
        const tokens = await tx
          .update(apiToken)
          .set({ revokedAt: now })
          .where(and(eq(apiToken.grantId, grantId), isNull(apiToken.revokedAt)))
          .returning({ id: apiToken.id });
        await deleteOrphanedGrants(tx, [grantId]);
        return {
          sessionsDeleted: sessions.length,
          tokensRevoked: tokens.length,
        };
      });
    },
  });
}

const allocatedGrantIdSchema = z.object({
  rows: z.tuple([z.object({ id: z.string().regex(/^\d+$/) })]),
});

/** The id is drawn before the insert because the AAD must name it. */
async function allocateGrantId(executor: AppDrizzle): Promise<GrantRowId> {
  const result = await executor.execute(
    sql`select nextval(pg_get_serial_sequence('github_grant', 'id'))::text as id`,
  );
  const id = BigInt(allocatedGrantIdSchema.parse(result).rows[0].id);
  if (!isGrantRowId(id)) {
    throw new Error("github_grant sequence returned a non-positive id");
  }
  return id;
}

async function sealGrantPair(
  input: GrantCreateInput,
  grantId: GrantRowId,
): Promise<Result<SealedGrantPair, CryptoError>> {
  const access = await encryptToken(
    input.keyProvider,
    input.keyRef,
    input.accessToken,
    { grantId, column: GrantSealedColumns.ACCESS_TOKEN },
  );
  if (!access.ok) {
    return access;
  }
  const refresh = await encryptToken(
    input.keyProvider,
    input.keyRef,
    input.refreshToken,
    { grantId, column: GrantSealedColumns.REFRESH_TOKEN },
  );
  if (!refresh.ok) {
    return refresh;
  }
  return {
    ok: true,
    value: {
      ghTokenCiphertext: access.value,
      ghRefreshTokenCiphertext: refresh.value,
    },
  };
}

/**
 * Module-internal, NOT re-exported from `index.ts`: given a transaction, the
 * grant commits or rolls back with whatever else that transaction writes.
 */
export async function insertSealedGrant(
  db: AppDrizzle,
  input: GrantCreateInput,
): Promise<Result<GithubGrantRow, CryptoError>> {
  return db.transaction(async (tx) => {
    const grantId = await allocateGrantId(tx);
    const sealed = await sealGrantPair(input, grantId);
    if (!sealed.ok) {
      return sealed;
    }

    const rows = await tx
      .insert(githubGrant)
      .overridingSystemValue()
      .values({
        id: grantId,
        userId: input.userId,
        ghTokenCiphertext: sealed.value.ghTokenCiphertext,
        ghRefreshTokenCiphertext: sealed.value.ghRefreshTokenCiphertext,
        keyRef: input.keyRef,
        refreshExpiresAt: input.refreshExpiresAt,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("github_grant insert returned no row");
    }
    return { ok: true, value: row };
  });
}

type RotationCallback = (
  locked: GithubGrantRow,
) => Promise<Result<GrantRefreshPatch, GrantRefreshRejection>>;

async function rotateUnderLock(
  db: AppDrizzle,
  grantId: GrantRowId,
  seenTokenCiphertext: string,
  refresh: RotationCallback,
): Promise<Result<GithubGrantRow, GrantAuthError>> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('lock_timeout', ${`${GRANT_LOCK_TIMEOUT_MS}ms`}, true)`,
    );
    // FOR UPDATE: serialize concurrent refreshes of THIS grant, across
    // channels, GitHub refresh tokens are single-use, so a lost race
    // burns the token.
    const locked = await tx
      .select()
      .from(githubGrant)
      .where(eq(githubGrant.id, grantId))
      .for("update")
      .limit(1);
    const row = locked[0];
    if (row === undefined) {
      return fail(
        GrantAuthErrorCodes.NOT_FOUND,
        "github_grant not found for the given id",
      );
    }

    // Compare-and-swap: already rotated by another request while we
    // waited for the lock → return AS-IS, no second exchange.
    if (row.ghTokenCiphertext !== seenTokenCiphertext) {
      return { ok: true, value: row };
    }

    const patch = await refresh(row);
    if (!patch.ok) {
      // The tx commits cleanly with NO write, the caller acts per channel.
      return fail(
        GrantAuthErrorCodes.REFRESH_REJECTED,
        "github_grant refresh was rejected by the caller",
      );
    }

    const updated = await tx
      .update(githubGrant)
      .set({
        ghTokenCiphertext: patch.value.ghTokenCiphertext,
        ghRefreshTokenCiphertext: patch.value.ghRefreshTokenCiphertext,
        keyRef: patch.value.keyRef,
        refreshExpiresAt: patch.value.refreshExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(githubGrant.id, row.id))
      .returning();
    const updatedRow = updated[0];
    if (updatedRow === undefined) {
      throw new Error("github_grant refresh update returned no row");
    }
    return { ok: true, value: updatedRow };
  });
}

function compareGrantIds(left: GrantRowId, right: GrantRowId): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * No session and no token neither revoked nor expired (database clock) uses
 * the grant: the one definition of a dead grant, the sweep's included.
 */
export function buildNoLiveReferentConditions(executor: AppDrizzle): SQL[] {
  return [
    notExists(
      executor
        .select({ one: authSession.id })
        .from(authSession)
        .where(eq(authSession.grantId, githubGrant.id)),
    ),
    notExists(
      executor
        .select({ one: apiToken.id })
        .from(apiToken)
        .where(
          and(
            eq(apiToken.grantId, githubGrant.id),
            isNull(apiToken.revokedAt),
            or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, sql`now()`)),
          ),
        ),
    ),
  ];
}

/**
 * Settle every grant in `grantIds` that no session and no live token uses any
 * more: return it, so the caller revokes its token at GitHub after commit,
 * and delete its row when no token row references it at all (a revoked or
 * expired token keeps the row until the hourly sweep deletes it). MUST
 * run on the transaction that removed or revoked the referents, hence the raw
 * `AppDrizzle` executor. Module-internal: NOT re-exported from `index.ts`.
 */
export async function deleteOrphanedGrants(
  executor: AppDrizzle,
  grantIds: readonly GrantRowId[],
): Promise<OrphanedGrant[]> {
  if (grantIds.length === 0) {
    return [];
  }
  // De-dup (several referents may share one grant). The lock's ORDER BY, not
  // this sort, is what makes concurrent callers lock overlapping grants in
  // the same sequence: Postgres takes the IN-list's rows in plan order.
  const unique = [...new Set(grantIds)].toSorted(compareGrantIds);
  // Lock the candidate grants FIRST: two transactions deleting DIFFERENT
  // referents would each see the other's still-visible row under READ COMMITTED
  // and both keep the grant, orphaning it forever. Not reproducible on
  // single-connection PGlite; verified against real Postgres.
  await executor
    .select({ id: githubGrant.id })
    .from(githubGrant)
    .where(inArray(githubGrant.id, unique))
    .orderBy(githubGrant.id)
    .for("update");
  const orphaned = await executor
    .select({
      id: githubGrant.id,
      ghTokenCiphertext: githubGrant.ghTokenCiphertext,
      keyRef: githubGrant.keyRef,
    })
    .from(githubGrant)
    .where(
      and(
        inArray(githubGrant.id, unique),
        ...buildNoLiveReferentConditions(executor),
      ),
    );
  if (orphaned.length === 0) {
    return [];
  }

  await executor.delete(githubGrant).where(
    and(
      inArray(
        githubGrant.id,
        orphaned.map((grant) => grant.id),
      ),
      notExists(
        executor
          .select({ one: apiToken.id })
          .from(apiToken)
          .where(eq(apiToken.grantId, githubGrant.id)),
      ),
    ),
  );
  return orphaned;
}
