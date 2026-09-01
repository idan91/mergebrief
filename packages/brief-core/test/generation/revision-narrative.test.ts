import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod/v4";
import {
  categorizeDelta,
  categorizeRevisionNarrative,
} from "../../src/generation/categorize";
import type { GenerateRequest, Generator } from "generators";
import {
  BriefSchema,
  type Brief,
  type Effort,
  type Generation,
} from "../../src/types";
import type * as GithubModule from "../../src/github";
import type { PrMetadata } from "../../src/github";

// Mock the github module so generateAndWrite / generateAndWriteDelta never
// shell out to `gh` — same fixtures serve both the whole-PR and incremental
// fetches. `parsePrUrl` and friends stay real (pure functions).
const fetched = vi.hoisted(() => ({
  meta: undefined as PrMetadata | undefined,
  prDiff: "",
  compareDiff: "",
}));
vi.mock("../../src/github", async (importOriginal) => {
  const actual = await importOriginal<typeof GithubModule>();
  const mocked = {
    fetchPrMetadata: vi.fn(async () => fetched.meta),
    fetchPrDiff: vi.fn(async () => fetched.prDiff),
    fetchCompareDiff: vi.fn(async () => fetched.compareDiff),
    fetchCompareCommitCount: vi.fn(async () => 1),
    fetchReviewComments: vi.fn(async () => []),
    fetchLinkedContext: vi.fn(async () => []),
    // Fixture SHAs are 16-char; pass them through instead of hitting `gh`.
    resolveFullSha: vi.fn(async (_loc: unknown, ref: string) => ref),
  };
  return {
    ...actual,
    ...mocked,
    // The default PrSource must ride the SAME mocks — the real `ghPrSource`
    // binds the unmocked gh functions at module init.
    ghPrSource: { ...actual.ghPrSource, ...mocked },
  };
});

const { generateAndWrite } = await import("../../src/cli/categorize");
const { generateAndWriteDelta } = await import("../../src/cli/delta");

// --- Fixtures ---------------------------------------------------------------

const URL = "https://github.com/o/r/pull/1";
const HEAD_1 = "aaaa111100000000";
const HEAD_2 = "bbbb222200000000";
const CHECKPOINT = "cccc333300000000";

function makeMeta(sha: string): PrMetadata {
  return {
    title: "t",
    body: "d",
    url: URL,
    sha,
    baseSha: "base000000000000",
    commitCount: 2,
    files: [{ path: "src/a.ts", additions: 10, deletions: 0 }],
  };
}

/** Whole-PR diff: 10 added lines, so a 2-line incremental span is not huge. */
const wholePrDiff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,12 @@
 ctx
+l1
+l2
+l3
+l4
+l5
+l6
+l7
+l8
+l9
+l10
 ctx2
`;

/** Incremental prevHead→head diff: 2 added lines at new-side 6-7. */
const incrementalDiff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -5,2 +5,4 @@
 ctx
+inc1
+inc2
 ctx2
`;

/**
 * The STORED intent-check shape (five bucket arrays). Generation emits one
 * tagged `items` array instead (grammar budget), so a fixture that plays both
 * roles needs both shapes.
 */
const storedIntentCheck = {
  ticketUrls: [],
  ticketTitles: [],
  specificity: "none" as const,
  scopeNote: "",
  accomplished: [],
  statedButMissing: [],
  doneButUnstated: [],
  deviations: [],
  claimedButUnachieved: [],
};

/** What the model "generates" for a full brief (CLI metadata omitted). */
const briefGen = {
  summary: "s",
  intentCheck: {
    ticketUrls: [],
    ticketTitles: [],
    specificity: "none",
    scopeNote: "",
    items: [],
  },
  changeGroups: [
    {
      id: "g1",
      title: "g title",
      summary: "g",
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "c1",
      changeGroupId: "g1",
      file: "src/a.ts",
      concern: "implementation",
      role: "core",
      loc: { added: 10, deleted: 0 },
      addedRanges: [{ start: 2, end: 11 }],
      removedRanges: [],
      riskSurface: [],
    },
  ],
  concernView: [{ concern: "implementation", added: 10, deleted: 0 }],
};

/** What the model "generates" for a revision narrative. */
const narrativeGen = {
  overview: "In this revision, two lines were added to the module.",
  chunks: [
    {
      id: "rc1",
      briefChangeGroupId: "g1",
      file: "src/a.ts",
      addedRanges: [{ start: 6, end: 7 }],
      removedRanges: [],
      summary: "Adds two lines handling the extra case.",
    },
  ],
};

/** What the model "generates" for a delta core. */
const deltaGen = {
  summary: "since you last looked, two lines were added",
  commentsAddressed: "",
  changedGroups: [
    {
      id: "g1",
      title: "g title",
      summary: "g",
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "c1",
      changeGroupId: "g1",
      file: "src/a.ts",
      concern: "implementation",
      role: "core",
      loc: { added: 2, deleted: 0 },
      addedRanges: [{ start: 6, end: 7 }],
      removedRanges: [],
      riskSurface: [],
      summary: "adds two lines",
      addressesComments: [],
    },
  ],
  wholePrImpact: "completes the original intent",
};

/**
 * Mocked Generator (no API key, no network): routes on the request label and
 * parses the fixture through the request's own schema, so a fixture that
 * drifts from the schema fails loudly. `failLabels` simulates a failed LLM
 * call for specific artifact kinds; `onCall` observes ordering.
 */
class FakeGenerator implements Generator {
  readonly labels: string[] = [];
  /** Effort of each request, in call order. */
  readonly efforts: (Effort | undefined)[] = [];
  private readonly failLabels: Set<string>;
  private readonly onCall: ((label: string) => void) | undefined;

  constructor(failLabels: string[] = [], onCall?: (label: string) => void) {
    this.failLabels = new Set(failLabels);
    this.onCall = onCall;
  }

  origin(effort: Effort): Generation {
    return { provider: "fake", model: "fake-model", effort };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    this.labels.push(req.label);
    this.efforts.push(req.effort);
    this.onCall?.(req.label);
    if (this.failLabels.has(req.label)) {
      throw new Error(`simulated ${req.label} failure`);
    }
    const fixtures: Record<string, unknown> = {
      brief: briefGen,
      delta: deltaGen,
      "revision narrative": narrativeGen,
    };
    const fixture = fixtures[req.label];
    if (fixture === undefined)
      throw new Error(`no fixture for label "${req.label}"`);
    return req.schema.parse(fixture);
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

// --- categorizeRevisionNarrative ---------------------------------------------

describe("categorizeRevisionNarrative", () => {
  const input = {
    locator: { owner: "o", repo: "r", number: 1 },
    meta: makeMeta(HEAD_2),
    prevHeadSha: HEAD_1,
    headSha: HEAD_2,
    prevIndex: 1,
    headIndex: 2,
    incrementalDiff,
    brief: {
      ...briefGen,
      intentCheck: storedIntentCheck,
      pr: {
        repo: "o/r",
        number: 1,
        title: "t",
        url: URL,
        sha: HEAD_2,
        description: "d",
      },
      index: 2,
      commitRange: { base: "base000000000000", head: HEAD_2, commitCount: 2 },
      generation: { provider: "fake", model: "fake-model", effort: "medium" },
    } as Brief,
  };

  it("fills CLI-owned metadata and generation origin", async () => {
    const narrative = await categorizeRevisionNarrative(
      input,
      new FakeGenerator(),
    );
    expect(narrative.artifactKind).toBe("revisionNarrative");
    expect(narrative.pr.repo).toBe("o/r");
    expect(narrative.prevHeadSha).toBe(HEAD_1);
    expect(narrative.headSha).toBe(HEAD_2);
    expect(narrative.prevIndex).toBe(1);
    expect(narrative.headIndex).toBe(2);
    expect(narrative.generation).toEqual({
      provider: "fake",
      model: "fake-model",
      effort: "medium",
    });
    expect(narrative.overview).toBe(narrativeGen.overview);
  });

  it("names the fresh-restart discontinuity in the prompt; silent otherwise", async () => {
    class RecordingGenerator extends FakeGenerator {
      users: string[] = [];
      override async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        this.users.push(req.user);
        return super.generate(req);
      }
    }

    const restarted = new RecordingGenerator();
    await categorizeRevisionNarrative(
      {
        ...input,
        brief: {
          ...input.brief,
          anchor: { state: "fresh-restart", reason: "model-swap" },
        },
      },
      restarted,
    );
    expect(restarted.users[0]).toContain("regenerated fresh");
    expect(restarted.users[0]).toContain("model change");

    const anchored = new RecordingGenerator();
    await categorizeRevisionNarrative(
      {
        ...input,
        brief: { ...input.brief, anchor: { state: "anchored" } },
      },
      anchored,
    );
    expect(anchored.users[0]).not.toContain("regenerated fresh");

    const unstamped = new RecordingGenerator();
    await categorizeRevisionNarrative(input, unstamped);
    expect(unstamped.users[0]).not.toContain("regenerated fresh");
  });

  it("warns (never throws) when a chunk references an unknown briefChangeGroupId", async () => {
    const brief: Brief = { ...input.brief, changeGroups: [] };
    const logs: string[] = [];
    const narrative = await categorizeRevisionNarrative(
      { ...input, brief },
      new FakeGenerator(),
      (msg) => logs.push(msg),
    );
    expect(narrative.chunks).toHaveLength(1);
    expect(
      logs.some(
        (l) => l.includes("unknown brief change-group") && l.includes("g1"),
      ),
    ).toBe(true);
    // The warning is artifact-bound too, not just a log line.
    expect(
      narrative.generationWarnings?.some((w) =>
        w.includes("unknown brief change-group"),
      ),
    ).toBe(true);
  });

  // Fixture narrative chunk: src/a.ts, addedRanges 6-7, no removedRanges.
  it("attaches a coverage warning when a mark range has no narrative chunk", async () => {
    const narrative = await categorizeRevisionNarrative(
      {
        ...input,
        marksFiles: [
          {
            file: "src/a.ts",
            addedRanges: [
              { start: 6, end: 7 },
              { start: 30, end: 33 },
            ],
            removedRanges: [],
          },
        ],
      },
      new FakeGenerator(),
    );
    const warnings = narrative.generationWarnings ?? [];
    expect(
      warnings.some(
        (w) =>
          w.includes("revision narrative coverage") &&
          w.includes("added 30-33"),
      ),
    ).toBe(true);
    // The forward direction is clean, so only the reverse fires.
    expect(warnings.some((w) => w.includes("marks overlap"))).toBe(false);
  });

  it("omits generationWarnings entirely when marks and narrative line up", async () => {
    const narrative = await categorizeRevisionNarrative(
      {
        ...input,
        marksFiles: [
          {
            file: "src/a.ts",
            addedRanges: [{ start: 6, end: 7 }],
            removedRanges: [],
          },
        ],
      },
      new FakeGenerator(),
    );
    expect("generationWarnings" in narrative).toBe(false);
  });
});

// --- effort threading ------------------------------------------------------

describe("effort threading — delta + narrative", () => {
  const deltaInput = {
    locator: { owner: "o", repo: "r", number: 1 },
    meta: makeMeta(HEAD_2),
    baselineSha: CHECKPOINT,
    headSha: HEAD_2,
    incrementalDiff,
  };
  const narrativeInput = {
    locator: { owner: "o", repo: "r", number: 1 },
    meta: makeMeta(HEAD_2),
    prevHeadSha: HEAD_1,
    headSha: HEAD_2,
    prevIndex: 1,
    headIndex: 2,
    incrementalDiff,
    // Parsed, not cast: the fixture must be a real Brief or fail loudly.
    brief: BriefSchema.parse({
      ...briefGen,
      intentCheck: storedIntentCheck,
      pr: {
        repo: "o/r",
        number: 1,
        title: "t",
        url: URL,
        sha: HEAD_2,
        description: "d",
      },
      index: 2,
      commitRange: { base: "base000000000000", head: HEAD_2, commitCount: 2 },
      generation: { provider: "fake", model: "fake-model", effort: "medium" },
    }),
  };

  it("delta defaults to medium in request and origin (byte-identical pin)", async () => {
    const generator = new FakeGenerator();
    const delta = await categorizeDelta(deltaInput, generator);
    expect(generator.efforts).toEqual(["medium"]);
    expect(delta.generation.effort).toBe("medium");
  });

  it("delta threads an explicit effort into request AND origin", async () => {
    const generator = new FakeGenerator();
    const delta = await categorizeDelta(deltaInput, generator, () => {}, "low");
    expect(generator.efforts).toEqual(["low"]);
    expect(delta.generation.effort).toBe("low");
  });

  it("narrative threads an explicit effort into request AND origin", async () => {
    const generator = new FakeGenerator();
    const narrative = await categorizeRevisionNarrative(
      narrativeInput,
      generator,
      () => {},
      "high",
    );
    expect(generator.efforts).toEqual(["high"]);
    expect(narrative.generation.effort).toBe("high");
  });
});

// --- text length floor — delta + narrative pipelines -----------------------

describe("text length floor — delta + narrative pipelines", () => {
  /** FakeGenerator with per-label fixture overrides for over-cap text. */
  class OverridingGenerator extends FakeGenerator {
    constructor(private readonly overrides: Record<string, unknown>) {
      super();
    }

    override async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      const fixture = this.overrides[req.label];
      if (fixture !== undefined) return req.schema.parse(fixture);
      return super.generate(req);
    }
  }

  const deltaInput = {
    locator: { owner: "o", repo: "r", number: 1 },
    meta: makeMeta(HEAD_2),
    baselineSha: CHECKPOINT,
    headSha: HEAD_2,
    incrementalDiff,
  };
  const narrativeInput = {
    locator: { owner: "o", repo: "r", number: 1 },
    meta: makeMeta(HEAD_2),
    prevHeadSha: HEAD_1,
    headSha: HEAD_2,
    prevIndex: 1,
    headIndex: 2,
    incrementalDiff,
    brief: BriefSchema.parse({
      ...briefGen,
      intentCheck: storedIntentCheck,
      pr: {
        repo: "o/r",
        number: 1,
        title: "t",
        url: URL,
        sha: HEAD_2,
        description: "d",
      },
      index: 2,
      commitRange: { base: "base000000000000", head: HEAD_2, commitCount: 2 },
      generation: { provider: "fake", model: "fake-model", effort: "medium" },
    }),
  };

  it("delta: stamps lengthViolations + warning for an over-cap group summary", async () => {
    const verboseDelta = {
      ...deltaGen,
      changedGroups: [
        { ...deltaGen.changedGroups[0], summary: "w".repeat(300) },
      ],
    };
    const delta = await categorizeDelta(
      deltaInput,
      new OverridingGenerator({ delta: verboseDelta }),
    );
    expect(delta.lengthViolations).toEqual([
      {
        surface: "group-summary",
        field: "group g1 summary",
        actual: 300,
        cap: 250,
      },
    ]);
    expect(delta.generationWarnings?.join("\n")).toContain(
      "text length issues",
    );
  });

  it("narrative: stamps lengthViolations + warning for an over-cap overview", async () => {
    const verboseNarrative = {
      ...narrativeGen,
      overview: "o".repeat(300),
    };
    const narrative = await categorizeRevisionNarrative(
      narrativeInput,
      new OverridingGenerator({ "revision narrative": verboseNarrative }),
    );
    expect(narrative.lengthViolations).toEqual([
      {
        surface: "narrative-overview",
        field: "narrative overview",
        actual: 300,
        cap: 250,
      },
    ]);
    expect(narrative.generationWarnings?.join("\n")).toContain(
      "text length issues",
    );
  });

  it("delta + narrative: omit the stamp when everything fits", async () => {
    const delta = await categorizeDelta(deltaInput, new FakeGenerator());
    expect("lengthViolations" in delta).toBe(false);
    const narrative = await categorizeRevisionNarrative(
      narrativeInput,
      new FakeGenerator(),
    );
    expect("lengthViolations" in narrative).toBe(false);
  });
});

// --- generateAndWrite wiring --------------------------------------------------

describe("generateAndWrite comparison artifacts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "narrative-"));
    fetched.prDiff = wholePrDiff;
    fetched.compareDiff = incrementalDiff;
    delete process.env["REVISION_NARRATIVE_ENABLED"];
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env["REVISION_NARRATIVE_ENABLED"];
  });

  /** Run the first brief (index 1) so a follow-up run gets index 2. */
  async function firstBrief(generator: Generator): Promise<void> {
    fetched.meta = makeMeta(HEAD_1);
    await generateAndWrite(dir, URL, undefined, generator, () => {});
  }

  it("skips comparison artifacts for a first brief", async () => {
    const generator = new FakeGenerator();
    await firstBrief(generator);
    expect(generator.labels).toEqual(["brief"]);
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith(".comparison.json"))).toBe(false);
    expect(files.some((f) => f.endsWith(".revision-narrative.json"))).toBe(
      false,
    );
  });

  it("writes previous-brief marks, the .revchanges.json compat alias, and the narrative for a non-first brief", async () => {
    const generator = new FakeGenerator();
    await firstBrief(generator);
    fetched.meta = makeMeta(HEAD_2);
    await generateAndWrite(dir, URL, undefined, generator, () => {});

    expect(generator.labels).toEqual(["brief", "brief", "revision narrative"]);

    const marksFile = join(
      dir,
      "o-r-1_previous-brief_aaaa1111-bbbb2222.comparison.json",
    );
    const marks = (await readJson(marksFile)) as Record<string, unknown>;
    expect(marks["baselineLabel"]).toBe("previous-brief");
    expect(marks["baselineSha"]).toBe(HEAD_1);
    expect(marks["headSha"]).toBe(HEAD_2);
    expect(marks["baselineIndex"]).toBe(1);

    const compat = (await readJson(
      join(dir, "o-r-1_2_bbbb2222.revchanges.json"),
    )) as Record<string, unknown>;
    expect(compat["prevHeadSha"]).toBe(HEAD_1);
    expect(compat["prevIndex"]).toBe(1);

    const narrative = (await readJson(
      join(dir, "o-r-1_2_bbbb2222.revision-narrative.json"),
    )) as Record<string, unknown>;
    expect(narrative["artifactKind"]).toBe("revisionNarrative");
    expect(narrative["prevHeadSha"]).toBe(HEAD_1);
    expect(narrative["headIndex"]).toBe(2);
  });

  // Pins the CLI call-site wiring of `marksFiles`: if the caller drops it, both
  // overlap directions silently stop running and no other assertion notices.
  it("lands coverage warnings in the written narrative when the model under-covers the span", async () => {
    class UnderCoveringGenerator extends FakeGenerator {
      override async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        if (req.label === "revision narrative") {
          return req.schema.parse({ overview: "sparse", chunks: [] });
        }
        return super.generate(req);
      }
    }
    const generator = new UnderCoveringGenerator();
    await firstBrief(generator);
    fetched.meta = makeMeta(HEAD_2);
    await generateAndWrite(dir, URL, undefined, generator, () => {});

    const narrative = (await readJson(
      join(dir, "o-r-1_2_bbbb2222.revision-narrative.json"),
    )) as Record<string, unknown>;
    const warnings = narrative["generationWarnings"];
    expect(Array.isArray(warnings)).toBe(true);
    // Incremental-diff marks are src/a.ts added 6-7; the empty narrative covers nothing.
    expect(
      (warnings as string[]).some(
        (w) => w.includes("revision narrative coverage") && w.includes("6-7"),
      ),
    ).toBe(true);
  });

  it("does not fail the brief when narrative generation fails; marks stay on disk", async () => {
    const generator = new FakeGenerator(["revision narrative"]);
    await firstBrief(generator);
    fetched.meta = makeMeta(HEAD_2);
    const logs: string[] = [];
    const brief = await generateAndWrite(dir, URL, undefined, generator, (m) =>
      logs.push(m),
    );

    expect(brief.index).toBe(2);
    expect(existsSync(join(dir, "o-r-1_2_bbbb2222.brief.json"))).toBe(true);
    expect(
      existsSync(
        join(dir, "o-r-1_previous-brief_aaaa1111-bbbb2222.comparison.json"),
      ),
    ).toBe(true);
    expect(
      existsSync(join(dir, "o-r-1_2_bbbb2222.revision-narrative.json")),
    ).toBe(false);
    expect(
      logs.some((l) => l.includes("revision narrative generation failed")),
    ).toBe(true);
  });

  it("writes marks + a 'span too large' stub (no LLM call) for an over-threshold span", async () => {
    const generator = new FakeGenerator();
    await firstBrief(generator);
    fetched.meta = makeMeta(HEAD_2);
    fetched.compareDiff = wholePrDiff; // incremental span == whole PR → ratio 1
    await generateAndWrite(dir, URL, undefined, generator, () => {});

    expect(generator.labels).toEqual(["brief", "brief"]); // no narrative call
    expect(
      existsSync(
        join(dir, "o-r-1_previous-brief_aaaa1111-bbbb2222.comparison.json"),
      ),
    ).toBe(true);
    const stub = (await readJson(
      join(dir, "o-r-1_2_bbbb2222.revision-narrative.json"),
    )) as Record<string, unknown>;
    expect(stub["artifactKind"]).toBe("revisionNarrativeSkipped");
    expect(stub["skipped"]).toBe("span too large");
  });

  it("writes marks + a 'disabled by config' stub when the narrative gate is off", async () => {
    const generator = new FakeGenerator();
    await firstBrief(generator);
    fetched.meta = makeMeta(HEAD_2);
    process.env["REVISION_NARRATIVE_ENABLED"] = "false";
    await generateAndWrite(dir, URL, undefined, generator, () => {});

    expect(generator.labels).toEqual(["brief", "brief"]); // no narrative call
    expect(
      existsSync(
        join(dir, "o-r-1_previous-brief_aaaa1111-bbbb2222.comparison.json"),
      ),
    ).toBe(true);
    const stub = (await readJson(
      join(dir, "o-r-1_2_bbbb2222.revision-narrative.json"),
    )) as Record<string, unknown>;
    expect(stub["skipped"]).toBe("disabled by config");
  });
});

// --- delta-cli checkpoint marks -------------------------------------------------

describe("generateAndWriteDelta checkpoint marks", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "delta-marks-"));
    fetched.meta = makeMeta(HEAD_2);
    fetched.compareDiff = incrementalDiff;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const marksFile = (): string =>
    join(dir, "o-r-1_checkpoint_cccc3333-bbbb2222.comparison.json");

  it("writes checkpoint marks BEFORE the delta LLM call", async () => {
    let marksExistedAtLlmCall = false;
    const generator = new FakeGenerator([], (label) => {
      if (label === "delta") marksExistedAtLlmCall = existsSync(marksFile());
    });
    await generateAndWriteDelta(
      dir,
      URL,
      CHECKPOINT,
      HEAD_2,
      generator,
      () => {},
    );

    expect(marksExistedAtLlmCall).toBe(true);
    const marks = (await readJson(marksFile())) as Record<string, unknown>;
    expect(marks["baselineLabel"]).toBe("checkpoint");
    expect(marks["baselineSha"]).toBe(CHECKPOINT);
    // Neither end briefed in this out dir → null baseline index.
    expect(marks["baselineIndex"]).toBeNull();
  });

  it("leaves the marks sidecar on disk when the delta LLM call fails", async () => {
    const generator = new FakeGenerator(["delta"]);
    await expect(
      generateAndWriteDelta(dir, URL, CHECKPOINT, HEAD_2, generator, () => {}),
    ).rejects.toThrow(/simulated delta failure/);

    expect(existsSync(marksFile())).toBe(true);
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith(".delta.json"))).toBe(false);
  });
});
