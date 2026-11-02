// Revision-pair machinery: the pair runner drives the SAME plan/stitch the
// production worker runs, with fake generators only and no API.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluatePairCase,
  loadPairCases,
  runPairCase,
  scorePairRuns,
  selectCases,
  type PairEvalProperty,
  type RevisionPair,
} from "../eval/pairs";
import { BaselineModes } from "../eval/baseline";
import { parseEvalArgs } from "../eval/cli";
import {
  EXPECTED_TS,
  SequenceGenerator,
  makeBriefOutput,
  writePairCase,
} from "./pair-fixtures";

describe("loadPairCases", () => {
  it("rejects a case with an empty property list", async () => {
    const root = writePairCase(
      "empty-props",
      "export const pairProperties = [];",
    );
    const cases = await loadPairCases(root);
    expect(cases.ok).toBe(false);
  });

  it("returns an empty list when the pairs dir does not exist", async () => {
    const cases = await loadPairCases(
      join(tmpdir(), "definitely-missing-pairs-dir"),
    );
    expect(cases.ok).toBe(true);
    if (!cases.ok) {
      return;
    }
    expect(cases.value).toEqual([]);
  });
});

describe("runPairCase", () => {
  it("stitches a fresh base and anchored revision so frozen carry survives", async () => {
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) {
      throw new Error(cases.error);
    }
    const pairCase = cases.value[0];
    if (pairCase === undefined) {
      throw new Error("no case");
    }

    const generator = new SequenceGenerator([
      makeBriefOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      makeBriefOutput([
        { id: "tmpA", title: "alpha rewritten", file: "a.ts", start: 5 },
        { id: "tmpB", title: "beta v2", file: "b.ts" },
      ]),
    ]);
    const result = await runPairCase(pairCase, generator, "medium", 1);
    expect(result.pairs).toHaveLength(1);
    expect(result.generationFailures).toBe(0);
    const pair = result.pairs[0];
    if (pair === undefined) {
      throw new Error("no pair");
    }
    // The base run was fresh; the revised run was anchored.
    expect(generator.requests[0]?.system).not.toContain(
      "Anchored regeneration",
    );
    expect(generator.requests[1]?.system).toContain("Anchored regeneration");
    expect(generator.requests[1]?.user).toContain("<anchor_brief");
    // The stitch carried the frozen group verbatim under its previous id.
    const carried = pair.revised.changeGroups.find((g) => g.id === "g1");
    expect(carried?.title).toBe("alpha");
    expect(pair.revised.anchoring?.carried).toEqual(["g1"]);
    // The revised brief is stamped anchored like production.
    expect(pair.revised.anchor).toEqual({ state: "anchored" });
  });

  it("counts a failed revision generation as a run failure, not a crash", async () => {
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) {
      throw new Error(cases.error);
    }
    const pairCase = cases.value[0];
    if (pairCase === undefined) {
      throw new Error("no case");
    }

    const generator = new SequenceGenerator([
      makeBriefOutput([
        { id: "g1", title: "alpha", file: "a.ts" },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      new Error("revision blew up"),
    ]);
    const result = await runPairCase(pairCase, generator, "medium", 1);
    expect(result.pairs).toHaveLength(0);
    expect(result.generationFailures).toBe(1);
    expect(result.failureMessages[0]).toContain("revision blew up");
  });
});

describe("runPairCase fresh mode as the vacuous-pass probe", () => {
  it("skips the anchor view and the stitch: raw model output, no stamp", async () => {
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) {
      throw new Error(cases.error);
    }
    const pairCase = cases.value[0];
    if (pairCase === undefined) {
      throw new Error("no case");
    }
    const generator = new SequenceGenerator([
      makeBriefOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      makeBriefOutput([
        { id: "tmpA", title: "alpha rewritten", file: "a.ts", start: 5 },
        { id: "tmpB", title: "beta v2", file: "b.ts" },
      ]),
    ]);
    const result = await runPairCase(
      pairCase,
      generator,
      "medium",
      1,
      () => {},
      "fresh",
    );
    expect(result.pairs).toHaveLength(1);
    const pair = result.pairs[0];
    if (pair === undefined) {
      throw new Error("no pair");
    }
    expect(generator.requests[1]?.system).not.toContain(
      "Anchored regeneration",
    );
    // Raw model output survives: temp ids intact, no stamp, no anchoring.
    expect(pair.revised.changeGroups.map((g) => g.id)).toEqual([
      "tmpA",
      "tmpB",
    ]);
    expect(pair.revised.anchor).toBeUndefined();
    expect(pair.revised.anchoring).toBeUndefined();
  });
});

describe("evaluatePairCase", () => {
  it("scores, persists both sides, and reports no baseline for a dry case", async () => {
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) {
      throw new Error(cases.error);
    }
    const pairCase = cases.value[0];
    if (pairCase === undefined) {
      throw new Error("no case");
    }
    const generator = new SequenceGenerator([
      makeBriefOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      makeBriefOutput([
        { id: "tmpA", title: "alpha rewritten", file: "a.ts", start: 5 },
        { id: "tmpB", title: "beta v2", file: "b.ts" },
      ]),
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "pair-out-"));
    const evaluated = await evaluatePairCase(
      pairCase,
      generator,
      "medium",
      1,
      "fake:fake-model",
      BaselineModes.COMPARE,
      outDir,
      () => {},
    );
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) {
      throw new Error(evaluated.error);
    }
    expect(evaluated.value.outcome.baseline).toBeNull();
    expect(evaluated.value.outcome.runsScored).toBe(1);
    expect(evaluated.value.outcome.scores.get("frozen-survives")?.passes).toBe(
      1,
    );
    expect(existsSync(join(outDir, "eval-runs", "demo-pair", "base"))).toBe(
      true,
    );
    expect(existsSync(join(outDir, "eval-runs", "demo-pair", "revised"))).toBe(
      true,
    );
  });

  it("carries a labeled text-length note when a side's summary is over cap", async () => {
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) {
      throw new Error(cases.error);
    }
    const pairCase = cases.value[0];
    if (pairCase === undefined) {
      throw new Error("no case");
    }
    const generator = new SequenceGenerator([
      makeBriefOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      makeBriefOutput([
        { id: "tmpA", title: "alpha rewritten", file: "a.ts", start: 5 },
        // genOutput derives summary from the title, so an over-cap title
        // produces an over-cap summary (and an over-cap title violation).
        { id: "tmpB", title: "x".repeat(260), file: "b.ts" },
      ]),
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "pair-out-"));
    const evaluated = await evaluatePairCase(
      pairCase,
      generator,
      "medium",
      1,
      "fake:fake-model",
      BaselineModes.COMPARE,
      outDir,
      () => {},
    );
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) {
      throw new Error(evaluated.error);
    }
    const notes = evaluated.value.outcome.notes.join("\n");
    expect(notes).toContain("revised text length: 1/1 runs over cap");
    expect(notes).not.toContain("base text length");
  });

  it("no-baseline mode neither loads nor writes baseline.json", async () => {
    // The characterization guard: a branch flip sending NONE into the write
    // path would overwrite a committed baseline during a cross-model run.
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) {
      throw new Error(cases.error);
    }
    const pairCase = cases.value[0];
    if (pairCase === undefined) {
      throw new Error("no case");
    }
    const outputs = () => [
      makeBriefOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      makeBriefOutput([
        { id: "tmpA", title: "alpha rewritten", file: "a.ts", start: 5 },
        { id: "tmpB", title: "beta v2", file: "b.ts" },
      ]),
    ];
    const outDir = mkdtempSync(join(tmpdir(), "pair-out-"));
    const evaluated = await evaluatePairCase(
      pairCase,
      new SequenceGenerator(outputs()),
      "medium",
      1,
      "cross:model-with-no-baseline",
      BaselineModes.NONE,
      outDir,
      () => {},
    );
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) {
      throw new Error(evaluated.error);
    }
    expect(evaluated.value.outcome.baseline).toBeNull();
    expect(evaluated.value.rebaselined).toBe(false);
    expect(existsSync(join(pairCase.dir, "baseline.json"))).toBe(false);
  });

  it("rebaseline writes and re-reads the baseline at the same key", async () => {
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) {
      throw new Error(cases.error);
    }
    const pairCase = cases.value[0];
    if (pairCase === undefined) {
      throw new Error("no case");
    }
    const outputs = () => [
      makeBriefOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      makeBriefOutput([
        { id: "tmpA", title: "alpha rewritten", file: "a.ts", start: 5 },
        { id: "tmpB", title: "beta v2", file: "b.ts" },
      ]),
    ];
    const outDir = mkdtempSync(join(tmpdir(), "pair-out-"));
    const wrote = await evaluatePairCase(
      pairCase,
      new SequenceGenerator(outputs()),
      "medium",
      1,
      "fake:fake-model",
      BaselineModes.REBASELINE,
      outDir,
      () => {},
    );
    expect(wrote.ok).toBe(true);
    if (!wrote.ok) {
      throw new Error(wrote.error);
    }
    expect(wrote.value.rebaselined).toBe(true);
    expect(existsSync(join(pairCase.dir, "baseline.json"))).toBe(true);

    const reread = await evaluatePairCase(
      pairCase,
      new SequenceGenerator(outputs()),
      "medium",
      1,
      "fake:fake-model",
      BaselineModes.COMPARE,
      outDir,
      () => {},
    );
    expect(reread.ok).toBe(true);
    if (!reread.ok) {
      throw new Error(reread.error);
    }
    expect(reread.value.outcome.baseline?.properties["frozen-survives"]).toBe(
      1,
    );
  });
});

describe("selectCases", () => {
  const singles = [{ id: "s1" }, { id: "s2" }];
  const pairs = [{ id: "p1" }];

  it("passes both case sets through with no filter", () => {
    const result = selectCases(singles, pairs, undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.singles).toHaveLength(2);
    expect(result.value.pairs).toHaveLength(1);
  });

  it("--case selects from either case set and errors on an unknown id", () => {
    const pairHit = selectCases(singles, pairs, "p1");
    expect(pairHit.ok && pairHit.value.pairs).toHaveLength(1);
    const miss = selectCases(singles, pairs, "nope");
    expect(miss.ok).toBe(false);
    if (miss.ok) {
      return;
    }
    expect(miss.error).toContain("p1");
  });

  it("an empty combined case set is an error", () => {
    expect(selectCases([], [], undefined).ok).toBe(false);
  });
});

describe("parseEvalArgs --pair-fresh", () => {
  it("parses the flag and refuses it alongside --rebaseline", () => {
    const parsed = parseEvalArgs(["--pair-fresh"]);
    expect(parsed.ok && parsed.value.pairFresh).toBe(true);
    const refused = parseEvalArgs(["--pair-fresh", "--rebaseline"]);
    expect(refused.ok).toBe(false);
  });
});

describe("scorePairRuns", () => {
  const passingPair = {
    base: { changeGroups: [{ id: "g1" }] },
    revised: { changeGroups: [{ id: "g1" }] },
  } as unknown as RevisionPair;
  const failingPair = {
    base: { changeGroups: [{ id: "g1" }] },
    revised: { changeGroups: [{ id: "gX" }] },
  } as unknown as RevisionPair;
  const property: PairEvalProperty = {
    id: "id-carried",
    description: "the base group id survives",
    check: (pair) =>
      pair.revised.changeGroups.some(
        (g) => g.id === pair.base.changeGroups[0]?.id,
      ),
  };

  it("scores pass counts per property over the pairs", () => {
    const scored = scorePairRuns([property], [passingPair, failingPair]);
    expect(scored.scores.get("id-carried")).toEqual({ passes: 1, runs: 2 });
  });

  it("a throwing predicate is a fail with a note, never a crash", () => {
    const bomb: PairEvalProperty = {
      id: "bomb",
      description: "throws",
      check: () => {
        throw new Error("boom");
      },
    };
    const scored = scorePairRuns([bomb], [passingPair]);
    expect(scored.scores.get("bomb")).toEqual({ passes: 0, runs: 1 });
    expect(scored.notes[0]).toContain("boom");
  });
});

// ---------------------------------------------------------------------------
// The shared property builders must be shown to FAIL against broken pairs:
// mechanical vacuous-pass evidence before any live baseline lands.
// ---------------------------------------------------------------------------

import {
  anchoredStamp,
  keepsCarriedGroups,
  shiftsCarriedRanges,
  carriesEveryGroup,
  coverage,
  frozenAttrsNeverChange,
  idCarried,
  reLooksOwnersOf,
  survivorOrderStable,
  untouchedGroupSurvives,
} from "../eval/pair-cases/props";
import type { Brief } from "brief-core/types";

function briefWith(
  groups: { id: string; file: string; attrs?: string[]; summary?: string }[],
): Brief {
  return {
    pr: {
      repo: "o/r",
      number: 1,
      title: "t",
      url: "u",
      sha: "s",
      description: "",
    },
    index: 1,
    commitRange: { base: "b", head: "h", commitCount: 1 },
    generation: { provider: "fake", model: "m", effort: "medium" },
    summary: "Lede one. More.",
    changeGroups: groups.map((g) => ({
      id: g.id,
      title: g.id,
      summary: g.summary ?? `${g.id} summary`,
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    })),
    chunks: groups.map((g, i) => ({
      id: `c${i + 1}`,
      changeGroupId: g.id,
      file: g.file,
      concern: "implementation",
      role: "core",
      loc: { added: 1, deleted: 0 },
      addedRanges: [{ start: 1, end: 1 }],
      removedRanges: [],
      riskSurface: g.attrs ?? [],
    })),
    concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
  };
}

function buildRevisionPair(base: Brief, revised: Brief): RevisionPair {
  return {
    base,
    revised,
    plan: {
      frozen: [],
      frozenFiles: new Set(),
      reLook: [],
      previousGroupIds: [],
      warnings: [],
    },
  };
}

/** A pair whose plan carried `groupId` from the base, ranges as they were. */
function buildCarriedPair(
  base: Brief,
  revised: Brief,
  groupId: string,
): RevisionPair {
  const pair = buildRevisionPair(base, revised);
  const group = base.changeGroups.find((entry) => entry.id === groupId);
  if (group === undefined) {
    return pair;
  }
  const chunks = base.chunks.filter((chunk) => chunk.changeGroupId === groupId);
  return {
    ...pair,
    plan: { ...pair.plan, frozen: [{ group, chunks }] },
  };
}

/** A pair whose plan carried every base group, as a span that changed no file would. */
function buildCarryAllPair(base: Brief, revised: Brief): RevisionPair {
  const pair = buildRevisionPair(base, revised);
  const frozen = base.changeGroups.map((group) => ({
    group,
    chunks: base.chunks.filter((chunk) => chunk.changeGroupId === group.id),
  }));
  return { ...pair, plan: { ...pair.plan, frozen } };
}

describe("shared pair properties fail against broken pairs", () => {
  const base = briefWith([
    { id: "g1", file: "a.ts", attrs: ["touches-auth"] },
    { id: "g2", file: "b.ts" },
  ]);

  it("untouchedGroupSurvives: passes on its carry, fails on a rewrite", () => {
    const survives = untouchedGroupSurvives("a.ts");
    const rewritten = briefWith([
      { id: "g1", file: "a.ts", attrs: ["touches-auth"], summary: "REWRITTEN" },
      { id: "g2", file: "b.ts" },
    ]);

    expect(survives.check(buildCarriedPair(base, base, "g1"))).toBe(true);
    expect(survives.check(buildCarriedPair(base, rewritten, "g1"))).toBe(false);
    expect(survives.check(buildRevisionPair(base, base))).toBe(false);
  });

  it("frozenAttrsNeverChange: fails when a frozen file's attribute drifts", () => {
    const property = frozenAttrsNeverChange("a.ts");
    expect(property.check(buildRevisionPair(base, base))).toBe(true);
    const drifted = briefWith([
      { id: "g1", file: "a.ts", attrs: [] },
      { id: "g2", file: "b.ts" },
    ]);
    expect(property.check(buildRevisionPair(base, drifted))).toBe(false);
  });

  it("coverage: fails on an uncovered file and on a double-owned file", () => {
    const property = coverage(["a.ts", "b.ts"]);
    expect(property.check(buildRevisionPair(base, base))).toBe(true);
    const missing = briefWith([{ id: "g1", file: "a.ts" }]);
    expect(property.check(buildRevisionPair(base, missing))).toBe(false);
    const doubled = briefWith([
      { id: "g1", file: "a.ts" },
      { id: "g2", file: "a.ts" },
      { id: "g3", file: "b.ts" },
    ]);
    expect(property.check(buildRevisionPair(base, doubled))).toBe(false);
  });

  it("idCarried: fails when the owner id was reminted", () => {
    const property = idCarried("b.ts");
    expect(property.check(buildRevisionPair(base, base))).toBe(true);
    const reminted = briefWith([
      { id: "g1", file: "a.ts", attrs: ["touches-auth"] },
      { id: "g9", file: "b.ts" },
    ]);
    expect(property.check(buildRevisionPair(base, reminted))).toBe(false);
  });

  it("survivorOrderStable: fails on reorder, re-range, or an absent file", () => {
    const twoChunkBase: Brief = {
      ...base,
      chunks: [
        { ...base.chunks[0]!, id: "c1", addedRanges: [{ start: 1, end: 2 }] },
        { ...base.chunks[0]!, id: "c2", addedRanges: [{ start: 9, end: 10 }] },
      ],
    };
    const property = survivorOrderStable("a.ts");
    expect(property.check(buildRevisionPair(twoChunkBase, twoChunkBase))).toBe(
      true,
    );
    const reordered: Brief = {
      ...twoChunkBase,
      chunks: [...twoChunkBase.chunks].toReversed(),
    };
    expect(property.check(buildRevisionPair(twoChunkBase, reordered))).toBe(
      false,
    );
    const reranged: Brief = {
      ...twoChunkBase,
      chunks: [
        twoChunkBase.chunks[0]!,
        { ...twoChunkBase.chunks[1]!, addedRanges: [{ start: 20, end: 21 }] },
      ],
    };
    expect(property.check(buildRevisionPair(twoChunkBase, reranged))).toBe(
      false,
    );
    // No chunks on the watched file at all → fail, never a vacuous pass.
    const gone: Brief = { ...twoChunkBase, chunks: [] };
    expect(property.check(buildRevisionPair(twoChunkBase, gone))).toBe(false);
  });

  it("anchoredStamp: fails on a missing stamp and on the wrong carried shape", () => {
    const stamped: Brief = {
      ...base,
      anchor: { state: "anchored" },
      anchoring: { carried: ["g1"], regenerated: ["g2"] },
    };
    expect(anchoredStamp(true).check(buildRevisionPair(base, stamped))).toBe(
      true,
    );
    expect(anchoredStamp(false).check(buildRevisionPair(base, stamped))).toBe(
      false,
    );
    expect(anchoredStamp(true).check(buildRevisionPair(base, base))).toBe(
      false,
    );
  });

  it("carriesEveryGroup: fails once any group re-looks", () => {
    const pair = buildCarryAllPair(base, base);
    const reLooked = {
      ...pair,
      plan: {
        ...pair.plan,
        frozen: pair.plan.frozen.slice(1),
        reLook: [{ id: "g1", files: ["a.ts"] }],
      },
    };

    expect(carriesEveryGroup().check(pair)).toBe(true);
    expect(carriesEveryGroup().check(reLooked)).toBe(false);
  });

  it("reLooksOwnersOf: fails when a changed file's owner carries", () => {
    const pair = buildCarryAllPair(base, base);
    const reLooked = {
      ...pair,
      plan: { ...pair.plan, reLook: [{ id: "g2", files: ["b.ts"] }] },
    };

    expect(reLooksOwnersOf(["b.ts"]).check(reLooked)).toBe(true);
    expect(reLooksOwnersOf(["b.ts"]).check(pair)).toBe(false);
    expect(reLooksOwnersOf(["c.ts"]).check(reLooked)).toBe(false);
  });

  it("keepsCarriedGroups: fails on a rewritten carry or none at all", () => {
    const rewritten = briefWith([
      { id: "g1", file: "a.ts", attrs: ["touches-auth"], summary: "REWRITTEN" },
      { id: "g2", file: "b.ts" },
    ]);
    const pair = buildCarryAllPair(base, base);
    const carriesNothing = { ...pair, plan: { ...pair.plan, frozen: [] } };

    expect(keepsCarriedGroups().check(pair)).toBe(true);
    expect(keepsCarriedGroups().check(buildCarryAllPair(base, rewritten))).toBe(
      false,
    );
    expect(keepsCarriedGroups().check(carriesNothing)).toBe(false);
  });

  it("shiftsCarriedRanges: fails on a carry left on its old lines", () => {
    expect(
      shiftsCarriedRanges("a.ts", 2).check(buildCarryAllPair(base, base)),
    ).toBe(false);
  });
});
