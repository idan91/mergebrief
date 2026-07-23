// The reviewer-session auth seam (BRIEF-2 stage 6, PR C — ADR 0016 #4 + ADR
// 0018 D11, re-anchored by D15/BRIEF-40). This is the PRE-TENANT resolver:
// unlike `forTenant(db, ctx)`, nothing here is bound to an `installation_id`.
// It CANNOT be — session resolution is the authN primitive that PRECEDES
// tenant scoping. You cannot know the installation until you have resolved
// the session, and the globally UNIQUE `session_token_hash` (a high-entropy
// random cookie token, stored only as its SHA-256) is exactly what tells you
// it. So these functions are keyed by that hash, not by ctx — the same trust
// shape as the webhook route deriving its tenant from the signed payload's
// `installation.id`: the lookup PRODUCES the tenant, it is not scoped by one.
//
// Since D15 the session row carries NO credential material — the GitHub pair
// lives on the `github_grant` row it references, and rotation lives in
// `grantAuth.refreshGrant` (one CAS for both presentation channels).
// Resolution therefore JOINS the grant so the api layer gets both halves in
// one query; deletes orphan-clean the grant in the same transaction.
import { and, eq } from "drizzle-orm";
import { type AppDatabase, internal } from "../db/handle";
import { githubGrant } from "../schema/github-grant";
import { reviewerSession } from "../schema/reviewer-session";
import type { ReviewerSessionRow } from "../stores/tenant";
import type { InstallationId, Result, ValueOf } from "../types";
import { type GithubGrantRow, deleteOrphanedGrants } from "./grant";

// ---------------------------------------------------------------------------
// Errors — expected failures. Programmer errors still `throw`.
// ---------------------------------------------------------------------------

export const SessionAuthErrorCode = {
  /** No session row for the given `session_token_hash`. */
  NOT_FOUND: "not-found",
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

/** A resolved session with the grant it references (one JOINed query). */
export interface SessionWithGrant {
  readonly session: ReviewerSessionRow;
  readonly grant: GithubGrantRow;
}

export interface SessionAuth {
  /**
   * Plain SELECT by the globally-unique hash, JOINed to the grant — the fast
   * path AND the tenant resolver (its `installation_id` is what scopes every
   * subsequent query). Absence is a normal `undefined`.
   */
  findSession(sessionTokenHash: string): Promise<SessionWithGrant | undefined>;
  /**
   * Delete by hash (logout / refresh-failure cleanup). ONE transaction with
   * the D15 orphan-clean: if this was the grant's last referent, the grant
   * dies too. Returns session rows deleted.
   */
  deleteSession(sessionTokenHash: string): Promise<number>;
  /**
   * Mirror the grant's rotated `refresh_expires_at` onto the session's own
   * `expires_at` (D11 semantics: session lifetime tracks the refresh token).
   * A plain idempotent value write — no lock needed; called by the cookie
   * channel after a successful `refreshGrant`. Returns rows touched.
   */
  setExpiresAt(sessionTokenHash: string, expiresAt: Date): Promise<number>;
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
        .select({ session: reviewerSession, grant: githubGrant })
        .from(reviewerSession)
        .innerJoin(githubGrant, eq(reviewerSession.grantId, githubGrant.id))
        .where(eq(reviewerSession.sessionTokenHash, sessionTokenHash))
        .limit(1);
      return rows[0];
    },

    async deleteSession(sessionTokenHash) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .delete(reviewerSession)
          .where(eq(reviewerSession.sessionTokenHash, sessionTokenHash))
          .returning({ grantId: reviewerSession.grantId });
        await deleteOrphanedGrants(
          tx,
          rows.map((row) => row.grantId),
        );
        return rows.length;
      });
    },

    async setExpiresAt(sessionTokenHash, expiresAt) {
      const rows = await db
        .update(reviewerSession)
        .set({ expiresAt })
        .where(eq(reviewerSession.sessionTokenHash, sessionTokenHash))
        .returning({ id: reviewerSession.id });
      return rows.length;
    },

    async rebindInstallation(sessionTokenHash, installationId) {
      return db.transaction(async (tx) => {
        // FOR UPDATE: serialize a rebinding against a concurrent rebind of
        // THIS session (both mutate the one row).
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
