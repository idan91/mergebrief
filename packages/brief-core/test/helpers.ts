import {
  RevisionNarrativeSkipReasons,
  type Brief,
  type DeltaBrief,
  type RevisionNarrative,
  type RevisionNarrativeSkipped,
} from "../src/types";

const pr = {
  repo: "o/r",
  number: 1,
  title: "t",
  url: "https://github.com/o/r/pull/1",
  sha: "deadbeef",
  description: "d",
};

const generation = {
  provider: "anthropic",
  model: "claude-opus-4-8",
  effort: "medium",
} as const;

const changeGroup = {
  id: "g1",
  title: "g title",
  summary: "g",
  dominantCategory: "bugfix",
  secondaryCategories: [],
  uncertain: false,
  uncertainBetween: [],
} as const;

const chunk = {
  id: "c1",
  changeGroupId: "g1",
  file: "a.ts",
  concern: "implementation",
  role: "core",
  loc: { added: 1, deleted: 0 },
  addedRanges: [{ start: 5, end: 5 }],
  removedRanges: [],
  riskSurface: ["mutates-state"],
} as const;

export function makeValidBrief(): Brief {
  return structuredClone({
    pr,
    index: 1,
    commitRange: { base: "base0000", head: "deadbeef", commitCount: 2 },
    generation,
    summary: "s",
    changeGroups: [changeGroup],
    chunks: [chunk],
    concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
  }) as Brief;
}

const secondChunk = { ...chunk, id: "c2", changeGroupId: "g2", file: "b.ts" };

export function makeTwoGroupBrief(): Brief {
  return {
    ...makeValidBrief(),
    changeGroups: [structuredClone(changeGroup), { ...changeGroup, id: "g2" }],
    chunks: [structuredClone(chunk), structuredClone(secondChunk)],
  } as Brief;
}

export function makeValidDeltaBrief(): DeltaBrief {
  return structuredClone({
    pr,
    baselineSha: "1111111",
    headSha: "2222222",
    baselineIndex: 1,
    headIndex: 2,
    generation,
    summary: "since you last looked, the author added a test",
    commentsAddressed: "addresses the request to add a test",
    changedGroups: [changeGroup],
    chunks: [
      {
        ...chunk,
        summary: "adds a unit test for the fix",
        addressesComments: ["101"],
      },
    ],
    wholePrImpact: "completes the original intent",
  }) as DeltaBrief;
}

export function makeValidRevisionNarrative(): RevisionNarrative {
  return structuredClone({
    artifactKind: "revisionNarrative",
    pr,
    prevHeadSha: "prev0000",
    headSha: "deadbeef",
    prevIndex: 1,
    headIndex: 2,
    generation,
    overview: "This revision tightens error handling.",
    chunks: [
      {
        id: "rc1",
        briefChangeGroupId: "g1",
        file: "a.ts",
        addedRanges: [{ start: 5, end: 6 }],
        removedRanges: [],
        summary: "wraps the call in a guard",
      },
    ],
  }) as RevisionNarrative;
}

export function makeSkippedRevisionNarrative(): RevisionNarrativeSkipped {
  return {
    artifactKind: "revisionNarrativeSkipped",
    pr: structuredClone(pr),
    prevHeadSha: "prev0000",
    headSha: "deadbeef",
    prevIndex: 1,
    headIndex: 2,
    skipped: RevisionNarrativeSkipReasons.SPAN_TOO_LARGE,
  };
}
