// A deliberately unscoped read, named in AGENTS.md: a viewer who proved
// GitHub access to the repo may open a brief someone else here pasted. It
// returns an OWNER, never a row; every later read binds a ctx to that owner.
//
// Writes behind it land in that owner's world, but per-reviewer rows are
// keyed by the reviewer. Deletion, the personal list and a request the gate
// cleared on the operator PAT never call this.
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { type AppDatabase, internal } from "../db/handle";
import { pullRequest } from "../schema/pull-request";
import type { RepoId, ReviewerId } from "../types";

/**
 * The owner of the url-box row at these coordinates, or `undefined` when no
 * url-box row exists there. Two owners may hold a row for the same PR, so the
 * pick is deterministic: `preferOwner`'s own row first, then the oldest.
 */
export async function resolveUrlBoxOwner(
  handle: AppDatabase,
  repoId: RepoId,
  prNumber: number,
  preferOwner: ReviewerId,
): Promise<ReviewerId | undefined> {
  const rows = await internal(handle)
    .select({ ownerUserId: pullRequest.ownerUserId })
    .from(pullRequest)
    .where(
      and(
        isNull(pullRequest.installationId),
        eq(pullRequest.repoId, repoId),
        eq(pullRequest.prNumber, prNumber),
      ),
    )
    .orderBy(
      desc(sql`${pullRequest.ownerUserId} = ${preferOwner}`),
      asc(pullRequest.id),
    )
    .limit(1);
  return rows[0]?.ownerUserId ?? undefined;
}
