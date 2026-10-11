// Which Brief a session request names. The read and the writes both resolve
// through here, so a stale tab lands on the same Brief whichever verb it uses.
import {
  createArtifactStore,
  type AppDatabase,
  type BriefRowId,
} from "persistence";
import type { PullRequestAccess } from "../../../../../access/types";
import type { BriefSpan } from "../schemas";

/**
 * The Brief a request names, never "the newest Brief": a stale tab must keep
 * writing to the Brief it is looking at, not be redirected into an unseen
 * session.
 */
export interface SessionTarget {
  readonly briefId: BriefRowId;
  readonly headIndex: number;
}

/** The Brief `span` names on the row the access step loaded. */
export async function findSessionTarget(
  handle: AppDatabase,
  access: PullRequestAccess,
  span: BriefSpan,
): Promise<SessionTarget | undefined> {
  // Lean span listing, never `briefs.get`: the row id is all the session
  // needs, and the body is the one column worth not loading.
  const briefs = await createArtifactStore(
    handle,
    access.rowScope,
  ).briefs.listForPullRequest(access.row.id);
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
