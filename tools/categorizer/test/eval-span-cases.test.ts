import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Brief } from "brief-core/types";
import {
  loadPairCases,
  runPairCase,
  type PairCase,
  type RevisionPair,
} from "../eval/pairs";
import { makeCannedGenerator } from "./canned-generator";

const PAIR_CASES_DIR = fileURLToPath(
  new URL("../eval/pair-cases", import.meta.url),
);

/** The five authored span cases; each stores a one-group-per-file base Brief. */
const AUTHORED_SPAN_CASES = [
  "pair-force-push-squash",
  "pair-force-push-amend",
  "pair-merge-main-noop",
  "pair-rebase-upstream-same-file",
  "pair-rebase-conflict-resolution",
];

/** Cases where a re-look takes every file once the base groups them as one. */
const CARRY_DEPENDS_ON_GROUPING: Record<string, readonly string[]> = {
  "pair-force-push-amend": ["carried-groups-survive"],
  "pair-rebase-upstream-same-file": [
    "carried-groups-survive",
    "carried-ranges-shift-routes.ts",
  ],
  "pair-rebase-conflict-resolution": ["carried-groups-survive"],
};

interface StoredBaseCase {
  pairCase: PairCase;
  baseBrief: Brief;
}

async function loadSpanCase(id: string): Promise<StoredBaseCase> {
  const loaded = await loadPairCases(PAIR_CASES_DIR, id);
  const pairCase = loaded.ok ? loaded.value[0] : undefined;
  const baseBrief = pairCase?.fixture.baseBrief;
  if (pairCase === undefined || baseBrief === undefined) {
    throw new Error(`pair case ${id} did not load with a base Brief`);
  }
  return { pairCase, baseBrief };
}

/** The stored base Brief with every chunk moved into its first group. */
function mergeIntoOneGroup(brief: Brief): Brief {
  const [first] = brief.changeGroups;
  if (first === undefined) {
    throw new Error("the base Brief has no group");
  }
  const chunks = brief.chunks.map((chunk) => ({
    ...chunk,
    changeGroupId: first.id,
  }));
  return { ...brief, changeGroups: [first], chunks };
}

async function runCanned(pairCase: PairCase): Promise<RevisionPair> {
  const briefOnly = {
    ...pairCase,
    narrativeProperties: [],
    deltaProperties: [],
  };
  const result = await runPairCase(
    briefOnly,
    makeCannedGenerator(),
    "medium",
    1,
  );
  const [pair] = result.pairs;
  if (pair === undefined) {
    throw new Error(`${pairCase.id}: ${result.failureMessages.join("; ")}`);
  }
  return pair;
}

function listFailedIds(pairCase: PairCase, pair: RevisionPair): string[] {
  return pairCase.properties
    .filter((property) => !property.check(pair))
    .map((property) => property.id);
}

describe("the authored span cases on the canned model", () => {
  it.each(AUTHORED_SPAN_CASES)("pass every pair property on %s", async (id) => {
    const { pairCase } = await loadSpanCase(id);

    const pair = await runCanned(pairCase);

    expect(listFailedIds(pairCase, pair)).toEqual([]);
  });

  it.each(Object.entries(CARRY_DEPENDS_ON_GROUPING))(
    "fail carry on %s with one base group",
    async (id, expectedFailures) => {
      const { pairCase, baseBrief } = await loadSpanCase(id);
      const fixture = {
        ...pairCase.fixture,
        baseBrief: mergeIntoOneGroup(baseBrief),
      };
      const oneGroup = { ...pairCase, fixture };

      const pair = await runCanned(oneGroup);

      const failed = listFailedIds(oneGroup, pair);
      expect(
        expectedFailures.every((failure) => failed.includes(failure)),
      ).toBe(true);
    },
  );
});
