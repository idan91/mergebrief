import type { RepoId } from "persistence";

/** Per-session open-PR list key: one list serves every PR of the repo. */
export function buildOpenPullsCacheKey(input: {
  readonly sessionTokenHash: string;
  readonly repoId: RepoId;
}): string {
  return `${input.sessionTokenHash}:${String(input.repoId)}`;
}
