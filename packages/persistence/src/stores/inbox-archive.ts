// The per-reviewer archive of one Inbox row, ctx-bound like every write.
// The parent is verified against the scope inside the transaction, and the
// anchor is the latest brief's head read in that same transaction.
import { and, desc, eq } from "drizzle-orm";
import { type AppDatabase, internal } from "../db/handle";
import { brief } from "../schema/brief";
import { inboxArchive } from "../schema/inbox-archive";
import { pullRequest } from "../schema/pull-request";
import { resolveScope, type RowScope } from "./scope";
import type { ScopeContext } from "./scope-context";
import type { PullRequestRowId, ReviewerId } from "../types";

/**
 * Both writes answer false, and write nothing, when the pull request is
 * outside the scope.
 */
export interface InboxArchiveStore {
  /**
   * Archive the pull request for `reviewerId`, anchored on the latest
   * brief's head (none when no brief exists yet); archiving again moves the
   * anchor.
   */
  set(
    pullRequestId: PullRequestRowId,
    reviewerId: ReviewerId,
  ): Promise<boolean>;
  /** Remove the reviewer's archive; a row that was never archived is fine. */
  clear(
    pullRequestId: PullRequestRowId,
    reviewerId: ReviewerId,
  ): Promise<boolean>;
}

type Db = ReturnType<typeof internal>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function isInScope(
  tx: Tx,
  scope: RowScope,
  pullRequestId: PullRequestRowId,
): Promise<boolean> {
  const parents = await tx
    .select({ id: pullRequest.id })
    .from(pullRequest)
    .where(and(scope.matchesPullRequest(), eq(pullRequest.id, pullRequestId)))
    .limit(1);
  return parents[0] !== undefined;
}

async function readLatestHead(
  tx: Tx,
  pullRequestId: PullRequestRowId,
): Promise<string | null> {
  const latest = await tx
    .select({ headSha: brief.headSha })
    .from(brief)
    .where(eq(brief.pullRequestId, pullRequestId))
    .orderBy(desc(brief.headIndex), desc(brief.id))
    .limit(1);
  return latest[0]?.headSha ?? null;
}

export function createInboxArchiveStore(
  handle: AppDatabase,
  ctx: ScopeContext,
): InboxArchiveStore {
  const db = internal(handle);
  const scope = resolveScope(ctx);

  return {
    async set(pullRequestId, reviewerId) {
      return db.transaction(async (tx) => {
        if (!(await isInScope(tx, scope, pullRequestId))) {
          return false;
        }
        const headSha = await readLatestHead(tx, pullRequestId);
        await tx
          .insert(inboxArchive)
          .values({
            installationId: scope.installationId,
            pullRequestId,
            reviewerId,
            headSha,
          })
          .onConflictDoUpdate({
            target: [
              inboxArchive.installationId,
              inboxArchive.pullRequestId,
              inboxArchive.reviewerId,
            ],
            set: { headSha, createdAt: new Date() },
          });
        return true;
      });
    },

    async clear(pullRequestId, reviewerId) {
      return db.transaction(async (tx) => {
        if (!(await isInScope(tx, scope, pullRequestId))) {
          return false;
        }
        await tx
          .delete(inboxArchive)
          .where(
            and(
              scope.matchesChild(
                inboxArchive.installationId,
                inboxArchive.pullRequestId,
              ),
              eq(inboxArchive.pullRequestId, pullRequestId),
              eq(inboxArchive.reviewerId, reviewerId),
            ),
          );
        return true;
      });
    },
  };
}
