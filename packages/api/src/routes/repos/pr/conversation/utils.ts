import { isOwnerContext, type RepoId, type ScopeContext } from "persistence";

/**
 * ONE key builder for the cache and its eviction hook — they must agree.
 * The leading tag names which world the id belongs to, so an owner id and an
 * installation id of the same number can never collide on one cache entry.
 */
export function buildConversationCacheKey(
  ctx: ScopeContext,
  repoId: RepoId,
  prNumber: number,
): string {
  const scope = isOwnerContext(ctx)
    ? `owner:${String(ctx.ownerUserId)}`
    : `installation:${String(ctx.installationId)}`;
  return `${scope}:${String(repoId)}:${prNumber}`;
}
