import type { FetchedPr } from "../../../src/github/types";
import type { ChunkGeneration } from "../../../src/types";

/**
 * A two-file PR, src/a.ts and src/b.ts, and the push that added one line to
 * src/b.ts: the smallest PR an anchored run can carry one group of.
 */
export const wholeDiff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "@@ -0,0 +1,2 @@",
  "+a1",
  "+a2",
  "diff --git a/src/b.ts b/src/b.ts",
  "@@ -0,0 +1,3 @@",
  "+b1",
  "+b2",
  "+b3",
  "",
].join("\n");

export const incrementalDiff = [
  "diff --git a/src/b.ts b/src/b.ts",
  "@@ -1,2 +1,3 @@",
  " b1",
  " b2",
  "+b3",
  "",
].join("\n");

export const pr: FetchedPr = {
  locator: { owner: "o", repo: "r", number: 1 },
  meta: {
    title: "t",
    body: "d",
    url: "https://github.com/o/r/pull/1",
    sha: "head2000",
    baseSha: "base0000",
    commitCount: 2,
    files: [
      { path: "src/a.ts", additions: 2, deletions: 0 },
      { path: "src/b.ts", additions: 3, deletions: 0 },
    ],
  },
  diff: wholeDiff,
  links: [],
};

export const commitRange = {
  base: "base0000",
  head: "head2000",
  commitCount: 2,
};

export const noneIntentCheck = {
  ticketUrls: [],
  ticketTitles: [],
  specificity: "none",
  scopeNote: "",
  items: [],
  alignment: { read: "", goal: "", response: "" },
};

export function makeGroup(id: string, summary = "group summary"): unknown {
  return {
    id,
    title: `group ${id}`,
    summary,
    dominantCategory: "new-feature",
    secondaryCategories: [],
    uncertain: false,
    uncertainBetween: [],
  };
}

export function makeChunk(
  id: string,
  groupId: string,
  file: string,
  end: number,
  start = 1,
): ChunkGeneration {
  return {
    id,
    changeGroupId: groupId,
    file,
    concern: "implementation",
    role: "core",
    addedRanges: [{ start, end }],
    removedRanges: [],
    riskSurface: [],
  };
}
