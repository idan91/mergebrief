import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import { readInputFingerprint } from "brief-core";
import { SummaryMediaAnswerSchema, type Brief } from "brief-core/types";
import type { GenerateRequest, Generator } from "generators";
import {
  countPairGenerations,
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

async function runCanned(
  pairCase: PairCase,
  generator: Generator = makeCannedGenerator(),
): Promise<RevisionPair> {
  const briefOnly = {
    ...pairCase,
    narrativeProperties: [],
    deltaProperties: [],
  };
  const result = await runPairCase(briefOnly, generator, "medium", 1);
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

/** The authored Media cases; each description holds two mermaid diagrams. */
const MEDIA_CASES = [
  "pair-media-no-change",
  "pair-media-fast-forward",
  "pair-media-description-edit",
  "pair-media-fast-forward-multi-call",
];

/** Cases whose revised brief makes a Summary Media call after the stitch. */
const MEDIA_PICKING_CASES = [
  "pair-media-fast-forward",
  "pair-media-description-edit",
  "pair-media-fast-forward-multi-call",
];

const CANNED_MEDIA_ANSWER = { shown: [{ item: 1, position: "after-lede" }] };

/** The canned model, answering the Summary Media call with the first item. */
function makeMediaCannedGenerator(): Generator {
  const canned = makeCannedGenerator();
  return {
    origin: (effort) => canned.origin(effort),
    generate<S extends z.ZodType>(req: GenerateRequest<S>) {
      const schema: z.ZodType = req.schema;
      if (schema === SummaryMediaAnswerSchema) {
        return Promise.resolve(req.schema.parse(CANNED_MEDIA_ANSWER));
      }
      return canned.generate(req);
    },
  };
}

/** The case with its stored base Brief's fingerprint replaced. */
function stampBaseFingerprint(
  { pairCase, baseBrief }: StoredBaseCase,
  inputFingerprint: string,
): PairCase {
  const fixture = {
    ...pairCase.fixture,
    baseBrief: { ...baseBrief, inputFingerprint },
  };
  return { ...pairCase, fixture };
}

describe("the authored Media cases on the canned model", () => {
  it.each(MEDIA_CASES)("pass every pair property on %s", async (id) => {
    const { pairCase } = await loadSpanCase(id);

    const pair = await runCanned(pairCase, makeMediaCannedGenerator());

    expect(listFailedIds(pairCase, pair)).toEqual([]);
  });

  it.each(MEDIA_PICKING_CASES)(
    "fail the pick on %s when the Media call picks nothing",
    async (id) => {
      const { pairCase } = await loadSpanCase(id);

      const pair = await runCanned(pairCase);

      expect(listFailedIds(pairCase, pair)).toEqual(["summary-media-picked"]);
    },
  );

  it("fail the description edit when a stale fingerprint lets it carry", async () => {
    const loaded = await loadSpanCase("pair-media-description-edit");
    const { pr, repoContext } = loaded.pairCase.fixture.revised;
    const stale = stampBaseFingerprint(
      loaded,
      readInputFingerprint(pr, repoContext),
    );

    const pair = await runCanned(stale, makeMediaCannedGenerator());

    expect(listFailedIds(stale, pair)).toEqual([
      "input-fingerprint-moved",
      "summary-media-keys-name-items",
    ]);
  });

  it("fail the no-change carry when the base inputs differ", async () => {
    const loaded = await loadSpanCase("pair-media-no-change");
    const moved = stampBaseFingerprint(loaded, "0".repeat(64));

    const pair = await runCanned(moved, makeMediaCannedGenerator());

    expect(listFailedIds(moved, pair)).toEqual(["summary-media-carried"]);
  });

  it.each([
    ["pair-media-no-change", 0],
    ["pair-media-fast-forward", 2],
    ["pair-media-description-edit", 2],
  ])("count %s's brief and Summary Media calls", async (id, calls) => {
    const { pairCase } = await loadSpanCase(id);

    expect(countPairGenerations(pairCase)).toBe(calls);
  });
});
