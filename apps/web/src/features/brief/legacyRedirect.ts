import type { BriefSearch } from "./compareState";
import type { LocalBriefSummary } from "./types";

export interface LegacyDeltaRedirect {
  briefId: string;
  search: BriefSearch;
}

/**
 * Migration/compatibility (ADR 0024 plan step 10): before this plan, a Delta
 * artifact's own id was a direct route target at `/briefs/$briefId` — Delta is
 * no longer a route target, it's the Compare: Your last review baseline on its
 * head Brief. A direct link to a Delta artifact's id now redirects to the
 * corresponding head Brief with `view=changes&compare=last-review`, which
 * renders the same content (`ChangesOnlyView`'s "Your last review" path).
 *
 * `null` when `briefId` isn't a Delta artifact (nothing to redirect — Brief
 * artifact links default via `resolveBriefSearch`'s fresh-arrival logic) or
 * when its head Brief can't be found locally (fall through to the existing
 * direct-render behavior rather than dead-ending the link).
 */
export function resolveLegacyDeltaRedirect(
  artifacts: LocalBriefSummary[],
  briefId: string,
): LegacyDeltaRedirect | null {
  const delta = artifacts.find(
    (artifact) => artifact.id === briefId && artifact.artifactKind === "delta",
  );
  if (!delta) return null;

  const headBrief = artifacts.find(
    (artifact) =>
      artifact.artifactKind === "brief" &&
      artifact.repo === delta.repo &&
      artifact.number === delta.number &&
      artifact.sha === delta.headSha,
  );
  if (!headBrief) return null;

  return {
    briefId: headBrief.id,
    search: { view: "changes", compare: "last-review" },
  };
}
