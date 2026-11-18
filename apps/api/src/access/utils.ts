import type { ReviewerId, ScopeContext } from "persistence";
import type { RepoWorld } from "../routes/installation-resolver";

/** The scope a repo's Installation addresses; none means the reader's own. */
export function deriveScopeContext(
  installation: RepoWorld,
  reviewerId: ReviewerId,
): ScopeContext {
  return installation.kind === "installation"
    ? { installationId: installation.installationId }
    : { ownerUserId: reviewerId };
}
