// The commits MergeBrief has recorded for one pull request. Pure over the
// row and the lean span listings.
import type {
  BriefSpanRow,
  ComparisonSpanRow,
  PullRequestRow,
} from "persistence";

export type KnownCommits = ReadonlySet<string>;

export function collectKnownCommits(
  pr: Pick<PullRequestRow, "baseSha" | "githubHeadSha">,
  briefs: readonly Pick<BriefSpanRow, "baseSha" | "headSha">[],
  deltas: readonly ComparisonSpanRow[],
): KnownCommits {
  const known = new Set<string>();

  for (const sha of [pr.baseSha, pr.githubHeadSha]) {
    if (sha !== null) {
      known.add(sha);
    }
  }
  for (const span of briefs) {
    known.add(span.baseSha);
    known.add(span.headSha);
  }
  for (const span of deltas) {
    known.add(span.baselineSha);
    known.add(span.headSha);
  }

  return known;
}
