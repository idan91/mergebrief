// Which Brief a session request names, and the facts read off it. Both route
// files — the read and the writes — resolve through here, so a stale tab
// lands on the same Brief whichever verb it uses.
import {
  artifactStore,
  forTenant,
  type BriefRowId,
  type PullRequestRowId,
  type RepoId,
  type TenantContext,
} from "persistence";
import { z } from "zod";
import type { AuthRouteDeps } from "../../../auth/session";
import {
  readCarryFacts,
  UnreadableBriefError,
  type CarryFacts,
} from "./carry-facts";

export const prNumberSchema = z.coerce.number().int().positive();
const shaSchema = z.string().min(1);
export const spanQuerySchema = z.object({ base: shaSchema, head: shaSchema });
export type BriefSpan = z.infer<typeof spanQuerySchema>;

/**
 * The PR and the Brief a request names — never "the newest Brief". The write
 * routes resolve the same way the read does: a stale tab must keep writing to
 * the Brief it is looking at, not be redirected into an unseen session.
 */
export interface SessionTarget {
  readonly pullRequestId: PullRequestRowId;
  readonly briefId: BriefRowId;
  readonly headIndex: number;
}

export async function resolveSessionTarget(
  deps: AuthRouteDeps,
  ctx: TenantContext,
  repoId: RepoId,
  prNumber: number,
  span: BriefSpan,
): Promise<SessionTarget | undefined> {
  const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(
    repoId,
    prNumber,
  );
  if (pr === undefined) {
    return undefined;
  }
  // Lean span listing, never `briefs.get`: the row id is all the session
  // needs, and the body is the one column worth not loading.
  const briefs = await artifactStore(
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
    pullRequestId: pr.id,
    briefId: current.id,
    headIndex: current.headIndex,
  };
}

/**
 * Called only when a previous session exists — the parse the read defers.
 * Every arm that cannot state the Brief's facts throws: a missing row is the
 * same hazard as an unparseable one, because empty facts read as "nothing
 * fires any more".
 */
export async function loadCarryFacts(
  deps: AuthRouteDeps,
  ctx: TenantContext,
  target: SessionTarget,
  span: BriefSpan,
): Promise<CarryFacts> {
  const row = await artifactStore(deps.handle, ctx).briefs.get(
    target.pullRequestId,
    span.base,
    span.head,
  );
  // Identity, not existence: a different row under the same span is not the
  // Brief the caller named.
  if (row === undefined || row.id !== target.briefId) {
    throw new UnreadableBriefError("brief row vanished between reads");
  }
  return readCarryFacts(row.body);
}
