// The `auth_session` boundary, the PRE-TENANT resolver: a session holds no
// installation, the globally UNIQUE `session_token_hash` is the key, and the
// request's repository names the tenant. The row carries NO credential
// material: the GitHub pair lives on the `github_grant` row it references,
// so resolution JOINs the grant and deletes orphan-clean it in the same tx.
import { eq } from "drizzle-orm";
import { type AppDatabase, internal } from "../db/handle";
import { githubGrant } from "../schema/github-grant";
import { authSession } from "../schema/auth-session";
import type { AuthSessionRow } from "../stores/tenant";
import { type GithubGrantRow, deleteOrphanedGrants } from "./grant";

// ---------------------------------------------------------------------------
// The surface.
// ---------------------------------------------------------------------------

/** A resolved session with the grant it references (one JOINed query). */
export interface SessionWithGrant {
  readonly session: AuthSessionRow;
  readonly grant: GithubGrantRow;
}

export interface SessionAuth {
  /** By the globally-unique hash, JOINed to the grant; absence is `undefined`. */
  findSession(sessionTokenHash: string): Promise<SessionWithGrant | undefined>;
  /** Delete by hash; the grant dies with its last referent. Returns rows deleted. */
  deleteSession(sessionTokenHash: string): Promise<number>;
  /** Mirror the grant's rotated `refresh_expires_at`; returns rows touched. */
  setExpiresAt(sessionTokenHash: string, expiresAt: Date): Promise<number>;
}

/** The hash-keyed resolver over the opaque `AppDatabase`; never ctx-bound. */
export function createSessionAuth(handle: AppDatabase): SessionAuth {
  const db = internal(handle);

  return {
    async findSession(sessionTokenHash) {
      const rows = await db
        .select({ session: authSession, grant: githubGrant })
        .from(authSession)
        .innerJoin(githubGrant, eq(authSession.grantId, githubGrant.id))
        .where(eq(authSession.sessionTokenHash, sessionTokenHash))
        .limit(1);
      return rows[0];
    },

    async deleteSession(sessionTokenHash) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .delete(authSession)
          .where(eq(authSession.sessionTokenHash, sessionTokenHash))
          .returning({ grantId: authSession.grantId });
        await deleteOrphanedGrants(
          tx,
          rows.map((row) => row.grantId),
        );
        return rows.length;
      });
    },

    async setExpiresAt(sessionTokenHash, expiresAt) {
      const rows = await db
        .update(authSession)
        .set({ expiresAt })
        .where(eq(authSession.sessionTokenHash, sessionTokenHash))
        .returning({ id: authSession.id });
      return rows.length;
    },
  };
}
