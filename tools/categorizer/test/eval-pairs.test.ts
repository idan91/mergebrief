// Revision-pair machinery: the pair runner drives the SAME plan/stitch the
// production worker runs — fake generators only, no API.
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import type {
  GenerateRequest,
  Generator,
  Effort,
  Generation,
} from "generators";
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

/** Serves canned generation outputs in call order (run1 base, run1 revised, …). */
class SequenceGenerator implements Generator {
  calls = 0;
  readonly requests: { system: string; user: string }[] = [];
  constructor(private readonly outputs: unknown[]) {}
  origin(effort: Effort): Generation {
    return { provider: "fake", model: "fake-model", effort };
  }
  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    this.requests.push({ system: req.system, user: req.user });
    const output = this.outputs[this.calls];
    this.calls += 1;
    if (output === undefined) throw new Error("sequence exhausted");
    if (output instanceof Error) throw output;
    return req.schema.parse(output);
  }
}

const intentNone = {
  ticketUrls: [],
  ticketTitles: [],
  specificity: "none",
  scopeNote: "",
  items: [],
  alignment: { read: "", goal: "", response: "" },
};

function genOutput(
  groups: { id: string; title: string; file: string; start?: number }[],
): unknown {
  return {
    summary: "s",
    intentCheck: intentNone,
    changeGroups: groups.map((g) => ({
      id: g.id,
      title: g.title,
      summary: `${g.title} summary`,
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
      loc: { added: 2, deleted: 0 },
      addedRanges: [{ start: g.start ?? 1, end: (g.start ?? 1) + 1 }],
      removedRanges: [],
      riskSurface: [],
    })),
    concernView: [
      { concern: "implementation", added: groups.length * 2, deleted: 0 },
    ],
  };
}

const DIFF_B = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,3 @@
 line
+added
 line2
`;

const meta = (sha: string, files: string[]) => ({
  title: "t",
  body: "d",
  url: "https://github.com/o/r/pull/1",
  sha,
  baseSha: "base".padEnd(40, "0"),
  commitCount: 1,
  files: files.map((path) => ({ path, additions: 2, deletions: 0 })),
});

const diffFor = (files: string[]) =>
  files
    .map(
      (f) => `diff --git a/${f} b/${f}
--- a/${f}
+++ b/${f}
@@ -1,1 +1,3 @@
 line
+added
+more
`,
    )
    .join("");

function fixtureJson(): unknown {
  return {
    base: {
      pr: {
        locator: { owner: "o", repo: "r", number: 1 },
        meta: meta("a".repeat(40), ["a.ts", "b.ts"]),
        diff: diffFor(["a.ts", "b.ts"]),
        links: [],
      },
      commitRange: {
        base: "base".padEnd(40, "0"),
        head: "a".repeat(40),
        commitCount: 1,
      },
    },
    revised: {
      pr: {
        locator: { owner: "o", repo: "r", number: 1 },
        meta: meta("b".repeat(40), ["a.ts", "b.ts"]),
        diff: diffFor(["a.ts", "b.ts"]),
        links: [],
      },
      commitRange: {
        base: "base".padEnd(40, "0"),
        head: "b".repeat(40),
        commitCount: 2,
      },
    },
    increment: {
      incrementalDiff: DIFF_B,
      compareFiles: {
        files: [{ filename: "b.ts", status: "modified" }],
        complete: true,
        status: "ahead",
      },
      baseShaMoved: false,
    },
  };
}

function writePairCase(id: string, expectedTs: string): string {
  const root = mkdtempSync(join(tmpdir(), "pair-cases-"));
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pair.json"), JSON.stringify(fixtureJson()));
  writeFileSync(join(dir, "expected.ts"), expectedTs);
  return root;
}

const EXPECTED_TS = `
export const pairProperties = [
  {
    id: "frozen-survives",
    description: "the untouched group survives byte-identical",
    check: (pair) =>
      JSON.stringify(pair.base.changeGroups[0]) ===
      JSON.stringify(pair.revised.changeGroups.find((g) => g.id === pair.base.changeGroups[0].id)),
  },
];
`;

describe("loadPairCases", () => {
  it("loads a pair case with fixture + properties", async () => {
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    expect(cases.ok).toBe(true);
    if (!cases.ok) throw new Error(cases.error);
    expect(cases.value).toHaveLength(1);
    expect(cases.value[0]?.id).toBe("demo-pair");
    expect(cases.value[0]?.properties[0]?.id).toBe("frozen-survives");
  });

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
    if (!cases.ok) return;
    expect(cases.value).toEqual([]);
  });
});

describe("runPairCase", () => {
  it("runs base fresh, revision anchored, and stitches — frozen carry survives", async () => {
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) throw new Error(cases.error);
    const pairCase = cases.value[0];
    if (pairCase === undefined) throw new Error("no case");

    const generator = new SequenceGenerator([
      genOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      genOutput([
        { id: "tmpA", title: "alpha rewritten", file: "a.ts", start: 5 },
        { id: "tmpB", title: "beta v2", file: "b.ts" },
      ]),
    ]);
    const result = await runPairCase(pairCase, generator, "medium", 1);
    expect(result.pairs).toHaveLength(1);
    expect(result.generationFailures).toBe(0);
    const pair = result.pairs[0];
    if (pair === undefined) throw new Error("no pair");
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
    if (!cases.ok) throw new Error(cases.error);
    const pairCase = cases.value[0];
    if (pairCase === undefined) throw new Error("no case");

    const generator = new SequenceGenerator([
      genOutput([
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

describe("runPairCase — fresh mode (vacuous-pass probe)", () => {
  it("skips the anchor view and the stitch: raw model output, no stamp", async () => {
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) throw new Error(cases.error);
    const pairCase = cases.value[0];
    if (pairCase === undefined) throw new Error("no case");
    const generator = new SequenceGenerator([
      genOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      genOutput([
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
    if (pair === undefined) throw new Error("no pair");
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
    if (!cases.ok) throw new Error(cases.error);
    const pairCase = cases.value[0];
    if (pairCase === undefined) throw new Error("no case");
    const generator = new SequenceGenerator([
      genOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      genOutput([
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
    if (!evaluated.ok) throw new Error(evaluated.error);
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
    if (!cases.ok) throw new Error(cases.error);
    const pairCase = cases.value[0];
    if (pairCase === undefined) throw new Error("no case");
    const generator = new SequenceGenerator([
      genOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      genOutput([
        { id: "tmpA", title: "alpha rewritten", file: "a.ts", start: 5 },
        // genOutput derives summary from the title — an over-cap title
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
    if (!evaluated.ok) throw new Error(evaluated.error);
    const notes = evaluated.value.outcome.notes.join("\n");
    expect(notes).toContain("revised text length: 1/1 runs over cap");
    expect(notes).not.toContain("base text length");
  });

  it("no-baseline mode neither loads nor writes baseline.json", async () => {
    // The characterization guard: a branch flip sending NONE into the write
    // path would overwrite a committed baseline during a cross-model run.
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) throw new Error(cases.error);
    const pairCase = cases.value[0];
    if (pairCase === undefined) throw new Error("no case");
    const outputs = () => [
      genOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      genOutput([
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
    if (!evaluated.ok) throw new Error(evaluated.error);
    expect(evaluated.value.outcome.baseline).toBeNull();
    expect(evaluated.value.rebaselined).toBe(false);
    expect(existsSync(join(pairCase.dir, "baseline.json"))).toBe(false);
  });

  it("rebaseline writes and re-reads the baseline at the same key", async () => {
    const root = writePairCase("demo-pair", EXPECTED_TS);
    const cases = await loadPairCases(root);
    if (!cases.ok) throw new Error(cases.error);
    const pairCase = cases.value[0];
    if (pairCase === undefined) throw new Error("no case");
    const outputs = () => [
      genOutput([
        { id: "g1", title: "alpha", file: "a.ts", start: 5 },
        { id: "g2", title: "beta", file: "b.ts" },
      ]),
      genOutput([
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
    if (!wrote.ok) throw new Error(wrote.error);
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
    if (!reread.ok) throw new Error(reread.error);
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
    if (!result.ok) return;
    expect(result.value.singles).toHaveLength(2);
    expect(result.value.pairs).toHaveLength(1);
  });

  it("--case selects from either case set and errors on an unknown id", () => {
    const pairHit = selectCases(singles, pairs, "p1");
    expect(pairHit.ok && pairHit.value.pairs).toHaveLength(1);
    const miss = selectCases(singles, pairs, "nope");
    expect(miss.ok).toBe(false);
    if (miss.ok) return;
    expect(miss.error).toContain("p1");
  });

  it("an empty combined case set is an error", () => {
    expect(selectCases([], [], undefined).ok).toBe(false);
  });
});

describe("parseEvalArgs — --pair-fresh", () => {
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
// The committed pair source: every case must load, and the shared property
// builders must be shown to FAIL against broken pairs — mechanical
// vacuous-pass evidence before any live baseline lands.
// ---------------------------------------------------------------------------

import { dirname, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  anchoredStamp,
  coverage,
  frozenAttrsNeverChange,
  idCarried,
  survivorOrderStable,
  untouchedGroupSurvives,
} from "../eval/pair-cases/props";
import type { Brief } from "brief-core/types";

const PAIRS_DIR = joinPath(
  dirname(fileURLToPath(import.meta.url)),
  "../eval/pair-cases",
);

describe("committed pair case set", () => {
  it("every committed pair case loads with unique, non-empty properties", async () => {
    const cases = await loadPairCases(PAIRS_DIR);
    expect(cases.ok).toBe(true);
    if (!cases.ok) throw new Error(cases.error);
    expect(cases.value.length).toBeGreaterThanOrEqual(11);
    for (const pairCase of cases.value) {
      expect(pairCase.properties.length).toBeGreaterThan(0);
      const ids = pairCase.properties.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

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
    },
  };
}

describe("shared pair properties fail against broken pairs (vacuous-pass evidence)", () => {
  const base = briefWith([
    { id: "g1", file: "a.ts", attrs: ["touches-auth"] },
    { id: "g2", file: "b.ts" },
  ]);

  it("untouchedGroupSurvives: passes on identical carry, fails on a rewrite", () => {
    const survives = untouchedGroupSurvives("a.ts");
    expect(survives.check(buildRevisionPair(base, base))).toBe(true);
    const rewritten = briefWith([
      { id: "g1", file: "a.ts", attrs: ["touches-auth"], summary: "REWRITTEN" },
      { id: "g2", file: "b.ts" },
    ]);
    expect(survives.check(buildRevisionPair(base, rewritten))).toBe(false);
  });

  it("frozenAttrsNeverChange: fails when an attribute drifts on the frozen file", () => {
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

  it("survivorOrderStable: fails on reordered or re-ranged chunks and on an absent file", () => {
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
});
