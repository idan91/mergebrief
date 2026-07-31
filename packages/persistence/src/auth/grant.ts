// The grant seam (BRIEF-40 — ADR 0018 D15; ADR 0016 #4 as amended
// 2026-07-23). A `github_grant` row is the ONE holder of a GitHub
// authorization's encrypted credential pair; `reviewer_session` and
// `api_token` reference it by FK. Rotation therefore lives HERE — the exact
// serialized single-use-token-safe CAS `sessionAuth.refreshSession` used to
// implement, re-anchored to the grant row — and both presentation channels
// (cookie, Bearer) converge on it. Like `session.ts`/`token.ts` this is
// pre-tenant: a grant belongs to a GitHub user and spans installations
// (third D2b exception; the installation binding stays on referencing rows).
//
// Lifecycle: a grant dies with its LAST referent, in the same transaction —
// every referent-deleting seam calls `deleteOrphanedGrants` on the ids it
// unlinked (module-internal helper, never on the `index.ts` surface). A
// concurrent mint racing the last referent's delete resolves benignly in
// BOTH interleavings, at the cost of one failed transaction: if the delete
// locks the grant first, the mint's FK check blocks and fails after the
// commit (the minting user's session just vanished — the 500 is correct);
// if the mint's insert takes its FK KEY SHARE first, the grant DELETE blocks
// and the whole DELETING transaction aborts on the FK violation — a logout
// 500s and retries clean, and a sweep/purge batch aborts wholesale and
// succeeds on its next run. Rare (requires a same-grant mint in flight) and
// self-healing; do not "fix" by dropping the FK.
import { and, eq, inArray, notExists } from "drizzle-orm";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { apiToken } from "../schema/api-token";
import { githubGrant } from "../schema/github-grant";
import { reviewerSession } from "../schema/reviewer-session";
import type { GrantRowId, Result, ValueOf } from "../types";

export type GithubGrantRow = typeof githubGrant.$inferSelect;

// ---------------------------------------------------------------------------
// Refresh patch + rejection — the caller-driven refresh callback's contract.
// The caller (the api orchestrator) decrypts the stored refresh token, calls
// GitHub, and re-encrypts; persistence only applies the resulting columns.
// Unlike the retired per-row patches this ALWAYS carries `refreshExpiresAt`:
// the grant row tracks the rotating refresh token's own lifetime; what each
// channel does with it (mirror to session `expires_at`, ignore for tokens)
// is the caller's concern.
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

function fail(code: GrantAuthErrorCode, message: string): Result<never, GrantAuthError> {
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
   * Serialized, single-use-refresh-token-safe rotation (D11 shape, D15
   * anchor). ONE transaction: `SELECT … FOR UPDATE` the grant by id — which
   * serializes concurrent refreshes across BOTH channels and every referent
   * of this grant. Then:
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
 * Build the grant seam over the opaque `AppDatabase`. Uses the in-package
 * `internal()` unwrap; never exposes a raw query surface (D2b).
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
        // channels (GitHub refresh tokens are single-use; a lost race burns
        // the token — D11/D15).
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
 * anymore. MUST run on the same transaction that deleted the referents
 * (D15 lifecycle: a grant dies with its last referent, atomically) — hence
 * the raw `AppDrizzle` executor, same in-package pattern as `insertAudit`.
 * Module-internal: NOT re-exported from `index.ts`.
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
  const unique = [...new Set(grantIds)].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // Lock the candidate grants FIRST: two transactions deleting DIFFERENT
  // referents of one grant would otherwise each see the other's still-visible
  // row under READ COMMITTED (write skew) and both keep the grant — orphaning
  // it forever, since nothing sweeps grants by design. The lock serializes
  // the orphan decisions; the second transaction re-evaluates NOT EXISTS
  // after the first commits. (Not expressible on single-connection PGlite —
  // covered by the /verify runtime pass against real Postgres.)
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
            .select({ one: reviewerSession.id })
            .from(reviewerSession)
            .where(eq(reviewerSession.grantId, githubGrant.id)),
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
