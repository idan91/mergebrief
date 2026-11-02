import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod/v4";
import type {
  Effort,
  GenerateRequest,
  Generation,
  Generator,
} from "generators";
import type * as BriefCoreModule from "brief-core";
import type * as PrSpanModule from "brief-core/pr-span";
import type * as GithubModule from "../../src/github";

// Mock the github module so generateAndWrite / generateAndWriteDelta never
// shell out to `gh`, same fixtures serve both the whole-PR and incremental
// fetches.
const fetched = vi.hoisted(() => ({
  meta: undefined as BriefCoreModule.PrMetadata | undefined,
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
    // Fixture SHAs are 16-char; pass them through instead of hitting `gh`.
    resolveFullSha: vi.fn(async (_loc: unknown, ref: string) => ref),
  };
  return {
    ...actual,
    ...mocked,
    // The default PrSource must ride the SAME mocks, the real `ghPrSource`
    // binds the unmocked gh functions at module init.
    ghPrSource: { ...actual.ghPrSource, ...mocked },
  };
});

// The span builder is brief-core's own (tested there); the CLI's wiring is
// what these tests pin, so the span read answers the compare fixture.
const span = vi.hoisted(() => ({
  refs: [] as unknown[],
  unchanged: false,
  failure: undefined as string | undefined,
}));
vi.mock("brief-core/pr-span", async (importOriginal) => {
  const actual = await importOriginal<typeof PrSpanModule>();
  return {
    ...actual,
    readPrSpan: vi.fn(async (_source: unknown, refs: unknown) => {
      span.refs.push(refs);
      if (span.failure !== undefined) {
        return { ok: false, error: { kind: span.failure } };
      }
      const filteredDiff = span.unchanged ? "" : fetched.compareDiff;
      return {
        ok: true,
        value: {
          changedFiles: [],
          unchangedFiles: [],
          filteredDiff,
          unfilteredDiff: filteredDiff,
          hop: [],
          unpairableFiles: [],
          isUnchanged: span.unchanged,
        },
      };
    }),
  };
});

vi.mock("brief-core", async (importOriginal) => {
  const actual = await importOriginal<typeof BriefCoreModule>();
  return {
    ...actual,
    fetchContextSnippets: vi.fn(async () => ({ links: [] })),
  };
});

const { generateAndWrite } = await import("../../src/cli/categorize");
const { generateAndWriteDelta } = await import("../../src/cli/delta");

// --- Fixtures ---------------------------------------------------------------

const URL = "https://github.com/o/r/pull/1";
const HEAD_1 = "aaaa111100000000";
const HEAD_2 = "bbbb222200000000";
const CHECKPOINT = "cccc333300000000";

function makeMeta(sha: string): BriefCoreModule.PrMetadata {
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
    if (fixture === undefined) {
      throw new Error(`no fixture for label "${req.label}"`);
    }
    return req.schema.parse(fixture);
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

// --- generateAndWrite wiring --------------------------------------------------

describe("generateAndWrite comparison artifacts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "narrative-"));
    fetched.prDiff = wholePrDiff;
    fetched.compareDiff = incrementalDiff;
    span.refs = [];
    span.unchanged = false;
    span.failure = undefined;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
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

  it("writes marks, the compat alias and the narrative for a non-first brief", async () => {
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

  it("reads the span from the previous brief's base to the PR's base", async () => {
    const generator = new FakeGenerator();
    await firstBrief(generator);
    fetched.meta = { ...makeMeta(HEAD_2), baseSha: "base111111111111" };
    await generateAndWrite(dir, URL, undefined, generator, () => {});

    expect(span.refs).toEqual([
      {
        prevBase: "base000000000000",
        prevHead: HEAD_1,
        newBase: "base111111111111",
        newHead: HEAD_2,
      },
    ]);
  });

  it("writes zero-file marks and the no-change record for an unchanged span", async () => {
    const generator = new FakeGenerator();
    await firstBrief(generator);
    fetched.meta = makeMeta(HEAD_2);
    span.unchanged = true;
    await generateAndWrite(dir, URL, undefined, generator, () => {});

    expect(generator.labels).toEqual(["brief", "brief"]);
    const marks = (await readJson(
      join(dir, "o-r-1_previous-brief_aaaa1111-bbbb2222.comparison.json"),
    )) as Record<string, unknown>;
    expect(marks["files"]).toEqual([]);
    const record = (await readJson(
      join(dir, "o-r-1_2_bbbb2222.revision-narrative.json"),
    )) as Record<string, unknown>;
    expect(record).toEqual({
      artifactKind: "revisionNarrativeUnchanged",
      pr: expect.anything(),
      prevHeadSha: HEAD_1,
      headSha: HEAD_2,
      prevIndex: 1,
      headIndex: 2,
    });
  });

  it("writes only the skip stub when GitHub refuses the span", async () => {
    const generator = new FakeGenerator();
    await firstBrief(generator);
    fetched.meta = makeMeta(HEAD_2);
    span.failure = "too-large";
    await generateAndWrite(dir, URL, undefined, generator, () => {});

    expect(generator.labels).toEqual(["brief", "brief"]);
    const files = await readdir(dir);
    expect(files.some((f) => f.includes("_previous-brief_"))).toBe(false);
    const stub = (await readJson(
      join(dir, "o-r-1_2_bbbb2222.revision-narrative.json"),
    )) as Record<string, unknown>;
    expect(stub["skipped"]).toBe("span too large");
  });

  it("anchors a follow-up brief on the previous brief from disk", async () => {
    class BriefRecordingGenerator extends FakeGenerator {
      readonly briefUsers: string[] = [];
      override async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        if (req.label === "brief") {
          this.briefUsers.push(req.user);
        }
        return super.generate(req);
      }
    }
    const generator = new BriefRecordingGenerator();
    await firstBrief(generator);
    fetched.meta = makeMeta(HEAD_2);

    const brief = await generateAndWrite(
      dir,
      URL,
      undefined,
      generator,
      () => {},
    );

    expect(generator.briefUsers[0]).not.toContain("<anchor_brief");
    expect(generator.briefUsers[1]).toContain("<anchor_brief");
    expect(brief.anchor).toEqual({ state: "anchored" });
  });

  // Pins the CLI call-site wiring of `marksFiles`: if the caller drops it, both
  // overlap directions silently stop running and no other assertion notices.
  it("lands coverage warnings when the model under-covers the span", async () => {
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

  it("keeps the brief and the on-disk marks when narrative generation fails", async () => {
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

  it("writes marks and a span-too-large stub with no LLM call", async () => {
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

  it("writes marks and a disabled-by-config stub when the gate is off", async () => {
    const generator = new FakeGenerator();
    await firstBrief(generator);
    fetched.meta = makeMeta(HEAD_2);
    await generateAndWrite(
      dir,
      URL,
      undefined,
      generator,
      () => {},
      undefined,
      undefined,
      { revisionNarrative: { enabled: false } },
    );

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
    span.refs = [];
    span.unchanged = false;
    span.failure = undefined;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const marksFile = (): string =>
    join(dir, "o-r-1_checkpoint_cccc3333-bbbb2222.comparison.json");

  it("reads an unbriefed checkpoint's span from the PR's current base", async () => {
    await generateAndWriteDelta(
      dir,
      URL,
      CHECKPOINT,
      HEAD_2,
      new FakeGenerator(),
      () => {},
    );

    expect(span.refs).toEqual([
      {
        prevBase: "base000000000000",
        prevHead: CHECKPOINT,
        newBase: "base000000000000",
        newHead: HEAD_2,
      },
    ]);
  });

  it("writes the no-change record and makes no delta call when unchanged", async () => {
    const generator = new FakeGenerator();
    span.unchanged = true;
    const written = await generateAndWriteDelta(
      dir,
      URL,
      CHECKPOINT,
      HEAD_2,
      generator,
      () => {},
    );

    expect(generator.labels).toEqual([]);
    expect(written).toMatchObject({ artifactKind: "deltaUnchanged" });
    const files = await readdir(dir);
    const recordFile = files.find((f) => f.endsWith(".delta.json"));
    expect(recordFile).toBeDefined();
    const record = (await readJson(join(dir, String(recordFile)))) as Record<
      string,
      unknown
    >;
    expect(record["artifactKind"]).toBe("deltaUnchanged");
    const marks = (await readJson(marksFile())) as Record<string, unknown>;
    expect(marks["files"]).toEqual([]);
  });

  it("writes the span-too-large skip record with no marks or delta call", async () => {
    const generator = new FakeGenerator();
    span.failure = "too-large";
    const written = await generateAndWriteDelta(
      dir,
      URL,
      CHECKPOINT,
      HEAD_2,
      generator,
      () => {},
    );

    expect(generator.labels).toEqual([]);
    expect(written).toMatchObject({
      artifactKind: "deltaSkipped",
      skipped: "span-too-large",
    });
    const files = await readdir(dir);
    const recordFile = files.find((f) => f.endsWith(".delta.json"));
    const record = (await readJson(join(dir, String(recordFile)))) as Record<
      string,
      unknown
    >;
    expect(record["skipped"]).toBe("span-too-large");
    expect(existsSync(marksFile())).toBe(false);
  });

  it("throws on a span it could not read for another reason", async () => {
    span.failure = "unavailable";

    await expect(
      generateAndWriteDelta(
        dir,
        URL,
        CHECKPOINT,
        HEAD_2,
        new FakeGenerator(),
        () => {},
      ),
    ).rejects.toThrow("revision span unread: unavailable");
  });

  it("writes checkpoint marks BEFORE the delta LLM call", async () => {
    let marksExistedAtLlmCall = false;
    const generator = new FakeGenerator([], (label) => {
      if (label === "delta") {
        marksExistedAtLlmCall = existsSync(marksFile());
      }
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
