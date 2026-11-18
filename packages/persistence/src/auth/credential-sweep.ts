// The hourly sweep's credential half; `sweepExpiredSessions` runs first, so
// an expired session no longer holds its grant. A grant with no live referent
// (`buildNoLiveReferentConditions`, the rule `deleteOrphanedGrants` settles
// by) that a dead token still holds dies with its sealed pair, and the token
// keeps its row with a NULL `grant_id`. A grant no row references dies once it
// is `UNREFERENCED_GRANT_GRACE_DAYS` old. A token revoked or expired more than
// `REVOKED_TOKEN_RETENTION_DAYS` ago is deleted.
import { and, eq, exists, inArray, lt, or, type SQL } from "drizzle-orm";
import { type AppDatabase, type AppDrizzle, internal } from "../db/handle";
import { apiToken } from "../schema/api-token";
import { githubGrant } from "../schema/github-grant";
import {
  buildNoLiveReferentConditions,
  deleteOrphanedGrants,
  type OrphanedGrantSink,
} from "./grant";

const CREDENTIAL_SWEEP_BATCH_SIZE = 500;
/** A dead token row stays listable this long, then the sweep deletes it. */
const REVOKED_TOKEN_RETENTION_DAYS = 30;
/**
 * Outlasts any caller that inserts a grant and its first referent in separate
 * transactions, so the sweep never takes a grant about to be linked.
 */
const UNREFERENCED_GRANT_GRACE_DAYS = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Delete every dead grant, then every token past its retention, across every
 * user. Each batch is its own transaction and hands its orphaned grants to
 * `onOrphaned` once committed. Writes no audit row: a dead credential grants
 * nothing and belongs to neither audit world. Returns token rows deleted.
 */
export async function sweepDeadCredentials(
  handle: AppDatabase,
  now: Date,
  onOrphaned: OrphanedGrantSink,
): Promise<number> {
  const db = internal(handle);
  await deleteDeadGrants(db, now, onOrphaned);
  return deleteRetiredTokens(db, now, onOrphaned);
}

function buildDeadGrantCondition(
  executor: AppDrizzle,
  now: Date,
): SQL | undefined {
  const hasToken = executor
    .select({ one: apiToken.id })
    .from(apiToken)
    .where(eq(apiToken.grantId, githubGrant.id));
  const graceMs = UNREFERENCED_GRANT_GRACE_DAYS * MS_PER_DAY;
  const graceCutoff = new Date(now.getTime() - graceMs);
  const isPastGrace = lt(githubGrant.createdAt, graceCutoff);

  return and(
    ...buildNoLiveReferentConditions(executor),
    or(exists(hasToken), isPastGrace),
  );
}

/**
 * Lock order is tokens, then grants, each table by id, as on every path: the
 * delete sets the dead tokens' `grant_id` to NULL. The delete re-checks the
 * condition, so a token minted while the batch waited keeps its grant.
 */
async function deleteDeadGrants(
  db: AppDrizzle,
  now: Date,
  onOrphaned: OrphanedGrantSink,
): Promise<void> {
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: githubGrant.id })
        .from(githubGrant)
        .where(buildDeadGrantCondition(tx, now))
        .orderBy(githubGrant.id)
        .limit(CREDENTIAL_SWEEP_BATCH_SIZE);
      if (candidates.length === 0) {
        return { picked: 0, rows: [] };
      }

      const grantIds = candidates.map((row) => row.id);
      await tx
        .select({ id: apiToken.id })
        .from(apiToken)
        .where(inArray(apiToken.grantId, grantIds))
        .orderBy(apiToken.id)
        .for("update");
      await tx
        .select({ id: githubGrant.id })
        .from(githubGrant)
        .where(inArray(githubGrant.id, grantIds))
        .orderBy(githubGrant.id)
        .for("update");
      const rows = await tx
        .delete(githubGrant)
        .where(
          and(
            inArray(githubGrant.id, grantIds),
            buildDeadGrantCondition(tx, now),
          ),
        )
        .returning({
          id: githubGrant.id,
          ghTokenCiphertext: githubGrant.ghTokenCiphertext,
          keyRef: githubGrant.keyRef,
        });
      return { picked: candidates.length, rows };
    });
    onOrphaned(batch.rows);
    if (batch.picked < CREDENTIAL_SWEEP_BATCH_SIZE) {
      return;
    }
  }
}

async function deleteRetiredTokens(
  db: AppDrizzle,
  now: Date,
  onOrphaned: OrphanedGrantSink,
): Promise<number> {
  const cutoffMs = now.getTime() - REVOKED_TOKEN_RETENTION_DAYS * MS_PER_DAY;
  const cutoff = new Date(cutoffMs);
  const isRetired = or(
    lt(apiToken.revokedAt, cutoff),
    lt(apiToken.expiresAt, cutoff),
  );
  let deleted = 0;

  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: apiToken.id })
        .from(apiToken)
        .where(isRetired)
        .orderBy(apiToken.id)
        .limit(CREDENTIAL_SWEEP_BATCH_SIZE)
        .for("update");
      if (locked.length === 0) {
        return { picked: 0, count: 0, orphaned: [] };
      }

      const lockedIds = locked.map((row) => row.id);
      const rows = await tx
        .delete(apiToken)
        .where(and(inArray(apiToken.id, lockedIds), isRetired))
        .returning({ grantId: apiToken.grantId });
      const grantIds = rows.flatMap((row) =>
        row.grantId === null ? [] : [row.grantId],
      );
      const orphaned = await deleteOrphanedGrants(tx, grantIds);
      return { picked: locked.length, count: rows.length, orphaned };
    });
    deleted += batch.count;
    onOrphaned(batch.orphaned);
    if (batch.picked < CREDENTIAL_SWEEP_BATCH_SIZE) {
      return deleted;
    }
  }
}
