// The ONE deliberately unscoped read in this package: url-box rows are
// instance-visible, so a viewer who proved GitHub access to the repo may open
// a brief someone else on this instance pasted. It returns an OWNER, never a
// row — the caller binds a ctx to that owner and every later read goes back
// through the normal scope boundary.
//
// Writes, deletion, and the personal list stay owner-bound and never call
// this. Neither does a request the read gate cleared on the operator PAT: a
// reader who proved nothing may open only what they pasted themselves.
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
