// The reviewer-session auth seam (BRIEF-2 stage 6, PR C — ADR 0016 #4 + ADR
// 0018 D11). This is the PRE-TENANT resolver: unlike `forTenant(db, ctx)`,
// nothing here is bound to an `installation_id`. It CANNOT be — session
// resolution is the authN primitive that PRECEDES tenant scoping. You cannot
// know the installation until you have resolved the session, and the globally
// UNIQUE `session_token_hash` (a high-entropy random cookie token, stored only
// as its SHA-256) is exactly what tells you it. So these functions are keyed by
// that hash, not by ctx — the same trust shape as the webhook route deriving
// its tenant from the signed payload's `installation.id`: the lookup PRODUCES
// the tenant, it is not scoped by one.
//
// The write path IS still tenant-safe: `refreshSession`'s UPDATE is scoped by
// the locked row's own `installation_id` (+ its `id`), so the value that gates
// the write comes from the row, never from an unscoped caller argument.
import { and, eq } from "drizzle-orm";
import { type AppDatabase, internal } from "./db";
import { reviewerSession } from "./schema/reviewer-session";
import type { ReviewerSessionRow } from "./tenant";
import type { InstallationId, Result, ValueOf } from "./types";

// ---------------------------------------------------------------------------
// Refresh patch + rejection — the caller-driven refresh callback's contract.
// The caller (the api orchestrator) decrypts the stored refresh token, calls
// GitHub, and re-encrypts; persistence only applies the resulting columns.
// ---------------------------------------------------------------------------

/** New encrypted-token columns to persist after a successful refresh. */
export interface SessionRefreshPatch {
  readonly ghTokenCiphertext: string;
  readonly ghRefreshTokenCiphertext: string;
  readonly keyRef: string;
  readonly expiresAt: Date;
}

/**
 * The caller's refresh failed (decrypt / GitHub rotation / re-encrypt). The
 * `reason` is opaque to persistence — it just signals "do not UPDATE"; the
 * caller acts on it (delete the session, force re-login).
 */
export interface SessionRefreshRejection {
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Errors — expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const SessionAuthErrorCode = {
  /** No session row for the given `session_token_hash`. */
  NOT_FOUND: "not-found",
  /** The caller's `refresh` callback rejected; the row is left untouched. */
  REFRESH_REJECTED: "refresh-rejected",
} as const;
export type SessionAuthErrorCode = ValueOf<typeof SessionAuthErrorCode>;

export interface SessionAuthError {
  readonly code: SessionAuthErrorCode;
  readonly message: string;
}

function fail(
  code: SessionAuthErrorCode,
  message: string,
): Result<never, SessionAuthError> {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// The surface.
// ---------------------------------------------------------------------------

export interface SessionAuth {
  /**
   * Plain SELECT by the globally-unique hash — the fast path AND the tenant
   * resolver (its `installation_id` is what scopes every subsequent query).
   * Absence is a normal `undefined`.
   */
  findSession(sessionTokenHash: string): Promise<ReviewerSessionRow | undefined>;
  /** Delete by hash (logout / refresh-failure cleanup). Returns rows deleted. */
  deleteSession(sessionTokenHash: string): Promise<number>;
  /**
   * Serialized, single-use-token-safe refresh (D11). ONE transaction:
   * `SELECT … FOR UPDATE` the row by its hash — which SERIALIZES concurrent
   * refreshes of the same session, because GitHub refresh tokens are single-use
   * and a lost race would burn the token. Then:
   *   - absent row → `NOT_FOUND`.
   *   - **compare-and-swap**: the caller passes `seenTokenCiphertext` = the
   *     access-token ciphertext it read BEFORE the (failed/expired) GitHub call
   *     that prompted this refresh. If the locked row's `gh_token_ciphertext`
   *     no longer equals it, another request already rotated the tokens while we
   *     waited for the lock → return the row AS-IS, WITHOUT calling `refresh`
   *     (no second exchange against the now-consumed single-use refresh token).
   *     This is the correct guard for LAZY, 401-driven refresh: freshness is not
   *     a wall-clock threshold (the row's `expires_at` tracks the ~6mo refresh
   *     token, not the ~8h access token), it is "did the token I was using
   *     already get replaced".
   *   - otherwise call `refresh(lockedRow)` (the network round-trip is held
   *     INSIDE the lock — the deliberate D11 serialization); on its `ok` apply
   *     the patch via an UPDATE scoped by the row's own `installation_id` + `id`
   *     and return the updated row; on its rejection DO NOT update — return
   *     `REFRESH_REJECTED` so the caller deletes the session.
   */
  refreshSession(
    sessionTokenHash: string,
    seenTokenCiphertext: string,
    refresh: (
      locked: ReviewerSessionRow,
    ) => Promise<Result<SessionRefreshPatch, SessionRefreshRejection>>,
  ): Promise<Result<ReviewerSessionRow, SessionAuthError>>;
  /**
   * Rebind the session to a DIFFERENT installation (BRIEF-19 multi-org switch —
   * D14). The session row's `installation_id` IS the tenant stamp, so the switch
   * endpoint validates the target is in the viewer's LIVE accessible set (never
   * trusting the caller) BEFORE calling this — this seam only persists a
   * pre-validated rebinding. Atomic, ctx-safe: `SELECT … FOR UPDATE` the row by
   * its hash, then UPDATE its `installation_id` scoped by the locked row's OWN
   * current `installation_id` + `id` (the gate value comes from the row, never
   * from an unscoped caller argument). A vanished row → `NOT_FOUND`.
   */
  rebindInstallation(
    sessionTokenHash: string,
    installationId: InstallationId,
  ): Promise<Result<ReviewerSessionRow, SessionAuthError>>;
}

/**
 * Build the pre-tenant, token-hash-keyed session resolver over the opaque
 * `AppDatabase`. Uses the in-package `internal()` unwrap; never exposes a raw
 * query surface (D2b), and is intentionally NOT ctx-bound (see the file header).
 */
export function sessionAuth(handle: AppDatabase): SessionAuth {
  const db = internal(handle);

  return {
    async findSession(sessionTokenHash) {
      const rows = await db
        .select()
        .from(reviewerSession)
        .where(eq(reviewerSession.sessionTokenHash, sessionTokenHash))
        .limit(1);
      return rows[0];
    },

    async deleteSession(sessionTokenHash) {
      const rows = await db
        .delete(reviewerSession)
        .where(eq(reviewerSession.sessionTokenHash, sessionTokenHash))
        .returning({ id: reviewerSession.id });
      return rows.length;
    },

    async refreshSession(sessionTokenHash, seenTokenCiphertext, refresh) {
      return db.transaction(async (tx) => {
        // FOR UPDATE: serialize concurrent refreshes of THIS session.
        const locked = await tx
          .select()
          .from(reviewerSession)
          .where(eq(reviewerSession.sessionTokenHash, sessionTokenHash))
          .for("update")
          .limit(1);
        const row = locked[0];
        if (row === undefined) {
          return fail(
            SessionAuthErrorCode.NOT_FOUND,
            "reviewer_session not found for the given token hash",
          );
        }

        // Compare-and-swap: if the token we were using was already rotated by
        // another request while we waited for the lock, return AS-IS — no second
        // exchange against the now-consumed single-use refresh token (D11).
        if (row.ghTokenCiphertext !== seenTokenCiphertext) {
          return { ok: true, value: row };
        }

        const patch = await refresh(row);
        if (!patch.ok) {
          // The tx commits cleanly with NO write — the caller deletes it.
          return fail(
            SessionAuthErrorCode.REFRESH_REJECTED,
            "reviewer_session refresh was rejected by the caller",
          );
        }

        const updated = await tx
          .update(reviewerSession)
          .set({
            ghTokenCiphertext: patch.value.ghTokenCiphertext,
            ghRefreshTokenCiphertext: patch.value.ghRefreshTokenCiphertext,
            keyRef: patch.value.keyRef,
            expiresAt: patch.value.expiresAt,
          })
          .where(
            and(
              eq(reviewerSession.installationId, row.installationId),
              eq(reviewerSession.id, row.id),
            ),
          )
          .returning();
        const updatedRow = updated[0];
        if (updatedRow === undefined) {
          throw new Error("reviewer_session refresh update returned no row");
        }
        return { ok: true, value: updatedRow };
      });
    },

    async rebindInstallation(sessionTokenHash, installationId) {
      return db.transaction(async (tx) => {
        // FOR UPDATE: serialize a rebinding against a concurrent refresh/rebind
        // of THIS session (both mutate the one row).
        const locked = await tx
          .select()
          .from(reviewerSession)
          .where(eq(reviewerSession.sessionTokenHash, sessionTokenHash))
          .for("update")
          .limit(1);
        const row = locked[0];
        if (row === undefined) {
          return fail(
            SessionAuthErrorCode.NOT_FOUND,
            "reviewer_session not found for the given token hash",
          );
        }

        // The UPDATE is gated by the locked row's OWN current installation_id
        // (+ id) — never by an unscoped caller argument, so a rebinding can only
        // move the tenant stamp of the row it already resolved.
        const updated = await tx
          .update(reviewerSession)
          .set({ installationId })
          .where(
            and(
              eq(reviewerSession.installationId, row.installationId),
              eq(reviewerSession.id, row.id),
            ),
          )
          .returning();
        const updatedRow = updated[0];
        if (updatedRow === undefined) {
          throw new Error("reviewer_session rebind update returned no row");
        }
        return { ok: true, value: updatedRow };
      });
    },
  };
}
