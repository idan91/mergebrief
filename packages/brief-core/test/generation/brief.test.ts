import { describe, expect, it } from "vitest";
import type { CompareFiles } from "../../src/anchoring/types";
import { generateBrief } from "../../src/generation/brief";
import type {
  GenerateBriefOptions,
  GenerateBriefOutput,
  PreviousBriefInput,
} from "../../src/generation/brief/types";
import type { RepoContext } from "../../src/generation/repo-context";
import type { GenerationWarning } from "../../src/generation/warnings/types";
import type { FetchedPr } from "../../src/github/types";
import { RiskSurfaceAttributes, type Brief } from "../../src/types";
import { FakeGenerator } from "../helpers";
import { retryPr, retryRepoContext } from "./fixtures/retry-pr";
import { makePnpmLockfile, summarizeTexts } from "./shortened/helpers";

const OVER_CAP_SUMMARY = "s".repeat(300);
const BILLING_ATTRIBUTE = "touches-billing";
const LEDGER_ATTRIBUTE = "touches-ledger";

/** Answers each request with the next queued output. */
function makeQueuedGenerator(outputs: unknown[]): FakeGenerator {
  return new FakeGenerator((_request, index) => outputs[index]);
}

const wholeDiff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "@@ -0,0 +1,2 @@",
  "+a1",
  "+a2",
  "diff --git a/src/b.ts b/src/b.ts",
  "@@ -0,0 +1,3 @@",
  "+b1",
  "+b2",
  "+b3",
  "",
].join("\n");

const incrementalDiff = [
  "diff --git a/src/b.ts b/src/b.ts",
  "@@ -1,2 +1,3 @@",
  " b1",
  " b2",
  "+b3",
  "",
].join("\n");

const compareFiles: CompareFiles = {
  files: [{ filename: "src/b.ts", status: "modified" }],
  complete: true,
  status: "ahead",
};

const pr: FetchedPr = {
  locator: { owner: "o", repo: "r", number: 1 },
  meta: {
    title: "t",
    body: "d",
    url: "https://github.com/o/r/pull/1",
    sha: "head2000",
    baseSha: "base0000",
    commitCount: 2,
    files: [
      { path: "src/a.ts", additions: 2, deletions: 0 },
      { path: "src/b.ts", additions: 3, deletions: 0 },
    ],
  },
  diff: wholeDiff,
  links: [],
};

const commitRange = { base: "base0000", head: "head2000", commitCount: 2 };

const noneIntentCheck = {
  ticketUrls: [],
  ticketTitles: [],
  specificity: "none",
  scopeNote: "",
  items: [],
  alignment: { read: "", goal: "", response: "" },
};

function makeGroup(id: string, summary = "group summary"): unknown {
  return {
    id,
    title: `group ${id}`,
    summary,
    dominantCategory: "new-feature",
    secondaryCategories: [],
    uncertain: false,
    uncertainBetween: [],
  };
}

function makeChunk(
  id: string,
  groupId: string,
  file: string,
  end: number,
  start = 1,
) {
  return {
    id,
    changeGroupId: groupId,
    file,
    concern: "implementation",
    role: "core",
    addedRanges: [{ start, end }],
    removedRanges: [],
    riskSurface: [] as string[],
  };
}

const baseOutput = {
  summary: "s",
  intentCheck: noneIntentCheck,
  changeGroups: [makeGroup("g1", OVER_CAP_SUMMARY), makeGroup("g2")],
  chunks: [
    makeChunk("c1", "g1", "src/a.ts", 2),
    makeChunk("c2", "g2", "src/b.ts", 2),
  ],
};

const revisedOutput = {
  summary: "s",
  intentCheck: noneIntentCheck,
  changeGroups: [makeGroup("t1")],
  chunks: [makeChunk("c9", "t1", "src/b.ts", 3)],
};

function makeRepoContext(name: string, paths?: string[]): RepoContext {
  const attribute: { name: string; criteria: string; paths?: string[] } = {
    name,
    criteria: `fires on ${name}`,
  };
  if (paths !== undefined) {
    attribute.paths = paths;
  }

  return { customAttributes: [attribute] };
}

async function makePreviousBrief(
  output: unknown = baseOutput,
  repoContext?: RepoContext,
): Promise<Brief> {
  const options: GenerateBriefOptions = {
    pr,
    headIndex: 1,
    commitRange,
    generator: makeQueuedGenerator([output]),
    repoContext,
  };

  return (await generateBrief(options)).brief;
}

function makePrevious(brief: Brief): PreviousBriefInput {
  return { brief, incrementalDiff, compareFiles, baseShaMoved: false };
}

async function runAnchored(
  output: unknown,
  previousBrief?: Brief,
  overrides: Partial<GenerateBriefOptions> = {},
): Promise<GenerateBriefOutput> {
  return generateBrief({
    pr,
    headIndex: 2,
    commitRange,
    generator: makeQueuedGenerator([output]),
    previous: makePrevious(previousBrief ?? (await makePreviousBrief())),
    ...overrides,
  });
}

function listChecks(warnings: readonly GenerationWarning[]): string[] {
  return warnings.flatMap((warning) =>
    warning.kind === "validation" ? [warning.check] : [],
  );
}

function findIssues(
  warnings: readonly GenerationWarning[],
  check: string,
): readonly string[] {
  const found = warnings.find(
    (warning) => warning.kind === "validation" && warning.check === check,
  );
  return found?.kind === "validation" ? found.issues : [];
}

describe("generateBrief, a fresh run", () => {
  it("stamps the stored lines from the typed warnings", async () => {
    const result = await generateBrief({
      pr,
      headIndex: 1,
      commitRange,
      generator: makeQueuedGenerator([baseOutput]),
    });

    expect(listChecks(result.warnings)).toContain("text length");
    expect(result.brief.generationWarnings).toHaveLength(
      result.warnings.length,
    );
    expect(result.anchoring).toBeUndefined();
  });

  it("drops a chunk naming an unknown group into the unattributed remainder", async () => {
    const ghostOutput = {
      ...baseOutput,
      chunks: [
        makeChunk("c1", "g1", "src/a.ts", 2),
        makeChunk("c2", "g2", "src/b.ts", 2),
        makeChunk("c3", "ghost", "src/b.ts", 3, 3),
      ],
    };

    const result = await generateBrief({
      pr,
      headIndex: 1,
      commitRange,
      generator: makeQueuedGenerator([ghostOutput]),
    });

    expect(result.brief.chunks.map((chunk) => chunk.id)).toEqual(["c1", "c2"]);
    expect(result.brief.unattributed).toEqual([
      {
        file: "src/b.ts",
        addedRanges: [{ start: 3, end: 3 }],
        removedRanges: [],
      },
    ]);
    expect(findIssues(result.warnings, "unknown group")).toEqual([
      expect.stringContaining(
        'chunk c3 (src/b.ts) names unknown group "ghost"',
      ),
    ]);
    expect(findIssues(result.warnings, "partition")).toEqual([]);
  });

  it("names a PR file no chunk covers, ranges or not", async () => {
    const withBinary: FetchedPr = {
      ...pr,
      meta: {
        ...pr.meta,
        files: [
          ...pr.meta.files,
          { path: "logo.png", additions: 0, deletions: 0 },
        ],
      },
    };

    const result = await generateBrief({
      pr: withBinary,
      headIndex: 1,
      commitRange,
      generator: makeQueuedGenerator([baseOutput]),
    });

    expect(findIssues(result.warnings, "loc coverage")).toContainEqual(
      expect.stringContaining("file(s) in no group — logo.png"),
    );
  });

  it("logs the call plan it would take and still makes one call", async () => {
    const lines: string[] = [];
    const generator = makeQueuedGenerator([baseOutput]);

    await generateBrief({
      pr,
      headIndex: 1,
      commitRange,
      generator,
      log: (line) => lines.push(line),
    });

    expect(lines).toContain(
      "call plan: single (estimated diff 59 tokens, 2 hunks)",
    );
    expect(generator.requests).toHaveLength(1);
  });
});

const singleCallOutput = {
  summary: "Bounds the retry loop.",
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
      title: "Bound the retry loop",
      summary: "Caps attempts at three.",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "c1",
      changeGroupId: "g1",
      file: "src/retry.ts",
      concern: "implementation",
      role: "core",
      addedRanges: [{ start: 2, end: 2 }],
      removedRanges: [{ start: 2, end: 2 }],
      riskSurface: [],
    },
  ],
};

function stubSingleCallGenerator(): FakeGenerator {
  return new FakeGenerator(() => singleCallOutput);
}

function renderRequest(
  request: FakeGenerator["requests"][number] | undefined,
): string {
  if (request === undefined) {
    return "(no request)";
  }
  const header = [
    `label: ${request.label}`,
    `effort: ${request.effort}`,
    `salvageFields: ${request.salvageFields.join(", ")}`,
  ].join("\n");
  return `${header}\n\n=== system ===\n${request.system}\n\n=== user ===\n${request.user}\n`;
}

function makeSingleCallOptions(generator: FakeGenerator): GenerateBriefOptions {
  return {
    pr: retryPr,
    headIndex: 1,
    commitRange: { base: "base0042", head: "head0042", commitCount: 3 },
    generator,
    repoContext: retryRepoContext,
  };
}

describe("generateBrief, the single-call request byte for byte", () => {
  it("a fresh brief sends today's request", async () => {
    const generator = stubSingleCallGenerator();

    await generateBrief(makeSingleCallOptions(generator));

    expect(generator.requests).toHaveLength(1);
    await expect(renderRequest(generator.requests[0])).toMatchFileSnapshot(
      "./__snapshots__/single-call-fresh.txt",
    );
  });

  it("an anchored brief sends today's request", async () => {
    const previous = await generateBrief(
      makeSingleCallOptions(stubSingleCallGenerator()),
    );
    const generator = stubSingleCallGenerator();

    await generateBrief({
      ...makeSingleCallOptions(generator),
      headIndex: 2,
      previous: { brief: previous.brief, baseShaMoved: false },
    });

    expect(generator.requests).toHaveLength(1);
    await expect(renderRequest(generator.requests[0])).toMatchFileSnapshot(
      "./__snapshots__/single-call-anchored.txt",
    );
  });
});

describe("generateBrief, an anchored run", () => {
  it("carries the frozen group and returns its chunk ids", async () => {
    const generator = makeQueuedGenerator([revisedOutput]);

    const result = await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator,
      previous: makePrevious(await makePreviousBrief()),
    });

    const { brief, anchoring } = result;
    expect(brief.changeGroups.map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(anchoring?.carriedGroupIds).toEqual(["g1"]);
    expect(anchoring?.carriedChunkIds).toEqual(["c1"]);
    expect(anchoring?.regeneratedGroupIds).toEqual(["g2"]);
    expect(generator.requests[0]?.user).toContain("<anchor_brief");
  });

  it("rolls concerns and totals up over carried and regenerated chunks", async () => {
    const result = await runAnchored(revisedOutput);

    expect(result.brief.concernView).toEqual([
      { concern: "implementation", added: 5, deleted: 0 },
    ]);
    expect(result.brief.diffTotals).toEqual({ added: 5, deleted: 0 });
    expect(result.brief.unattributed).toEqual([]);
  });

  it("hands the plan to the hook before the model call", async () => {
    const generator = makeQueuedGenerator([revisedOutput]);
    const seen: { frozen: number; requests: number }[] = [];

    await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator,
      previous: {
        ...makePrevious(await makePreviousBrief()),
        onPlan: async (plan) => {
          seen.push({
            frozen: plan.frozen.length,
            requests: generator.requests.length,
          });
        },
      },
    });

    expect(seen).toEqual([{ frozen: 1, requests: 0 }]);
  });

  it("returns the stitch's issues as one typed warning", async () => {
    const reEmitted = {
      ...revisedOutput,
      changeGroups: [makeGroup("g1"), makeGroup("t1")],
      chunks: [...revisedOutput.chunks, makeChunk("c8", "g1", "src/a.ts", 2)],
    };

    const result = await runAnchored(reEmitted);

    expect(result.warnings).toContainEqual({
      kind: "validation",
      check: "anchored stitch",
      issues: expect.arrayContaining([
        expect.stringContaining("re-emitted without a new file"),
      ]),
    });
  });

  it("keeps a file split across two groups instead of failing", async () => {
    const split = {
      ...revisedOutput,
      changeGroups: [makeGroup("t1"), makeGroup("t2")],
      chunks: [
        makeChunk("c9", "t1", "src/b.ts", 2),
        makeChunk("c7", "t2", "src/b.ts", 3, 3),
      ],
    };

    const result = await runAnchored(split);

    const owners = result.brief.chunks
      .filter((chunk) => chunk.file === "src/b.ts")
      .map((chunk) => chunk.changeGroupId);
    expect(new Set(owners).size).toBe(2);
    expect(result.brief.unattributed).toEqual([]);
  });

  it("drops a chunk naming an unknown group into the unattributed remainder", async () => {
    const ghostOutput = {
      ...revisedOutput,
      chunks: [
        makeChunk("c9", "t1", "src/b.ts", 2),
        makeChunk("c6", "ghost", "src/b.ts", 3, 3),
      ],
    };

    const result = await runAnchored(ghostOutput);

    expect(result.brief.chunks.map((chunk) => chunk.id)).toEqual(["c1", "c9"]);
    expect(result.brief.unattributed).toEqual([
      {
        file: "src/b.ts",
        addedRanges: [{ start: 3, end: 3 }],
        removedRanges: [],
      },
    ]);
    expect(findIssues(result.warnings, "unknown group")).toEqual([
      expect.stringContaining(
        'chunk c6 (src/b.ts) names unknown group "ghost"',
      ),
    ]);
  });

  it("measures text length once over the merged set under final ids", async () => {
    const verbose = {
      ...revisedOutput,
      changeGroups: [makeGroup("t1", OVER_CAP_SUMMARY)],
    };

    const result = await runAnchored(verbose);

    expect(
      listChecks(result.warnings).filter((check) => check === "text length"),
    ).toHaveLength(1);
    expect(result.brief.lengthViolations?.map((found) => found.field)).toEqual([
      "group g1 summary",
      "group g2 summary",
    ]);
    const stored = result.brief.generationWarnings ?? [];
    expect(stored.filter((line) => line.includes("text length"))).toHaveLength(
      1,
    );
    expect(stored.join("\n")).not.toContain("t1");
  });

  it("reports a chunk overlap once under the final chunk ids", async () => {
    const overlapping = {
      ...revisedOutput,
      chunks: [
        makeChunk("c9", "t1", "src/b.ts", 3),
        makeChunk("c1", "t1", "src/b.ts", 3, 2),
      ],
    };

    const result = await runAnchored(overlapping);

    expect(findIssues(result.warnings, "loc overlap")).toEqual([
      expect.stringContaining("c2"),
    ]);
    const stored = result.brief.generationWarnings ?? [];
    expect(stored.filter((line) => line.includes("overlap"))).toHaveLength(1);
  });

  it("keeps a carried chunk's attribute token this run no longer defines", async () => {
    const firing = {
      ...baseOutput,
      chunks: [
        {
          ...makeChunk("c1", "g1", "src/a.ts", 2),
          riskSurface: [BILLING_ATTRIBUTE],
        },
        makeChunk("c2", "g2", "src/b.ts", 2),
      ],
    };
    const previousBrief = await makePreviousBrief(
      firing,
      makeRepoContext(BILLING_ATTRIBUTE),
    );
    const outOfScope = {
      ...revisedOutput,
      chunks: [
        {
          ...makeChunk("c9", "t1", "src/b.ts", 3),
          riskSurface: [LEDGER_ATTRIBUTE],
        },
      ],
    };

    const result = await runAnchored(outOfScope, previousBrief, {
      repoContext: makeRepoContext(LEDGER_ATTRIBUTE, ["src/a.ts"]),
    });

    const byId = new Map(result.brief.chunks.map((chunk) => [chunk.id, chunk]));
    expect(byId.get("c1")?.riskSurface).toEqual([BILLING_ATTRIBUTE]);
    expect(byId.get("c9")?.riskSurface).toEqual([]);
    expect(findIssues(result.warnings, "repo attrs")).toEqual([
      expect.stringContaining("chunk c9 (src/b.ts)"),
    ]);
  });

  it("strips a carried chunk's adds-secret the diff no longer supports", async () => {
    const previousBrief = await makePreviousBrief();
    const stale: Brief = {
      ...previousBrief,
      chunks: previousBrief.chunks.map((chunk) => ({
        ...chunk,
        riskSurface: [RiskSurfaceAttributes.ADDS_SECRET],
      })),
    };

    const result = await runAnchored(revisedOutput, stale);

    expect(result.brief.chunks.map((chunk) => chunk.riskSurface)).toEqual([
      [],
      [],
    ]);
  });

  it("drops a carried lockfile chunk's package flag once sources hold", async () => {
    const lockfile = "pnpm-lock.yaml";
    const lockPr: FetchedPr = {
      ...pr,
      meta: {
        ...pr.meta,
        files: [
          ...pr.meta.files,
          { path: lockfile, additions: 1, deletions: 1 },
        ],
      },
      diff: `${wholeDiff}diff --git a/${lockfile} b/${lockfile}\n@@ -1,1 +1,1 @@\n-x\n+y\n`,
    };
    const lockChunk = {
      ...makeChunk("c3", "g1", lockfile, 1),
      removedRanges: [{ start: 1, end: 1 }],
    };
    const previous = await generateBrief({
      pr: lockPr,
      headIndex: 1,
      commitRange,
      generator: makeQueuedGenerator([
        { ...baseOutput, chunks: [...baseOutput.chunks, lockChunk] },
      ]),
    });
    const keepsHost = new Map([
      [
        lockfile,
        summarizeTexts(
          lockfile,
          makePnpmLockfile({
            "left-pad@1.3.0": "resolution: {integrity: sha512-a}",
          }),
          makePnpmLockfile({
            "left-pad@1.3.1": "resolution: {integrity: sha512-b}",
          }),
        )!,
      ],
    ]);
    const readLockFlags = (result: GenerateBriefOutput) =>
      result.brief.chunks.find((chunk) => chunk.file === lockfile)?.riskSurface;

    const unread = await runAnchored(revisedOutput, previous.brief, {
      pr: lockPr,
    });
    const quiet = await runAnchored(revisedOutput, previous.brief, {
      pr: lockPr,
      lockfileSummaries: keepsHost,
    });

    expect(readLockFlags(previous)).toEqual([
      RiskSurfaceAttributes.CHANGES_PACKAGE_SOURCE,
    ]);
    expect(readLockFlags(unread)).toEqual([
      RiskSurfaceAttributes.CHANGES_PACKAGE_SOURCE,
    ]);
    expect(readLockFlags(quiet)).toEqual([]);
  });

  it("drops a carried chunk on a file the PR no longer changes", async () => {
    const departedPr: FetchedPr = {
      ...pr,
      meta: {
        ...pr.meta,
        files: [{ path: "src/b.ts", additions: 3, deletions: 0 }],
      },
      diff: wholeDiff.slice(wholeDiff.indexOf("diff --git a/src/b.ts")),
    };

    const result = await runAnchored(revisedOutput, undefined, {
      pr: departedPr,
    });

    expect(result.brief.chunks.map((chunk) => chunk.file)).toEqual([
      "src/b.ts",
    ]);
    expect(result.brief.changeGroups.map((group) => group.id)).toEqual(["g2"]);
    expect(findIssues(result.warnings, "anchored stitch")).toContainEqual(
      expect.stringContaining("carried chunk c1 on src/a.ts dropped"),
    );
  });
});
