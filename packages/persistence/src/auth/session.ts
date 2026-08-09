// The reviewer-session auth boundary. This is the PRE-TENANT resolver: nothing
// here is bound to an `installation_id` and it CANNOT be — session resolution
// PRECEDES tenant scoping. The globally UNIQUE `session_token_hash` (a
// high-entropy random cookie token, stored only as its SHA-256) is the key,
// and the lookup PRODUCES the tenant rather than being scoped by one.
//
// The session row carries NO credential material — the GitHub pair lives on
// the `github_grant` row it references, and rotation lives in
// `grantAuth.refreshGrant`. Resolution therefore JOINS the grant; deletes
// orphan-clean the grant in the same transaction.
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
   * the orphan-clean: if this was the grant's last referent, the grant dies
   * too. Returns session rows deleted.
   */
  deleteSession(sessionTokenHash: string): Promise<number>;
  /**
   * Mirror the grant's rotated `refresh_expires_at` onto the session's own
   * `expires_at` — session lifetime tracks the refresh token. A plain
   * idempotent value write, called by the cookie channel after a successful
   * `refreshGrant`. Returns rows touched.
   */
  setExpiresAt(sessionTokenHash: string, expiresAt: Date): Promise<number>;
  /**
   * Rebind the session to a DIFFERENT installation (multi-org switch). The
   * session row's `installation_id` IS the tenant stamp, so callers must
   * validate the target against the viewer's LIVE accessible set BEFORE
   * calling — this boundary only persists a pre-validated rebinding.
   * `SELECT … FOR UPDATE` by hash, then UPDATE gated by the locked row's OWN
   * `installation_id` + `id`, never by an unscoped caller argument. A vanished
   * row → `NOT_FOUND`.
   */
  rebindInstallation(
    sessionTokenHash: string,
    installationId: InstallationId,
  ): Promise<Result<ReviewerSessionRow, SessionAuthError>>;
}

/**
 * Build the pre-tenant, token-hash-keyed session resolver over the opaque
 * `AppDatabase`. Uses the in-package `internal()` unwrap; never exposes a raw
 * query surface, and is intentionally NOT ctx-bound (see the file header).
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
