// The `auth_session` boundary, the PRE-TENANT resolver and every write to the
// table: a session holds no installation, so no tenant scope reaches it. The
// globally UNIQUE `session_token_hash` keys one session, the reviewer keys
// all of them. The row carries NO credential material: the GitHub pair lives
// on the `github_grant` row it references, so resolution JOINs the grant and
// every delete orphan-cleans it in the same tx.
import { type SQL, eq } from "drizzle-orm";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { githubGrant } from "../schema/github-grant";
import { authSession } from "../schema/auth-session";
import type { GrantRowId, ReviewerId } from "../types";
import { type GithubGrantRow, deleteOrphanedGrants } from "./grant";

export type AuthSessionRow = typeof authSession.$inferSelect;

export interface SessionCreateInput {
  readonly sessionTokenHash: string;
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin?: string;
  /** The GitHub credential pair lives on the grant row, link, never copy. */
  readonly grantId: GrantRowId;
  readonly expiresAt: Date;
}

// ---------------------------------------------------------------------------
// The surface.
// ---------------------------------------------------------------------------

/** A resolved session with the grant it references (one JOINed query). */
export interface SessionWithGrant {
  readonly session: AuthSessionRow;
  readonly grant: GithubGrantRow;
}

export interface SessionAuth {
  /** Insert at sign-in, linking the grant the caller just created. */
  createSession(input: SessionCreateInput): Promise<AuthSessionRow>;
  /** By the globally-unique hash, JOINed to the grant; absence is `undefined`. */
  findSession(sessionTokenHash: string): Promise<SessionWithGrant | undefined>;
  /** Delete by hash; the grant dies with its last referent. Returns rows deleted. */
  deleteSession(sessionTokenHash: string): Promise<number>;
  /**
   * Delete every session the reviewer holds; each grant dies with its last
   * referent, so one an API token still links survives. Returns rows deleted.
   */
  deleteSessionsForReviewer(reviewerId: ReviewerId): Promise<number>;
  /** Mirror the grant's rotated `refresh_expires_at`; returns rows touched. */
  setExpiresAt(sessionTokenHash: string, expiresAt: Date): Promise<number>;
}

/** The hash-keyed resolver over the opaque `AppDatabase`; never ctx-bound. */
export function createSessionAuth(handle: AppDatabase): SessionAuth {
  const db = internal(handle);

  return {
    async createSession(input) {
      const rows = await db
        .insert(authSession)
        .values({
          sessionTokenHash: input.sessionTokenHash,
          reviewerId: input.reviewerId,
          reviewerLogin: input.reviewerLogin,
          grantId: input.grantId,
          expiresAt: input.expiresAt,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error("auth_session insert returned no row");
      }
      return row;
    },

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
      return db.transaction(async (tx) =>
        deleteSessionsWhere(
          tx,
          eq(authSession.sessionTokenHash, sessionTokenHash),
        ),
      );
    },

    async deleteSessionsForReviewer(reviewerId) {
      return db.transaction(async (tx) =>
        deleteSessionsWhere(tx, eq(authSession.reviewerId, reviewerId)),
      );
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

/** Must run inside the caller's transaction: the orphan-clean shares it. */
async function deleteSessionsWhere(
  tx: AppDrizzle,
  where: SQL,
): Promise<number> {
  const rows = await tx
    .delete(authSession)
    .where(where)
    .returning({ grantId: authSession.grantId });
  await deleteOrphanedGrants(
    tx,
    rows.map((row) => row.grantId),
  );
  return rows.length;
}
