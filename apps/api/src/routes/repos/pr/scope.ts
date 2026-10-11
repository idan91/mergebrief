// Which scope a PR row on the per-PR route lives in, for the handlers that
// still resolve it themselves: the per-PR access step owns the resolution.
import type { Context } from "hono";
import type {
  AppDatabase,
  RepoId,
  ReviewerId,
  ScopeContext,
} from "persistence";
import { resolvePullRequestScope } from "../../../access/pull-request";
import type { AuthzEnv } from "../../../access/types";

/** The row's scope, or `ctx` itself on a miss, so absence stays the uniform 404. */
export async function resolvePrScope(
  handle: AppDatabase,
  ctx: ScopeContext,
  reviewerId: ReviewerId,
  repoId: RepoId,
  prNumber: number,
): Promise<ScopeContext> {
  const resolved = await resolvePullRequestScope(handle, {
    repoScope: ctx,
    reviewerId,
    repoId,
    prNumber,
  });
  return resolved ?? ctx;
}

/**
 * The same resolution off the Hono variable bag. A request the gate passed on
 * the operator PAT skips the tenant probe entirely: the reader proved access
 * to nothing, so only their own URL rows are theirs to read.
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
