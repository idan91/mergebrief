// Which world a PR row on the per-PR route lives in. A credential's ctx is
// its own scope (tenant, or owner for an installation-less session), but the
// route's coordinates can name a row in EITHER world: an installation-bound
// viewer still owns the url-box briefs they pasted. The credential's world is
// tried first — the App door wins for rendering — and the url-box world is
// the fallback. Absence keeps the credential's ctx, so downstream misses
// produce the same uniform 404s they always did.
//
// The url-box fallback is INSTANCE-wide, not viewer-wide: a reader who proved
// GitHub access to the repo may open a brief another user on this instance
// pasted. Per-reviewer state is unaffected — the Review Session's natural key
// carries the reviewer, so two readers of one url-box brief keep separate
// sessions and drafts.
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
import type { AuthzEnv } from "../../authz";

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

/** The same resolution off the Hono variable bag. */
export async function resolvePrScopeFrom(
  c: Context<AuthzEnv>,
  handle: AppDatabase,
  prNumber: number,
): Promise<ScopeContext> {
  return resolvePrScope(
    handle,
    c.get("ctx"),
    c.get("session").reviewerId,
    c.get("repoId"),
    prNumber,
  );
}
