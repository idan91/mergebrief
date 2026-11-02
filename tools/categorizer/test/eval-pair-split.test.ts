import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseChangedRanges } from "brief-core";
import type { Brief } from "brief-core/types";
import { loadPairCases, planPairAnchoring, type PairCase } from "../eval/pairs";
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

/** A non-fast-forward case, its span derived by hand from both PR diffs. */
const HAND_DERIVED_SPANS = [
  {
    id: "pair-rebase-noise",
    files: ["packages/api/src/routes/health.ts"],
    headers: ["@@ -3,11 +3,12 @@"],
  },
];

describe("the hand-derived pair spans", () => {
  it.each(HAND_DERIVED_SPANS)("hold on $id", async (expected) => {
    const shapes = await readPairSpanShapes(PAIR_CASES_DIR, expected.id);

    for (const shape of shapes) {
      expect(shape).toEqual({
        files: expected.files,
        headers: expected.headers,
      });
    }
  });
});
