import type { RepoId, ScopeContext } from "persistence";

export type EvictConversation = (
  ctx: ScopeContext,
  repoId: RepoId,
  prNumber: number,
) => void;
