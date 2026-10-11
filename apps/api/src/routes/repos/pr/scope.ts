// Which world a PR row on the per-PR route lives in. The route's coordinates
// can name a row in either world: an installation-bound reviewer still owns
// the url-box briefs they pasted. The credential's world is tried first, then
// the url-box world; absence keeps the credential's ctx, so a miss is the
// same uniform 404. The url-box fallback is INSTANCE-wide: a reader who
// proved GitHub access may open a brief another reviewer pasted, while the
// Review Session's natural key keeps sessions and drafts per reviewer.
import type { Context } from "hono";
import {
  createTenantRepository,
  isOwnerContext,
  resolveUrlBoxOwner,
  type AppDatabase,
  type RepoId,
  type ReviewerId,
  type ScopeContext,
} from "persistence";
import type { AuthzEnv } from "../../../access/types";

export async function resolvePrScope(
  handle: AppDatabase,
  ctx: ScopeContext,
  reviewerId: ReviewerId,
  repoId: RepoId,
  prNumber: number,
): Promise<ScopeContext> {
  if (!isOwnerContext(ctx)) {
    const tenantRow = await createTenantRepository(
      handle,
      ctx,
    ).pullRequests.getByNumber(repoId, prNumber);
    if (tenantRow !== undefined) {
      return ctx;
    }
  }
  const ownerUserId = await resolveUrlBoxOwner(
    handle,
    repoId,
    prNumber,
    reviewerId,
  );
  return ownerUserId === undefined ? ctx : { ownerUserId };
}

/**
 * The same resolution off the Hono variable bag. A request the gate passed on
 * the operator PAT skips the tenant probe entirely: the reader proved access
 * to nothing, so only their own url-box world is theirs to read.
 */
export async function resolvePrScopeFrom(
  c: Context<AuthzEnv>,
  handle: AppDatabase,
  prNumber: number,
): Promise<ScopeContext> {
  if (c.get("urlBoxOnly") === true) {
    return { ownerUserId: c.get("session").reviewerId };
  }
  return resolvePrScope(
    handle,
    c.get("ctx"),
    c.get("session").reviewerId,
    c.get("repoId"),
    prNumber,
  );
}
