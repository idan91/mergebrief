import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import {
  categorizeDelta,
  categorizeRevisionNarrative,
} from "../../src/generation/categorize";
import type {
  Effort,
  GenerateRequest,
  Generation,
  Generator,
} from "generators";
import { BriefSchema, type Brief } from "../../src/types";
import type { PrMetadata } from "../../src/github/types";

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
  maskedFixes: [],
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
    alignment: { read: "", goal: "", response: "" },
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
 * drifts from the schema fails loudly.
 */
class FakeGenerator implements Generator {
  /** Effort of each request, in call order. */
  readonly efforts: (Effort | undefined)[] = [];

  origin(effort: Effort): Generation {
    return { provider: "fake", model: "fake-model", effort };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    this.efforts.push(req.effort);
    const fixtures: Record<string, unknown> = {
      delta: deltaGen,
      "revision narrative": narrativeGen,
    };
    const fixture = fixtures[req.label];
    if (fixture === undefined) {
      throw new Error(`no fixture for label "${req.label}"`);
    }
    return req.schema.parse(fixture);
  }
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

  it("warns without throwing on an unknown briefChangeGroupId reference", async () => {
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

describe("effort threading, delta + narrative", () => {
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

  it("delta defaults to medium in request and origin, pinned byte-identical", async () => {
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

// --- text length floor, delta + narrative pipelines -----------------------

describe("text length floor, delta + narrative pipelines", () => {
  /** FakeGenerator with per-label fixture overrides for over-cap text. */
  class OverridingGenerator extends FakeGenerator {
    constructor(private readonly overrides: Record<string, unknown>) {
      super();
    }

    override async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      const fixture = this.overrides[req.label];
      if (fixture !== undefined) {
        return req.schema.parse(fixture);
      }
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
