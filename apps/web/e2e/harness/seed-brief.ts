import { Concerns, Roles, type Brief } from "brief-core/types";
import { ChangeGroupCategories } from "types/reviews";

export const SEED_ORIGIN = {
  provider: "stub",
  model: "stub",
  effort: "low",
} as const;

const SEED_GROUP_ID = "g1";
const SEED_FILE = "README.md";

export interface SeedBriefInput {
  readonly repoSlug: string;
  readonly prNumber: number;
  readonly title: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headIndex: number;
  readonly commitCount: number;
}

/** The smallest Brief the write check accepts: one group holding one chunk. */
export function buildSeedBrief(input: SeedBriefInput): Brief {
  return {
    pr: {
      repo: input.repoSlug,
      number: input.prNumber,
      title: input.title,
      url: `https://github.com/${input.repoSlug}/pull/${String(input.prNumber)}`,
      sha: input.headSha,
      description: "",
    },
    index: input.headIndex,
    commitRange: {
      base: input.baseSha,
      head: input.headSha,
      commitCount: input.commitCount,
    },
    generation: { ...SEED_ORIGIN },
    summary: input.title,
    changeGroups: [
      {
        id: SEED_GROUP_ID,
        title: input.title,
        summary: input.title,
        dominantCategory: ChangeGroupCategories.BUGFIX,
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [
      {
        id: "c1",
        changeGroupId: SEED_GROUP_ID,
        file: SEED_FILE,
        concern: Concerns.DOC,
        role: Roles.SUPPORTING,
        loc: { added: 1, deleted: 0 },
        addedRanges: [{ start: 1, end: 1 }],
        removedRanges: [],
        riskSurface: [],
      },
    ],
    concernView: [{ concern: Concerns.DOC, added: 1, deleted: 0 }],
  };
}
