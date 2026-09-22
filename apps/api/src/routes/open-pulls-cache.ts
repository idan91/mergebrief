import type { RepoId } from "persistence";

/** Per-session open-PR list TTL: the stack is navigation, a minute stale is fine. */
export const OPEN_PULLS_CACHE_TTL_MS = 60 * 1000;

/** Per-session open-PR list key: one list serves every PR of the repo. */
export function buildOpenPullsCacheKey(input: {
  readonly sessionTokenHash: string;
  readonly repoId: RepoId;
}): string {
  return `${input.sessionTokenHash}:${String(input.repoId)}`;
}
