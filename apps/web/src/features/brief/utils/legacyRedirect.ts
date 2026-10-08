import type { BriefSearch } from "../comparison/compareState";
import { CompareParams } from "../comparison/types";
import type { LocalBriefSummary } from "../types";

export interface LegacyDeltaRedirect {
  briefId: string;
  search: BriefSearch;
}

/**
 * A Delta artifact id used to be a direct route target; it is now the
 * Compare: Your last review baseline on its head Brief, so such a link
 * redirects to that Brief with `view=changes&compare=last-review`.
 *
 * `null` when `briefId` isn't a Delta, its head Brief isn't local, or the head
 * Brief's `lastReview` availability doesn't bind THIS delta. Falling through
 * to direct render beats redirecting to a page whose normalization would
 * silently swap the baseline away from the delta.
 */
export function resolveLegacyDeltaRedirect(
  artifacts: LocalBriefSummary[],
  briefId: string,
): LegacyDeltaRedirect | null {
  const delta = artifacts.find(
    (artifact) => artifact.id === briefId && artifact.artifactKind === "delta",
  );
  if (!delta) {
    return null;
  }

  const headBrief = artifacts.find(
    (artifact) =>
      artifact.artifactKind === "brief" &&
      artifact.repo === delta.repo &&
      artifact.number === delta.number &&
      artifact.sha === delta.headSha,
  );
  if (headBrief?.comparisons?.lastReview?.deltaId !== delta.id) {
    return null;
  }

  return {
    briefId: headBrief.id,
    search: { view: "changes", compare: CompareParams.LAST_REVIEW },
  };
}
