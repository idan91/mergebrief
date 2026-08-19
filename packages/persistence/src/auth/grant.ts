// The grant boundary. A `github_grant` row is the ONE holder of a GitHub
// authorization's encrypted credential pair; `auth_session` and
// `api_token` reference it by FK, so rotation lives HERE and both
// presentation channels (cookie, Bearer) converge on it. Like
// `session.ts`/`token.ts` this is pre-tenant: a grant belongs to a GitHub
// user and spans installations — the installation binding stays on the
// referencing rows.
//
// Lifecycle: a grant dies with its LAST referent, in the same transaction —
// every referent-deleting boundary calls `deleteOrphanedGrants` on the ids it
// unlinked (module-internal, never on the `index.ts` surface). A concurrent
// mint racing the last referent's delete resolves benignly in both
// interleavings at the cost of one aborted transaction that retries clean;
// do not "fix" it by dropping the FK.
import { and, eq, inArray, notExists } from "drizzle-orm";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { apiToken } from "../schema/api-token";
import { githubGrant } from "../schema/github-grant";
import { authSession } from "../schema/auth-session";
import type { GrantRowId, Result, ValueOf } from "../types";

export type GithubGrantRow = typeof githubGrant.$inferSelect;

// ---------------------------------------------------------------------------
// Refresh patch + rejection — the caller-driven refresh callback's contract.
// The caller decrypts the stored refresh token, calls GitHub, and re-encrypts;
// persistence only applies the resulting columns. `refreshExpiresAt` tracks the
// rotating refresh token's own lifetime; what each channel does with it is the
// caller's concern.
// ---------------------------------------------------------------------------

/** New encrypted-credential columns to persist after a successful rotation. */
export interface GrantRefreshPatch {
  readonly ghTokenCiphertext: string;
  readonly ghRefreshTokenCiphertext: string;
  readonly keyRef: string;
  readonly refreshExpiresAt: Date;
}

/**
 * The caller's refresh failed (decrypt / GitHub rotation / re-encrypt). The
 * `reason` is opaque to persistence — it just signals "do not UPDATE"; the
 * caller acts on it per channel (delete the session / 401 the Bearer).
 */
export interface GrantRefreshRejection {
  readonly reason: string;
}

export const GrantAuthErrorCode = {
  /** No grant row for the id (last referent deleted concurrently). */
  NOT_FOUND: "not-found",
  /** The caller's `refresh` callback rejected; the row is left untouched. */
  REFRESH_REJECTED: "refresh-rejected",
} as const;
export type GrantAuthErrorCode = ValueOf<typeof GrantAuthErrorCode>;

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
   * Serialized, single-use-refresh-token-safe rotation. ONE transaction:
   * `SELECT … FOR UPDATE` the grant by id — which serializes concurrent
   * refreshes across BOTH channels and every referent of this grant. Then:
   *   - absent row → `NOT_FOUND` (the last referent vanished under us);
   *   - **compare-and-swap**: `seenTokenCiphertext` is the access-token
   *     ciphertext the caller observed BEFORE the failing GitHub call. If the
   *     locked row's no longer matches, another request already rotated →
   *     return the row AS-IS without calling `refresh` (no second exchange
   *     against the now-consumed single-use refresh token);
   *   - otherwise `refresh(lockedRow)` inside the lock; on ok apply the patch
   *     (+ `updated_at`) and return the updated row; on rejection return
   *     `REFRESH_REJECTED` with no write.
   */
  refreshGrant(
    grantId: GrantRowId,
    seenTokenCiphertext: string,
    refresh: (
      locked: GithubGrantRow,
    ) => Promise<Result<GrantRefreshPatch, GrantRefreshRejection>>,
  ): Promise<Result<GithubGrantRow, GrantAuthError>>;
  /**
   * Delete the grant iff nothing references it — the compensation path for a
   * login that created the grant but failed before the session insert (a
   * never-referenced grant would otherwise linger forever; the lifecycle
   * rule only cleans on referent DELETE). Safe to call on a referenced
   * grant: it is a no-op. Returns rows deleted (0 or 1).
   */
  deleteIfOrphaned(grantId: GrantRowId): Promise<number>;
}

/**
 * Build the grant boundary over the opaque `AppDatabase`. Uses the in-package
 * `internal()` unwrap; never exposes a raw query surface.
 */
export function grantAuth(handle: AppDatabase): GrantAuth {
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

    async refreshGrant(grantId, seenTokenCiphertext, refresh) {
      return db.transaction(async (tx) => {
        // FOR UPDATE: serialize concurrent refreshes of THIS grant, across
        // channels — GitHub refresh tokens are single-use, so a lost race
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
            GrantAuthErrorCode.NOT_FOUND,
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
          // The tx commits cleanly with NO write — the caller acts per channel.
          return fail(
            GrantAuthErrorCode.REFRESH_REJECTED,
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

/**
 * Delete every grant in `grantIds` that no session or token references
 * anymore. MUST run on the same transaction that deleted the referents — a
 * grant dies with its last referent, atomically — hence the raw `AppDrizzle`
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
  const unique = [...new Set(grantIds)].toSorted((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  // Lock the candidate grants FIRST: two transactions deleting DIFFERENT
  // referents of one grant would otherwise each see the other's still-visible
  // row under READ COMMITTED (write skew) and both keep the grant, orphaning
  // it forever — nothing sweeps grants. Not reproducible on single-connection
  // PGlite; verified against real Postgres.
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
