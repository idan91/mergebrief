import type { LocalBriefSummary } from "contract";
import { ChangeGroupCategories } from "types";
import { Concerns, Roles } from "brief-core/types";
import { type RowRef, RowRefKinds } from "../model/expansion/types";
import { type Brief, type BriefChunk } from "../model/types";

/**
 * Hand-built brief used by the screen characterization suite (and reusable by
 * store/receipt tests). Small but exercises the critical couplings: an
 * uncertain group, one core chunk with a risk flag, one supporting chunk.
 */
export const briefFixture: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 42,
    title: "Fixture: tighten the cross-param leak",
    url: "https://example.com/pr/42",
    sha: "abcdef1234567890",
    description: "Fixture PR description.",
  },
  summary: "Fixture brief summary.",
  index: 1,
  changeGroups: [
    {
      id: "g1",
      title: "Fix the cross-param leak",
      summary: "Tightens validation on the shared param path.",
      dominantCategory: ChangeGroupCategories.BUGFIX,
      secondaryCategories: [],
      uncertain: true,
      uncertainBetween: [
        ChangeGroupCategories.BUGFIX,
        ChangeGroupCategories.LOGIC_REFACTOR,
      ],
    },
  ],
  chunks: [
    {
      id: "chunk-a",
      changeGroupId: "g1",
      file: "src/leak.ts",
      concern: Concerns.IMPLEMENTATION,
      role: Roles.CORE,
      loc: { added: 4, deleted: 1 },
      addedRanges: [{ start: 10, end: 13 }],
      removedRanges: [],
      riskSurface: ["no-tests", "comment-contradicts-code"],
      riskNotes: [
        {
          attr: "comment-contradicts-code",
          note: "comment says the param is optional (L10), code throws when absent (L12)",
        },
      ],
      summary: "Core chunk for the fix.",
      diff: [
        { kind: "hunk", content: "@@ -9,2 +9,5 @@" },
        { kind: "ctx", content: "const a = 1;", oldLine: 9, newLine: 9 },
        { kind: "add", content: "validate(a);", newLine: 10 },
      ],
    },
    {
      id: "chunk-b",
      changeGroupId: "g1",
      file: "src/leak.test.ts",
      concern: Concerns.TEST,
      role: Roles.SUPPORTING,
      loc: { added: 6, deleted: 0 },
      addedRanges: [{ start: 1, end: 6 }],
      removedRanges: [],
      riskSurface: [],
    },
  ],
  concernView: [
    { concern: Concerns.IMPLEMENTATION, added: 4, deleted: 1 },
    { concern: Concerns.TEST, added: 6, deleted: 0 },
  ],
};

export const briefSummaryFixture: LocalBriefSummary = {
  id: "fixture-brief-1",
  artifactKind: "brief",
  repo: briefFixture.pr.repo,
  number: briefFixture.pr.number,
  title: briefFixture.pr.title,
  sha: briefFixture.pr.sha,
  index: 1,
};

/** Row refs in order: a number is that base row, `expanded` is spliced context. */
export function makeRowRefs(
  entries: readonly (number | typeof RowRefKinds.EXPANDED)[],
): RowRef[] {
  return entries.map((entry) =>
    entry === RowRefKinds.EXPANDED
      ? { kind: RowRefKinds.EXPANDED }
      : { kind: RowRefKinds.BASE, baseIndex: entry },
  );
}

/** One added line at src/a.ts:10, where the conversation fixture puts its threads. */
export function makeChunk(): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: Concerns.IMPLEMENTATION,
    role: Roles.CORE,
    loc: { added: 1, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [{ kind: "add", content: "b", newLine: 10 }],
  };
}
