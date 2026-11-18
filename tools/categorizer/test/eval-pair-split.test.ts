import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseChangedRanges } from "brief-core";
import type { Brief } from "brief-core/types";
import {
  loadPairCases,
  planPairAnchoring,
  readPairSpan,
  type PairCase,
} from "../eval/pairs";
import { shiftsCarriedRanges } from "../eval/pair-cases/props";
import {
  DIFF_B,
  EXPECTED_TS,
  makePairJson,
  writePairCase,
} from "./pair-fixtures";
import { readPairSpanShapes } from "./hand-derived-span";

const PAIR_CASES_DIR = fileURLToPath(
  new URL("../eval/pair-cases", import.meta.url),
);

interface CarrySplit {
  readonly frozen: readonly string[];
  readonly reLook: readonly string[];
}

/** Every public fast-forward case: one PR base, and the push only added commits. */
const FAST_FORWARD_SPLITS: Record<string, CarrySplit> = {
  "pair-additive": { frozen: ["g1"], reLook: ["g2"] },
  "pair-ask-edit": { frozen: ["g1"], reLook: ["g2"] },
  "pair-boundary-restructure": { frozen: ["g1"], reLook: ["g2", "g3"] },
  "pair-intent-transition": { frozen: ["g1"], reLook: [] },
  "pair-meaning-changing": { frozen: ["g1"], reLook: ["g2"] },
  "pair-new-material": { frozen: ["g1", "g2"], reLook: [] },
  "pair-risk-add": { frozen: ["g1"], reLook: ["g2"] },
  "pair-risk-add-new-file": { frozen: ["g1"], reLook: ["g2"] },
  "pair-risk-remove": { frozen: ["g1"], reLook: ["g2"] },
  "pair-subtractive": { frozen: ["g1"], reLook: ["g2"] },
};

/** A previous Brief a model could have written: one group per file, its chunk on every changed line. */
function makeFileGroupBrief(pairCase: PairCase): Brief {
  const { base } = pairCase.fixture;
  const files = parseChangedRanges(base.pr.diff);
  return {
    pr: {
      repo: `${base.pr.locator.owner}/${base.pr.locator.repo}`,
      number: base.pr.locator.number,
      title: base.pr.meta.title,
      url: base.pr.meta.url,
      sha: base.commitRange.head,
      description: base.pr.meta.body,
    },
    index: 1,
    commitRange: base.commitRange,
    generation: { provider: "fixture", model: "fixture", effort: "medium" },
    summary: "s",
    changeGroups: files.map((file, index) => ({
      id: `g${index + 1}`,
      title: file.file,
      summary: file.file,
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    })),
    chunks: files.map((file, index) => ({
      id: `c${index + 1}`,
      changeGroupId: `g${index + 1}`,
      file: file.file,
      concern: "implementation",
      role: "core",
      loc: { added: 0, deleted: 0 },
      addedRanges: file.addedRanges,
      removedRanges: file.removedRanges,
      riskSurface: [],
    })),
    concernView: [],
  };
}

/** The force-push and base-move cases, each recording the span its capture read. */
const RECORDED_SPAN_SPLITS: Record<string, CarrySplit> = {
  "pair-force-push-squash": { frozen: ["g1", "g2", "g3", "g4"], reLook: [] },
  "pair-force-push-amend": { frozen: ["g1", "g3", "g4"], reLook: ["g2"] },
  "pair-merge-main-noop": { frozen: ["g1", "g2", "g3", "g4"], reLook: [] },
  "pair-rebase-upstream-same-file": {
    frozen: ["g1", "g2", "g3"],
    reLook: ["g4"],
  },
  "pair-rebase-conflict-resolution": {
    frozen: ["g2", "g3", "g4"],
    reLook: ["g1"],
  },
};

async function loadPublicPairCase(id: string): Promise<PairCase> {
  const loaded = await loadPairCases(PAIR_CASES_DIR, id);
  const pairCase = loaded.ok ? loaded.value[0] : undefined;
  if (pairCase === undefined) {
    throw new Error(`pair case ${id} did not load`);
  }
  return pairCase;
}

describe("the recorded-span pair cases' carry split", () => {
  it.each(Object.entries(RECORDED_SPAN_SPLITS))(
    "holds on %s",
    async (id, split) => {
      const pairCase = await loadPublicPairCase(id);

      const plan = planPairAnchoring(
        pairCase.fixture,
        makeFileGroupBrief(pairCase),
      );

      expect(pairCase.fixture.recordedSpan).toBeDefined();
      expect({
        frozen: plan.frozen.map((carry) => carry.group.id),
        reLook: plan.reLook.map((entry) => entry.id),
      }).toEqual(split);
    },
  );

  it("carries every group of the SvelteKit catch-up merge", async () => {
    const pairCase = await loadPublicPairCase("pair-real-sveltekit-2-0");
    const base = makeFileGroupBrief(pairCase);

    const plan = planPairAnchoring(pairCase.fixture, base);

    expect(plan.reLook).toEqual([]);
    expect(plan.frozen).toHaveLength(base.changeGroups.length);
  });

  it("moves routes.ts's carried chunk two lines down on the rebase", async () => {
    const pairCase = await loadPublicPairCase("pair-rebase-upstream-same-file");
    const base = makeFileGroupBrief(pairCase);
    const plan = planPairAnchoring(pairCase.fixture, base);
    const shift = shiftsCarriedRanges("packages/api/src/routes.ts", 2);

    expect(shift.check({ base, revised: base, plan })).toBe(true);
    expect(
      shiftsCarriedRanges("packages/api/src/routes.ts", 1).check({
        base,
        revised: base,
        plan,
      }),
    ).toBe(false);
  });
});

describe("the fast-forward pair cases' carry split", () => {
  it.each(Object.entries(FAST_FORWARD_SPLITS))(
    "holds on %s",
    async (id, split) => {
      const loaded = await loadPairCases(PAIR_CASES_DIR, id);
      const pairCase = loaded.ok ? loaded.value[0] : undefined;
      if (pairCase === undefined) {
        throw new Error(`pair case ${id} did not load`);
      }

      const plan = planPairAnchoring(
        pairCase.fixture,
        makeFileGroupBrief(pairCase),
      );

      expect({
        frozen: plan.frozen.map((carry) => carry.group.id),
        reLook: plan.reLook.map((entry) => entry.id),
      }).toEqual(split);
    },
  );
});

/** The same Brief with one more group on the first file, so two groups share it. */
function makeSharedFileBrief(pairCase: PairCase): Brief {
  const brief = makeFileGroupBrief(pairCase);
  const [firstGroup] = brief.changeGroups;
  const [firstChunk] = brief.chunks;
  if (firstGroup === undefined || firstChunk === undefined) {
    return brief;
  }
  return {
    ...brief,
    changeGroups: [...brief.changeGroups, { ...firstGroup, id: "gs" }],
    chunks: [...brief.chunks, { ...firstChunk, id: "cs", changeGroupId: "gs" }],
  };
}

describe("the fast-forward pair cases' split with a shared first file", () => {
  it.each(Object.entries(FAST_FORWARD_SPLITS))(
    "freezes both sharers beside g1 on %s",
    async (id, split) => {
      const loaded = await loadPairCases(PAIR_CASES_DIR, id);
      const pairCase = loaded.ok ? loaded.value[0] : undefined;
      if (pairCase === undefined) {
        throw new Error(`pair case ${id} did not load`);
      }

      const plan = planPairAnchoring(
        pairCase.fixture,
        makeSharedFileBrief(pairCase),
      );

      expect({
        frozen: plan.frozen.map((carry) => carry.group.id),
        reLook: plan.reLook.map((entry) => entry.id),
      }).toEqual({ frozen: [...split.frozen, "gs"], reLook: split.reLook });
    },
  );
});

/** A non-fast-forward case, its span derived by hand from both PR diffs. */
const HAND_DERIVED_SPANS = [
  {
    id: "pair-rebase-noise",
    filtered: {
      files: ["packages/api/src/routes/health.ts"],
      headers: ["@@ -3,11 +3,12 @@"],
    },
    unfiltered: {
      files: [
        "packages/api/src/routes/health.ts",
        "packages/logging/src/redact.ts",
      ],
      headers: ["@@ -3,11 +3,12 @@", "@@ -1,3 +1,5 @@"],
    },
  },
];

describe("the hand-derived pair spans", () => {
  it.each(HAND_DERIVED_SPANS)("hold on $id", async (expected) => {
    const shapes = await readPairSpanShapes(PAIR_CASES_DIR, expected.id);

    expect(shapes).toEqual([expected.filtered, expected.unfiltered]);
  });
});

describe("readPairSpan", () => {
  it("reads a capture's recorded span instead of rebuilding one", async () => {
    const identity = [
      { file: "a.ts", hunks: [] },
      { file: "b.ts", hunks: [] },
    ];
    const recorded = {
      changedFiles: [],
      unchangedFiles: ["a.ts", "b.ts"],
      unpairableFiles: [],
      hop: identity,
      oldSideHop: identity,
      isUnchanged: true,
    };
    const pairJson = makePairJson({
      increment: { filteredSpan: "", unfilteredSpan: DIFF_B, span: recorded },
    });
    const loaded = await loadPairCases(
      writePairCase("p", EXPECTED_TS, pairJson),
    );
    const fixture = loaded.ok ? loaded.value[0]?.fixture : undefined;
    if (fixture === undefined) {
      throw new Error("the pair case did not load");
    }

    expect(readPairSpan(fixture)).toEqual({
      ...recorded,
      filteredDiff: "",
      unfilteredDiff: DIFF_B,
    });
  });
});
