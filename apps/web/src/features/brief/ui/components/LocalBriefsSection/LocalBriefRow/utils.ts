import type { LocalBriefSummary } from "contract";

const SHORT_SHA_LENGTH = 7;

/** The revision a file artifact describes: a delta's pair of short shas, a brief's one. */
export function describeLocalBriefRevision(brief: LocalBriefSummary): string {
  const spansTwo =
    brief.artifactKind === "delta" &&
    brief.baselineSha !== undefined &&
    brief.headSha !== undefined;
  if (spansTwo) {
    const from = brief.baselineSha?.slice(0, SHORT_SHA_LENGTH);
    const to = brief.headSha?.slice(0, SHORT_SHA_LENGTH);
    return `${from} \u2192 ${to}`;
  }
  return brief.sha.slice(0, SHORT_SHA_LENGTH);
}
