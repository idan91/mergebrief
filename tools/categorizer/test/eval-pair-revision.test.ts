import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countPairGenerations,
  evaluatePairCase,
  loadPairCases,
  runPairCase,
  type PairCase,
} from "../eval/pairs";
import { BaselineModes, saveBaseline } from "../eval/baseline";
import { buildReport } from "../eval/report";
import { makeBrief } from "./eval-fixtures";
import {
  DIFF_B,
  EXPECTED_TS,
  NEW_HEAD,
  PREV_HEAD,
  SequenceGenerator,
  makeBriefOutput,
  makePairJson,
  writePairCase,
} from "./pair-fixtures";

const UNFILTERED_ONLY = `diff --git a/c.ts b/c.ts
--- a/c.ts
+++ b/c.ts
@@ -1,1 +1,2 @@
 line
+base branch edit
`;

const COMMENT = {
  id: "101",
  file: "b.ts",
  startLine: null,
  line: 2,
  originalStartLine: null,
  originalLine: 2,
  author: "reviewer",
  body: "please add the second line",
  inReplyToId: null,
  outdated: false,
};

function makeSpanPairJson(extra: Record<string, unknown> = {}): unknown {
  const pair = makePairJson(extra);
  if (typeof pair !== "object" || pair === null) {
    throw new Error("pair json is not an object");
  }
  const increment = Reflect.get(pair, "increment");
  Reflect.set(pair, "increment", {
    ...increment,
    filteredSpan: DIFF_B,
    unfilteredSpan: `${DIFF_B}${UNFILTERED_ONLY}`,
  });
  return pair;
}

const OPTED_IN_TS = `
export const pairProperties = [
  { id: "pair-ran", description: "a pair ran", check: () => true },
];
export const narrativeProperties = [
  {
    id: "narrative-on-b",
    description: "the narrative names b.ts",
    check: (run) => run.narrative.chunks.some((chunk) => chunk.file === "b.ts"),
  },
];
export const deltaProperties = [
  {
    id: "delta-on-b",
    description: "the delta names b.ts",
    check: (run) => run.delta.chunks.some((chunk) => chunk.file === "b.ts"),
  },
];
`;

/** OPTED_IN_TS without its delta list: the narrative alone reads the span. */
const NARRATIVE_ONLY_TS = OPTED_IN_TS.slice(
  0,
  OPTED_IN_TS.indexOf("export const deltaProperties"),
);

/** Past the single call's hunk limit (SINGLE_CALL_MAX_HUNKS, 120). */
const OVER_CALL_LIMIT_HUNKS = 121;

/** b.ts with one added line per hunk, `hunks` of them. */
function makeManyHunkSpan(hunks: number): string {
  const body = Array.from({ length: hunks }, (_, index) => [
    `@@ -${String(index * 10 + 1)},1 +${String(index * 10 + 1)},2 @@`,
    " line",
    "+added",
  ]).flat();
  return [
    "diff --git a/b.ts b/b.ts",
    "--- a/b.ts",
    "+++ b/b.ts",
    ...body,
    "",
  ].join("\n");
}

/** A span pair whose filtered span is `filteredSpan` and whose PR changes `prLines` lines per file. */
function makeSizedSpanPairJson(filteredSpan: string, prLines: number): unknown {
  const pair = makeSpanPairJson();
  for (const side of ["base", "revised"]) {
    const meta = Reflect.get(
      Reflect.get(Reflect.get(Object(pair), side), "pr"),
      "meta",
    );
    for (const file of Reflect.get(meta, "files")) {
      Reflect.set(file, "additions", prLines);
    }
  }
  const increment = Reflect.get(Object(pair), "increment");
  Reflect.set(increment, "filteredSpan", filteredSpan);
  Reflect.set(increment, "unfilteredSpan", filteredSpan);
  return pair;
}

const COMMENTS_OPTED_IN_TS = `${OPTED_IN_TS}
export const deltaReadsReviewComments = true;
`;

const STORED_BASE_BRIEF = makeBrief({
  commitRange: { base: "basesha", head: PREV_HEAD, commitCount: 1 },
});

function makeNarrativeOutput(groupId: string): unknown {
  return {
    overview: "b.ts gained a line",
    chunks: [
      {
        id: "rc1",
        briefChangeGroupId: groupId,
        file: "b.ts",
        addedRanges: [{ start: 2, end: 2 }],
        removedRanges: [],
        summary: "adds a line",
      },
    ],
  };
}

function makeDeltaOutput(chunkGroupId: string): unknown {
  return {
    summary: "b.ts gained a line",
    commentsAddressed: "",
    changedGroups: [
      {
        id: "d1",
        title: "b line",
        summary: "adds a line to b",
        dominantCategory: "bugfix",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [
      {
        id: "dc1",
        changeGroupId: chunkGroupId,
        file: "b.ts",
        concern: "implementation",
        role: "core",
        addedRanges: [{ start: 2, end: 2 }],
        removedRanges: [],
        riskSurface: [],
        summary: "adds a line",
        addressesComments: [],
      },
    ],
    wholePrImpact: "none",
  };
}

const BASE_OUTPUT = makeBriefOutput([
  { id: "g1", title: "alpha", file: "a.ts", start: 5 },
  { id: "g2", title: "beta", file: "b.ts" },
]);
const REVISED_OUTPUT = makeBriefOutput([
  { id: "tmpA", title: "alpha", file: "a.ts", start: 5 },
  { id: "tmpB", title: "beta v2", file: "b.ts" },
]);

async function loadOnlyCase(root: string): Promise<PairCase> {
  const cases = await loadPairCases(root);
  if (!cases.ok) {
    throw new Error(cases.error);
  }
  const [pairCase] = cases.value;
  if (pairCase === undefined) {
    throw new Error("no case");
  }
  return pairCase;
}

async function readLoadError(root: string): Promise<string> {
  const cases = await loadPairCases(root);
  if (cases.ok) {
    throw new Error("expected the load to fail");
  }
  return cases.error;
}

describe("loadPairCases with the narrative and delta opt-in", () => {
  it("refuses an opt-in when pair.json has no filtered span", async () => {
    const root = writePairCase("no-span", OPTED_IN_TS, makePairJson());

    expect(await readLoadError(root)).toContain("filteredSpan");
  });

  it("refuses an opt-in over a span the worker skips as huge", async () => {
    const root = writePairCase(
      "huge",
      OPTED_IN_TS,
      makeSizedSpanPairJson(makeManyHunkSpan(3), 1),
    );

    expect(await readLoadError(root)).toContain("huge-span ratio");
  });

  it("refuses a delta opt-in past the single call's limits", async () => {
    const root = writePairCase(
      "wide",
      OPTED_IN_TS,
      makeSizedSpanPairJson(makeManyHunkSpan(OVER_CALL_LIMIT_HUNKS), 10_000),
    );

    expect(await readLoadError(root)).toContain("delta call limits");
  });

  it("refuses a property id shared by the pair and narrative lists", async () => {
    const expected = OPTED_IN_TS.replace('"narrative-on-b"', '"pair-ran"');
    const root = writePairCase("dup", expected, makeSpanPairJson());

    expect(await readLoadError(root)).toContain(
      'duplicate property id "pair-ran"',
    );
  });

  it("refuses a narrativeProperties export that is not a property list", async () => {
    const expected = `${EXPECTED_TS}\nexport const narrativeProperties = [{ id: 1 }];`;
    const root = writePairCase("bad-export", expected, makeSpanPairJson());

    expect(await readLoadError(root)).toContain("narrativeProperties");
  });

  it("loads a gzipped pair.json", async () => {
    const root = writePairCase(
      "gz",
      EXPECTED_TS,
      makePairJson(),
      "pair.json.gz",
    );

    const pairCase = await loadOnlyCase(root);

    expect(pairCase.fixture.increment.incrementalDiff).toBe(DIFF_B);
  });

  it("refuses a case holding both pair.json and pair.json.gz", async () => {
    const root = writePairCase("both", EXPECTED_TS);
    writeFileSync(join(root, "both", "pair.json.gz"), "");

    expect(await readLoadError(root)).toContain(
      "both pair.json and pair.json.gz",
    );
  });

  it("reads the spans, review comments and base brief from pair.json", async () => {
    const baseBrief = STORED_BASE_BRIEF;
    const root = writePairCase(
      "full",
      COMMENTS_OPTED_IN_TS,
      makeSpanPairJson({ reviewComments: [COMMENT], baseBrief }),
    );

    const pairCase = await loadOnlyCase(root);

    expect(pairCase.fixture.filteredSpan).toBe(DIFF_B);
    expect(pairCase.fixture.unfilteredSpan).toContain("base branch edit");
    expect(pairCase.fixture.reviewComments).toEqual([COMMENT]);
    expect(pairCase.fixture.baseBrief).toEqual(baseBrief);
    expect(pairCase.narrativeProperties.map((p) => p.id)).toEqual([
      "narrative-on-b",
    ]);
    expect(pairCase.deltaProperties.map((p) => p.id)).toEqual(["delta-on-b"]);
    expect(pairCase.deltaReadsReviewComments).toBe(true);
  });

  it("refuses a base brief stored for another head", async () => {
    const root = writePairCase(
      "wrong-head",
      EXPECTED_TS,
      makePairJson({ baseBrief: makeBrief() }),
    );

    expect(await readLoadError(root)).toContain("baseBrief");
  });

  it("refuses the comment opt-in without delta properties", async () => {
    const expected = `${EXPECTED_TS}\nexport const deltaReadsReviewComments = true;`;
    const root = writePairCase(
      "comments-no-delta",
      expected,
      makeSpanPairJson({ reviewComments: [COMMENT] }),
    );

    expect(await readLoadError(root)).toContain("deltaReadsReviewComments");
  });

  it("refuses a comment opt-in that is not a boolean", async () => {
    const expected = `${OPTED_IN_TS}\nexport const deltaReadsReviewComments = "yes";`;
    const root = writePairCase(
      "comments-not-boolean",
      expected,
      makeSpanPairJson({ reviewComments: [COMMENT] }),
    );

    expect(await readLoadError(root)).toContain("deltaReadsReviewComments");
  });

  it("refuses the comment opt-in when pair.json has no comments", async () => {
    const root = writePairCase(
      "comments-missing",
      COMMENTS_OPTED_IN_TS,
      makeSpanPairJson(),
    );

    expect(await readLoadError(root)).toContain("reviewComments");
  });

  it("leaves a case without the exports out of both modes", async () => {
    const pairCase = await loadOnlyCase(writePairCase("plain", EXPECTED_TS));

    expect(pairCase.narrativeProperties).toEqual([]);
    expect(pairCase.deltaProperties).toEqual([]);
    expect(pairCase.fixture.reviewComments).toBeUndefined();
    expect(pairCase.deltaReadsReviewComments).toBe(false);
  });
});

describe("runPairCase with the narrative and delta opt-in", () => {
  it("runs the narrative over the filtered span on the stitched brief", async () => {
    const pairCase = await loadOnlyCase(
      writePairCase("run", OPTED_IN_TS, makeSpanPairJson()),
    );
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      makeNarrativeOutput("g1"),
      makeDeltaOutput("d1"),
    ]);

    const result = await runPairCase(pairCase, generator, "medium", 1);

    expect(result.failureMessages).toEqual([]);
    const narrativeRequest = generator.requests[2];
    expect(narrativeRequest?.label).toBe("revision narrative");
    expect(narrativeRequest?.user).toContain("+added");
    expect(narrativeRequest?.user).not.toContain("base branch edit");
    const [narrativeRun] = result.narratives;
    expect(narrativeRun?.brief).toBe(result.pairs[0]?.revised);
    expect(narrativeRun?.narrative.prevHeadSha).toBe(PREV_HEAD);
    expect(narrativeRun?.marksFiles).toEqual([
      { file: "b.ts", addedRanges: [{ start: 2, end: 2 }], removedRanges: [] },
    ]);
  });

  it("refuses a narrative past the call limits without calling it", async () => {
    const pairCase = await loadOnlyCase(
      writePairCase(
        "wide-narrative",
        NARRATIVE_ONLY_TS,
        makeSizedSpanPairJson(makeManyHunkSpan(OVER_CALL_LIMIT_HUNKS), 10_000),
      ),
    );
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      makeNarrativeOutput("g1"),
    ]);

    const result = await runPairCase(pairCase, generator, "medium", 1);

    expect(result.failureMessages).toEqual([
      expect.stringContaining("narrative call limits"),
    ]);
    expect(generator.requests.map((request) => request.label)).not.toContain(
      "revision narrative",
    );
  });

  it("writes both no-change records over an empty span, no model call", async () => {
    const pair = makeSpanPairJson();
    Reflect.set(Reflect.get(Object(pair), "increment"), "filteredSpan", "");
    const pairCase = await loadOnlyCase(
      writePairCase("empty-span", OPTED_IN_TS, pair),
    );
    const generator = new SequenceGenerator([BASE_OUTPUT, REVISED_OUTPUT]);

    const result = await runPairCase(pairCase, generator, "medium", 1);

    expect(result.failureMessages).toEqual([]);
    expect(generator.requests.map((request) => request.label)).toEqual([
      "brief",
      "brief",
    ]);
    expect(result.narratives[0]).toMatchObject({
      narrative: {
        artifactKind: "revisionNarrativeUnchanged",
        prevHeadSha: PREV_HEAD,
      },
      marksFiles: [],
      modelCalls: 0,
    });
    expect(result.deltas[0]).toMatchObject({
      delta: { artifactKind: "deltaUnchanged", baselineSha: PREV_HEAD },
      modelCalls: 0,
    });
    expect(countPairGenerations(pairCase)).toBe(2);
  });

  it("sends the delta the case's comments when it opts in", async () => {
    const pairCase = await loadOnlyCase(
      writePairCase(
        "delta",
        COMMENTS_OPTED_IN_TS,
        makeSpanPairJson({ reviewComments: [COMMENT] }),
      ),
    );
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      makeNarrativeOutput("g1"),
      makeDeltaOutput("d1"),
    ]);

    const result = await runPairCase(pairCase, generator, "medium", 1);

    const deltaRequest = generator.requests[3];
    expect(deltaRequest?.label).toBe("delta");
    expect(deltaRequest?.user).toContain(`Baseline SHA: ${PREV_HEAD}`);
    expect(deltaRequest?.user).toContain("please add the second line");
    expect(deltaRequest?.user).not.toContain("base branch edit");
    const [deltaRun] = result.deltas;
    expect(deltaRun?.delta.headSha).toBe(NEW_HEAD);
    expect(deltaRun?.reviewComments).toEqual([COMMENT]);
    expect(deltaRun?.unknownGroupChunkIds).toEqual([]);
  });

  it("sends the delta no review comments by default", async () => {
    const pairCase = await loadOnlyCase(
      writePairCase(
        "delta-no-comments",
        OPTED_IN_TS,
        makeSpanPairJson({ reviewComments: [COMMENT] }),
      ),
    );
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      makeNarrativeOutput("g1"),
      makeDeltaOutput("d1"),
    ]);

    const result = await runPairCase(pairCase, generator, "medium", 1);

    expect(result.failureMessages).toEqual([]);
    expect(generator.requests[3]?.user).not.toContain(
      "please add the second line",
    );
    expect(result.deltas[0]?.reviewComments).toEqual([]);
  });

  it("records the delta chunks dropped for naming an unknown group", async () => {
    const pairCase = await loadOnlyCase(
      writePairCase("ghost", OPTED_IN_TS, makeSpanPairJson()),
    );
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      makeNarrativeOutput("g1"),
      makeDeltaOutput("ghost"),
    ]);

    const result = await runPairCase(pairCase, generator, "medium", 1);

    expect(result.deltas[0]?.unknownGroupChunkIds).toEqual(["dc1"]);
    expect(result.deltas[0]?.delta).toMatchObject({ chunks: [] });
  });

  it("uses the stored base brief instead of generating one", async () => {
    const baseBrief = STORED_BASE_BRIEF;
    const pairCase = await loadOnlyCase(
      writePairCase("stored", EXPECTED_TS, makePairJson({ baseBrief })),
    );
    const generator = new SequenceGenerator([REVISED_OUTPUT]);

    const result = await runPairCase(pairCase, generator, "medium", 1);

    expect(result.failureMessages).toEqual([]);
    expect(generator.calls).toBe(1);
    expect(result.pairs[0]?.base).toEqual(baseBrief);
  });

  it("voids the whole run when the narrative call fails", async () => {
    const pairCase = await loadOnlyCase(
      writePairCase("fail", OPTED_IN_TS, makeSpanPairJson()),
    );
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      new Error("narrative blew up"),
    ]);

    const result = await runPairCase(pairCase, generator, "medium", 1);

    expect(result.pairs).toEqual([]);
    expect(result.narratives).toEqual([]);
    expect(result.failureMessages[0]).toContain("narrative blew up");
  });

  it.each([
    ["the delta call fails", new Error("delta blew up"), "delta blew up"],
    ["the delta answer is malformed", { summary: 1 }, "summary"],
  ])("voids the whole run when %s", async (_label, deltaOutput, message) => {
    const pairCase = await loadOnlyCase(
      writePairCase("delta-fail", OPTED_IN_TS, makeSpanPairJson()),
    );
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      makeNarrativeOutput("g1"),
      deltaOutput,
    ]);

    const result = await runPairCase(pairCase, generator, "medium", 1);

    expect(result.pairs).toEqual([]);
    expect(result.narratives).toEqual([]);
    expect(result.deltas).toEqual([]);
    expect(result.failureMessages[0]).toContain(message);
  });

  it("skips the delta under the fresh probe", async () => {
    const pairCase = await loadOnlyCase(
      writePairCase("fresh", OPTED_IN_TS, makeSpanPairJson()),
    );
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      makeNarrativeOutput("g1"),
    ]);

    const result = await runPairCase(
      pairCase,
      generator,
      "medium",
      1,
      () => {},
      "fresh",
    );

    expect(result.failureMessages).toEqual([]);
    expect(generator.calls).toBe(3);
    expect(result.narratives).toHaveLength(1);
    expect(result.deltas).toEqual([]);
  });
});

describe("evaluatePairCase with the narrative and delta opt-in", () => {
  it("scores narrative and delta properties beside the pair ones", async () => {
    const pairCase = await loadOnlyCase(
      writePairCase("scored", OPTED_IN_TS, makeSpanPairJson()),
    );
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      makeNarrativeOutput("g1"),
      makeDeltaOutput("d1"),
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "pair-out-"));

    const evaluated = await evaluatePairCase(
      pairCase,
      generator,
      "medium",
      1,
      "fake:fake-model",
      BaselineModes.NONE,
      outDir,
      () => {},
    );

    if (!evaluated.ok) {
      throw new Error(evaluated.error);
    }
    const { outcome } = evaluated.value;
    expect(outcome.properties.map((p) => p.id)).toEqual([
      "pair-ran",
      "narrative-on-b",
      "delta-on-b",
    ]);
    expect(outcome.scores.get("narrative-on-b")).toEqual({
      passes: 1,
      runs: 1,
    });
    expect(outcome.scores.get("delta-on-b")).toEqual({ passes: 1, runs: 1 });
    const runsDir = join(outDir, "eval-runs", "scored");
    expect(existsSync(join(runsDir, "narrative", "run-1.brief.json"))).toBe(
      true,
    );
    expect(existsSync(join(runsDir, "delta", "run-1.brief.json"))).toBe(true);
  });

  it("leaves the delta properties out of a fresh probe's report", async () => {
    const pairCase = await loadOnlyCase(
      writePairCase("scored-fresh", OPTED_IN_TS, makeSpanPairJson()),
    );
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      makeNarrativeOutput("g1"),
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "pair-out-"));

    const evaluated = await evaluatePairCase(
      pairCase,
      generator,
      "medium",
      1,
      "fake:fake-model",
      BaselineModes.NONE,
      outDir,
      () => {},
      "fresh",
    );

    if (!evaluated.ok) {
      throw new Error(evaluated.error);
    }
    const { outcome } = evaluated.value;
    expect(outcome.properties.map((p) => p.id)).toEqual([
      "pair-ran",
      "narrative-on-b",
    ]);
    expect(outcome.scores.has("delta-on-b")).toBe(false);
    const runsDir = join(outDir, "eval-runs", "scored-fresh");
    expect(existsSync(join(runsDir, "delta"))).toBe(false);
  });

  it("drops the delta ids from a fresh probe's baseline", async () => {
    const pairCase = await loadOnlyCase(
      writePairCase("fresh-baseline", OPTED_IN_TS, makeSpanPairJson()),
    );
    saveBaseline(join(pairCase.dir, "baseline.json"), {
      key: "fake:fake-model",
      runs: 1,
      properties: { "pair-ran": 1, "narrative-on-b": 1, "delta-on-b": 1 },
    });
    const generator = new SequenceGenerator([
      BASE_OUTPUT,
      REVISED_OUTPUT,
      makeNarrativeOutput("g1"),
    ]);

    const evaluated = await evaluatePairCase(
      pairCase,
      generator,
      "medium",
      1,
      "fake:fake-model",
      BaselineModes.COMPARE,
      mkdtempSync(join(tmpdir(), "pair-out-")),
      () => {},
      "fresh",
    );

    if (!evaluated.ok) {
      throw new Error(evaluated.error);
    }
    const { outcome } = evaluated.value;
    expect(outcome.baseline?.properties).toEqual({
      "pair-ran": 1,
      "narrative-on-b": 1,
    });
    const report = buildReport({
      key: "fake:fake-model",
      billing: { kind: "api" },
      cases: [outcome],
      usage: null,
      costUsd: null,
    });
    expect(report.json.cases[0]?.notes).toEqual([]);
  });
});

describe("countPairGenerations", () => {
  it("counts the base, revision, narrative and delta calls of one run", async () => {
    const optedIn = await loadOnlyCase(
      writePairCase("count", OPTED_IN_TS, makeSpanPairJson()),
    );
    const stored = await loadOnlyCase(
      writePairCase(
        "count-stored",
        EXPECTED_TS,
        makePairJson({ baseBrief: STORED_BASE_BRIEF }),
      ),
    );

    expect(countPairGenerations(optedIn)).toBe(4);
    expect(countPairGenerations(optedIn, "fresh")).toBe(3);
    expect(countPairGenerations(stored)).toBe(1);
  });
});
