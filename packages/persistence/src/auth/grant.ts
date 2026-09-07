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
import { and, eq, inArray, notExists } from "drizzle-orm";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { apiToken } from "../schema/api-token";
import { githubGrant } from "../schema/github-grant";
import { authSession } from "../schema/auth-session";
import type { GrantRowId, Result, ValueOf } from "../types";

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
} as const;
export type GrantAuthErrorCode = ValueOf<typeof GrantAuthErrorCodes>;

export interface GrantAuthError {
  readonly code: GrantAuthErrorCode;
  readonly message: string;
}

function fail(
  code: GrantAuthErrorCode,
  message: string,
): Result<never, GrantAuthError> {
  return { ok: false, error: { code, message } };
}

/** Everything a login persists to open a new grant. */
export interface GrantCreateInput {
  readonly ghTokenCiphertext: string;
  readonly ghRefreshTokenCiphertext: string;
  readonly keyRef: string;
  readonly refreshExpiresAt: Date;
}

export interface GrantAuth {
  /** Insert the grant row for a fresh GitHub authorization (login callback). */
  createGrant(input: GrantCreateInput): Promise<GithubGrantRow>;
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
   * no-op. Returns rows deleted, 0 or 1.
   */
  deleteIfOrphaned(grantId: GrantRowId): Promise<number>;
}

/**
 * Build the grant boundary over the opaque `AppDatabase`. Uses the in-package
 * `internal()` unwrap; never exposes a raw query surface.
 */
export function createGrantAuth(handle: AppDatabase): GrantAuth {
  const db = internal(handle);

  return {
    async createGrant(input) {
      const rows = await db
        .insert(githubGrant)
        .values({
          ghTokenCiphertext: input.ghTokenCiphertext,
          ghRefreshTokenCiphertext: input.ghRefreshTokenCiphertext,
          keyRef: input.keyRef,
          refreshExpiresAt: input.refreshExpiresAt,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error("github_grant insert returned no row");
      }
      return row;
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
      return db.transaction(async (tx) => {
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
    },

    async deleteIfOrphaned(grantId) {
      return deleteOrphanedGrants(db, [grantId]);
    },
  };
}

function compareGrantIds(left: GrantRowId, right: GrantRowId): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Delete every grant in `grantIds` that no session or token references
 * anymore. MUST run on the same transaction that deleted the referents, a
 * grant dies with its last referent, atomically, hence the raw `AppDrizzle`
 * executor. Module-internal: NOT re-exported from `index.ts`.
 */
export async function deleteOrphanedGrants(
  executor: AppDrizzle,
  grantIds: readonly GrantRowId[],
): Promise<number> {
  if (grantIds.length === 0) {
    return 0;
  }
  // De-dup (several referents may share one grant) + stable order so
  // concurrent callers acquire overlapping locks in the same sequence.
  const unique = [...new Set(grantIds)].toSorted(compareGrantIds);
  // Lock the candidate grants FIRST: two transactions deleting DIFFERENT
  // referents would each see the other's still-visible row under READ COMMITTED
  // and both keep the grant, orphaning it forever. Not reproducible on
  // single-connection PGlite; verified against real Postgres.
  await executor
    .select({ id: githubGrant.id })
    .from(githubGrant)
    .where(inArray(githubGrant.id, unique))
    .for("update");
  const deleted = await executor
    .delete(githubGrant)
    .where(
      and(
        inArray(githubGrant.id, unique),
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
            .where(eq(apiToken.grantId, githubGrant.id)),
        ),
      ),
    )
    .returning({ id: githubGrant.id });
  return deleted.length;
}
