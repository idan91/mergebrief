// Which Brief a session request names. The read and the writes both resolve
// through here, so a stale tab lands on the same Brief whichever verb it uses.
import {
  createArtifactStore,
  createTenantRepository,
  type BriefRowId,
  type RepoId,
  type ScopeContext,
} from "persistence";
import type { AuthRouteDeps } from "../../../../auth/session/types";
import type { BriefSpan } from "../schemas";

/**
 * The PR and the Brief a request names, never "the newest Brief". The write
 * routes resolve the same way the read does: a stale tab must keep writing to
 * the Brief it is looking at, not be redirected into an unseen session.
 */
export interface SessionTarget {
  readonly briefId: BriefRowId;
  readonly headIndex: number;
}

export async function resolveSessionTarget(
  deps: AuthRouteDeps,
  ctx: ScopeContext,
  repoId: RepoId,
  prNumber: number,
  span: BriefSpan,
): Promise<SessionTarget | undefined> {
  const pr = await createTenantRepository(
    deps.handle,
    ctx,
  ).pullRequests.getByNumber(repoId, prNumber);
  if (pr === undefined) {
    return undefined;
  }
  // Lean span listing, never `briefs.get`: the row id is all the session
  // needs, and the body is the one column worth not loading.
  const briefs = await createArtifactStore(
    deps.handle,
    ctx,
  ).briefs.listForPullRequest(pr.id);
  const current = briefs.find(
    (row) => row.baseSha === span.base && row.headSha === span.head,
  );
  if (current === undefined) {
    return undefined;
  }
  return {
    briefId: current.id,
    headIndex: current.headIndex,
  };
}
