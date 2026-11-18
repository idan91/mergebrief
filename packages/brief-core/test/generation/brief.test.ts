import { describe, expect, it } from "vitest";
import { buildPrSpan } from "../../src/diff/pr-span";
import { buildFastForwardSpan } from "../../src/diff/pr-span/logic/fast-forward-span";
import { generateBrief } from "../../src/generation/brief";
import type {
  GenerateBriefOptions,
  GenerateBriefOutput,
  PreviousBriefInput,
} from "../../src/generation/brief/types";
import type { RepoContext } from "../../src/generation/repo-context";
import {
  GenerationWarningKinds,
  type GenerationWarning,
} from "../../src/generation/warnings/types";
import type { FetchedPr } from "../../src/github/types";
import type { LockfileSummary } from "../../src/generation/shortened/types";
import { countLines } from "../../src/generation/loc";
import { buildAddressMediaKey, buildMermaidMediaKey } from "../../src/media";
import { ContextProviderTypes } from "../../src/context/types";
import {
  AnchorWarnings,
  BriefGenerationSchema,
  OutlineForms,
  RiskSurfaceAttributes,
  SummaryMediaPositions,
  type Brief,
  type LineRange,
} from "../../src/types";
import { GeneratorError, GeneratorErrorKinds } from "generators";
import { SUMMARY_MEDIA_LABEL } from "../../src/generation/summary-media/consts";
import { FakeGenerator, type RecordedRequest } from "../helpers";
import { pr as multiCallPr, singleBrief } from "./fixtures/multi-call-pr";
import { retryPr, retryRepoContext } from "./fixtures/retry-pr";
import {
  commitRange,
  incrementalDiff,
  makeChunk,
  makeGroup,
  noneIntentCheck,
  pr,
  wholeDiff,
} from "./fixtures/two-file-pr";
import { makePnpmLockfile, summarizeTexts } from "./shortened/helpers";
import {
  insertAfter,
  makeBaseLines,
  makeDiff,
  makeFilePatch,
  makeText,
} from "../diff/pr-span/helpers";

const OVER_CAP_SUMMARY = "s".repeat(300);
const BILLING_ATTRIBUTE = "touches-billing";
const LEDGER_ATTRIBUTE = "touches-ledger";
const GITHUB_TOKEN_LENGTH = 36;

/** Answers each request with the next queued output. */
function makeQueuedGenerator(outputs: unknown[]): FakeGenerator {
  return new FakeGenerator((_request, index) => outputs[index]);
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

/** The previous Brief over a plain push that touched only src/b.ts. */
function makePrevious(brief: Brief, newPrDiff = wholeDiff): PreviousBriefInput {
  const span = buildFastForwardSpan({
    betweenHeadsDiff: incrementalDiff,
    newPrDiff,
  });
  return { brief, span };
}

async function runAnchored(
  output: unknown,
  previousBrief?: Brief,
  overrides: Partial<GenerateBriefOptions> = {},
): Promise<GenerateBriefOutput> {
  const brief = previousBrief ?? (await makePreviousBrief());
  const newPrDiff = overrides.pr?.diff ?? pr.diff;
  return generateBrief({
    pr,
    headIndex: 2,
    commitRange,
    generator: makeQueuedGenerator([output]),
    previous: makePrevious(brief, newPrDiff),
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

/** Distinct changed lines the chunks and the remainder claim, per side, summed over files. */
function countClaimedLines(brief: Brief): { added: number; deleted: number } {
  const added = new Map<string, LineRange[]>();
  const deleted = new Map<string, LineRange[]>();
  for (const claim of [...brief.chunks, ...(brief.unattributed ?? [])]) {
    added.set(claim.file, [
      ...(added.get(claim.file) ?? []),
      ...claim.addedRanges,
    ]);
    deleted.set(claim.file, [
      ...(deleted.get(claim.file) ?? []),
      ...claim.removedRanges,
    ]);
  }
  const sum = (byFile: Map<string, LineRange[]>) =>
    [...byFile.values()].reduce(
      (total, ranges) => total + countLines(ranges),
      0,
    );
  return { added: sum(added), deleted: sum(deleted) };
}

describe("generateBrief, a fresh run", () => {
  it("claims exactly the diff's changed lines when a chunk over-claims", async () => {
    const overClaim = {
      ...baseOutput,
      chunks: [
        makeChunk("c1", "g1", "src/a.ts", 40),
        makeChunk("c2", "g2", "src/b.ts", 2),
      ],
    };

    const { brief } = await generateBrief({
      pr,
      headIndex: 1,
      commitRange,
      generator: makeQueuedGenerator([overClaim]),
    });

    expect(brief.chunks[0]?.addedRanges).toEqual([{ start: 1, end: 2 }]);
    expect(countClaimedLines(brief)).toEqual(brief.diffTotals);
  });

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
      previous: { brief: previous.brief },
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

  it("stores the plan's warning on the brief when no span was read", async () => {
    const generator = makeQueuedGenerator([revisedOutput]);

    const { brief } = await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator,
      previous: { brief: await makePreviousBrief() },
    });

    expect(brief.anchorWarnings).toEqual([AnchorWarnings.SPAN_UNAVAILABLE]);
  });

  it("stores a copied escaped summary heading as the heading it was", async () => {
    const headed = "Lede.\n### Notes\nBody.";
    const previousBrief = { ...(await makePreviousBrief()), summary: headed };
    const generator = makeQueuedGenerator([
      { ...revisedOutput, summary: "Lede.\n\\### Notes\nBody." },
    ]);

    const { brief } = await runAnchored(revisedOutput, previousBrief, {
      generator,
    });

    expect(generator.requests[0]?.user).toContain("Lede.\n\\### Notes\nBody.");
    expect(brief.summary).toBe(headed);
  });

  it("reads a frozen group's one-line id back as the stored id", async () => {
    const stored = "g1\nx";
    const base = await makePreviousBrief();
    const previousBrief: Brief = {
      ...base,
      changeGroups: base.changeGroups.map((group) =>
        group.id === "g1" ? { ...group, id: stored } : group,
      ),
      chunks: base.chunks.map((chunk) =>
        chunk.changeGroupId === "g1"
          ? { ...chunk, changeGroupId: stored }
          : chunk,
      ),
    };
    const generator = makeQueuedGenerator([
      {
        ...revisedOutput,
        readingOrder: [
          { groupId: "g1 x", why: "the base it builds on" },
          { groupId: "t1", why: "the reworked file" },
        ],
      },
    ]);

    const { brief } = await runAnchored(revisedOutput, previousBrief, {
      generator,
    });

    expect(generator.requests[0]?.user).toContain("- g1 x [");
    expect(brief.readingOrder?.map((step) => step.groupId)).toContain(stored);
  });

  it("stores no warning on a brief whose span paired every hunk", async () => {
    const { brief } = await runAnchored(revisedOutput);

    expect(brief.anchorWarnings).toBeUndefined();
  });

  it("keeps anchor warnings out of the model's output schema", () => {
    expect(Object.keys(BriefGenerationSchema.shape)).not.toContain(
      "anchorWarnings",
    );
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

  it("drops no-tests on a carried style chunk and keeps it on code", async () => {
    const styleFile = "src/a.scss";
    const stylePr: FetchedPr = {
      ...pr,
      meta: {
        ...pr.meta,
        files: pr.meta.files.map((file) =>
          file.path === "src/a.ts" ? { ...file, path: styleFile } : file,
        ),
      },
      diff: wholeDiff.replaceAll("src/a.ts", styleFile),
    };
    const generator = makeQueuedGenerator([
      {
        ...baseOutput,
        chunks: [
          makeChunk("c1", "g1", styleFile, 2),
          makeChunk("c2", "g2", "src/b.ts", 2),
        ],
      },
    ]);
    const previous = await generateBrief({
      pr: stylePr,
      headIndex: 1,
      commitRange,
      generator,
    });
    const stale: Brief = {
      ...previous.brief,
      chunks: previous.brief.chunks.map((chunk) => ({
        ...chunk,
        riskSurface: [RiskSurfaceAttributes.NO_TESTS],
      })),
    };
    const revised = {
      ...revisedOutput,
      chunks: [
        {
          ...makeChunk("c9", "t1", "src/b.ts", 3),
          riskSurface: [RiskSurfaceAttributes.NO_TESTS],
        },
      ],
    };

    const result = await runAnchored(revised, stale, { pr: stylePr });

    const byId = new Map(result.brief.chunks.map((chunk) => [chunk.id, chunk]));
    expect(byId.get("c1")?.riskSurface).toEqual([]);
    expect(byId.get("c9")?.riskSurface).toEqual([
      RiskSurfaceAttributes.NO_TESTS,
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

  it("re-looks a group whose file the PR no longer changes", async () => {
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
    expect(result.anchoring?.plan.reLook).toContainEqual(
      expect.objectContaining({ id: "g1", files: ["src/a.ts"] }),
    );
    expect(findIssues(result.warnings, "anchored stitch")).toEqual([]);
  });
});

/** The previous Brief over a push that changed nothing the PR changes. */
function makeUnchangedPrevious(brief: Brief): PreviousBriefInput {
  const span = buildFastForwardSpan({
    betweenHeadsDiff: "",
    newPrDiff: wholeDiff,
  });
  return { brief, span };
}

const addedFileDiff = [
  "diff --git a/src/c.ts b/src/c.ts",
  "@@ -0,0 +1,1 @@",
  "+c1",
  "",
].join("\n");

function makeTicketPr(key: string, body = pr.meta.body): FetchedPr {
  return {
    ...pr,
    meta: { ...pr.meta, body },
    primaryTicket: {
      status: "read",
      snippet: {
        providerId: "url",
        source: `https://tracker.example/${key}`,
        text: `Ticket ${key}`,
        tracker: "notion",
        key,
        title: `Ticket ${key}`,
        header: "",
        foundIn: "description",
      },
    },
  };
}

async function countCarryCalls(
  previousBrief: Brief,
  nextPr: FetchedPr,
): Promise<number> {
  const generator = makeQueuedGenerator([revisedOutput]);
  await generateBrief({
    pr: nextPr,
    headIndex: 2,
    commitRange,
    generator,
    previous: makeUnchangedPrevious(previousBrief),
  });
  return generator.requests.length;
}

describe("generateBrief, a push that left every group's change as it was", () => {
  it("carries every group with no model call when no file changed", async () => {
    const previousBrief = await makePreviousBrief();
    const generator = makeQueuedGenerator([]);
    const planned: number[] = [];

    const result = await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator,
      previous: {
        ...makeUnchangedPrevious(previousBrief),
        onPlan: async (plan) => {
          planned.push(plan.reLook.length);
        },
      },
    });

    expect(generator.requests).toHaveLength(0);
    expect(planned).toEqual([0]);
    expect(result.anchoring?.carriedGroupIds).toEqual(["g1", "g2"]);
    expect(result.brief.chunks.map((chunk) => chunk.id)).toEqual(["c1", "c2"]);
    expect(result.brief.summary).toBe(previousBrief.summary);
    expect(result.brief.index).toBe(2);
    expect(result.brief.generation).toEqual(previousBrief.generation);
    expect(result.brief.diffTotals).toEqual({ added: 5, deleted: 0 });
  });

  it("carries two groups sharing a file when no file changed", async () => {
    const sharedOutput = {
      ...baseOutput,
      chunks: [
        makeChunk("c1", "g1", "src/a.ts", 2),
        makeChunk("c3", "g1", "src/b.ts", 1),
        makeChunk("c2", "g2", "src/b.ts", 3, 2),
      ],
    };
    const generator = makeQueuedGenerator([]);

    const result = await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator,
      previous: makeUnchangedPrevious(await makePreviousBrief(sharedOutput)),
    });

    expect(generator.requests).toHaveLength(0);
    expect(result.anchoring?.carriedGroupIds).toEqual(["g1", "g2"]);
    expect(result.brief.chunks.map((chunk) => chunk.id)).toEqual([
      "c1",
      "c3",
      "c2",
    ]);
  });

  it.each([
    { title: "the same ticket", nextKey: "ACME-1", calls: 0 },
    { title: "a relinked ticket", nextKey: "ACME-2", calls: 1 },
  ])("carries only over $title", async ({ nextKey, calls }) => {
    const generated = await generateBrief({
      pr: makeTicketPr("ACME-1"),
      headIndex: 1,
      commitRange,
      generator: makeQueuedGenerator([baseOutput]),
    });

    const count = await countCarryCalls(generated.brief, makeTicketPr(nextKey));

    expect(count).toBe(calls);
  });

  it.each([
    { title: "a link it still reads", keepsLink: true, calls: 0 },
    { title: "an edit dropping its cited link", keepsLink: false, calls: 1 },
  ])("carries the intent check only over $title", async (row) => {
    const linkUrl = "https://docs.example/retry";
    const linkedPr: FetchedPr = {
      ...pr,
      links: [
        {
          id: "ctx-1",
          providerId: ContextProviderTypes.URL,
          source: linkUrl,
          text: "x",
        },
      ],
    };
    const citing = {
      ...baseOutput,
      intentCheck: {
        ...noneIntentCheck,
        ticketUrls: [linkUrl],
        ticketTitles: ["Retry"],
      },
    };
    const generated = await generateBrief({
      pr: linkedPr,
      headIndex: 1,
      commitRange,
      generator: makeQueuedGenerator([citing]),
    });
    const nextPr = row.keepsLink ? linkedPr : pr;

    const count = await countCarryCalls(generated.brief, nextPr);

    expect(generated.brief.intentCheck?.ticketUrls).toEqual([linkUrl]);
    expect(count).toBe(row.calls);
  });

  it.each([
    { title: "an edit keeping the shown item", keeps: true, calls: 0 },
    { title: "an edit removing the shown item", keeps: false, calls: 1 },
  ])("carries summary Media only over $title", async ({ keeps, calls }) => {
    const diagram = "flowchart LR\n  A --> B\n";
    const shown = {
      key: buildMermaidMediaKey(diagram),
      position: SummaryMediaPositions.AFTER_LEDE,
    };
    const mediaBody = `\`\`\`mermaid\n${diagram}\`\`\``;
    const withDiagram = { ...pr, meta: { ...pr.meta, body: mediaBody } };
    const generated = await generateBrief({
      pr: withDiagram,
      headIndex: 1,
      commitRange,
      generator: makeQueuedGenerator([baseOutput]),
    });
    const previousBrief: Brief = {
      ...generated.brief,
      summaryMedia: { shown: [shown] },
    };
    const body = keeps ? mediaBody : "d";
    const nextPr = { ...pr, meta: { ...pr.meta, body } };

    const count = await countCarryCalls(previousBrief, nextPr);

    expect(count).toBe(calls);
  });

  it("calls the model when only a redacted part of a Media address moved", async () => {
    const tokenA = `ghp_${"a".repeat(GITHUB_TOKEN_LENGTH)}`;
    const tokenB = `ghp_${"b".repeat(GITHUB_TOKEN_LENGTH)}`;
    const withToken = (token: string): FetchedPr => ({
      ...pr,
      meta: {
        ...pr.meta,
        body: `![shot](https://cdn.example/a.png?t=${token})`,
      },
    });
    const generated = await generateBrief({
      pr: withToken(tokenA),
      headIndex: 1,
      commitRange,
      generator: makeQueuedGenerator([baseOutput]),
    });
    const key = buildAddressMediaKey(`https://cdn.example/a.png?t=${tokenA}`);
    if (key === undefined) {
      throw new Error("the image address builds no Media key");
    }
    const previousBrief: Brief = {
      ...generated.brief,
      summaryMedia: {
        shown: [{ key, position: SummaryMediaPositions.AFTER_LEDE }],
      },
    };

    const count = await countCarryCalls(previousBrief, withToken(tokenB));

    expect(count).toBeGreaterThan(0);
  });

  it("stamps a brief with its inputs' fingerprint, never in the prompt", async () => {
    const generator = makeQueuedGenerator([baseOutput]);

    const { brief } = await generateBrief({
      pr,
      headIndex: 1,
      commitRange,
      generator,
    });

    const fingerprint = brief.inputFingerprint ?? "";
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const [request] = generator.requests;
    expect(request?.user).not.toContain(fingerprint);
    expect(request?.system).not.toContain(fingerprint);
    expect(Object.keys(BriefGenerationSchema.shape)).not.toContain(
      "inputFingerprint",
    );
  });

  it.each([
    {
      title: "a title edit",
      nextPr: { ...pr, meta: { ...pr.meta, title: "t2" } },
    },
    {
      title: "a link text edit",
      nextPr: {
        ...pr,
        links: [
          {
            id: "ctx-1",
            providerId: ContextProviderTypes.URL,
            source: "https://docs.example/a",
            text: "new text",
          },
        ],
      },
    },
  ])("calls the model after $title", async ({ nextPr }) => {
    const count = await countCarryCalls(await makePreviousBrief(), nextPr);

    expect(count).toBe(1);
  });

  it("calls the model when the repo context changed", async () => {
    const generator = makeQueuedGenerator([revisedOutput]);

    await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator,
      repoContext: makeRepoContext(BILLING_ATTRIBUTE),
      previous: makeUnchangedPrevious(await makePreviousBrief()),
    });

    expect(generator.requests).toHaveLength(1);
  });

  it("checks the fingerprint before onPlan, so a refused carry plans once", async () => {
    const { inputFingerprint: _dropped, ...unstamped } =
      await makePreviousBrief();
    const planned: number[] = [];

    await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator: makeQueuedGenerator([revisedOutput]),
      previous: {
        ...makeUnchangedPrevious(unstamped),
        onPlan: async (plan) => {
          planned.push(plan.reLook.length);
        },
      },
    });

    expect(planned).toEqual([0]);
  });

  it("calls the model over a previous brief with no fingerprint", async () => {
    const { inputFingerprint: _dropped, ...unstamped } =
      await makePreviousBrief();

    const count = await countCarryCalls(unstamped, pr);

    expect(count).toBe(1);
  });

  it("calls the model when a file no group owns changed", async () => {
    const withC = { ...pr, diff: `${wholeDiff}${addedFileDiff}` };
    const span = buildFastForwardSpan({
      betweenHeadsDiff: addedFileDiff,
      newPrDiff: withC.diff,
    });
    const generator = makeQueuedGenerator([revisedOutput]);

    await generateBrief({
      pr: withC,
      headIndex: 2,
      commitRange,
      generator,
      previous: { brief: await makePreviousBrief(), span },
    });

    expect(generator.requests).toHaveLength(1);
  });

  it("calls the model once when a group's range sits on a moved base", async () => {
    const aPatch = makeFilePatch({
      path: "src/a.ts",
      base: "",
      head: makeText(["a1", "a2"]),
      isAdded: true,
    });
    const base = makeBaseLines(12);
    const movedBase = insertAfter(base, "b1", ["n"]);
    const bPatch = (from: readonly string[]) =>
      makeFilePatch({
        path: "src/b.ts",
        base: makeText(from),
        head: makeText(insertAfter(from, "b8", ["p"])),
      });
    const span = buildPrSpan({
      prevPrDiff: makeDiff([aPatch, bPatch(base)]),
      newPrDiff: makeDiff([aPatch, bPatch(movedBase)]),
      betweenHeads: new Map(),
    });
    const generator = makeQueuedGenerator([revisedOutput]);

    const result = await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator,
      previous: { brief: await makePreviousBrief(), span },
    });

    expect(span.changedFiles).toEqual([]);
    expect(generator.requests).toHaveLength(1);
    expect(result.anchoring?.carriedGroupIds).toEqual(["g1"]);
    expect(result.brief.changeGroups).toHaveLength(2);
  });

  it("keeps the outline form a carried multi-call brief was grouped from", async () => {
    const previousBrief: Brief = {
      ...(await makePreviousBrief()),
      outlineForm: OutlineForms.LINES_40,
    };
    const generator = makeQueuedGenerator([]);

    const result = await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator,
      previous: makeUnchangedPrevious(previousBrief),
    });

    expect(generator.requests).toHaveLength(0);
    expect(result.brief.outlineForm).toBe(OutlineForms.LINES_40);
  });

  it("makes no call either when the call plan says multi-call", async () => {
    const generator = makeQueuedGenerator([]);

    const result = await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator,
      forceMultiCall: true,
      multiCallHooks: {},
      previous: makeUnchangedPrevious(await makePreviousBrief()),
    });

    expect(generator.requests).toHaveLength(0);
    expect(result.ranAs).toBe("single");
    expect(result.brief.changeGroups.map((group) => group.id)).toEqual([
      "g1",
      "g2",
    ]);
  });
});

describe("generateBrief, a flagged file with no changed line", () => {
  const CHANGES_PACKAGE_SOURCE = RiskSurfaceAttributes.CHANGES_PACKAGE_SOURCE;
  const NO_SUMMARIES: ReadonlyMap<string, LockfileSummary> = new Map();
  const coveringOutput = {
    ...baseOutput,
    chunks: [
      makeChunk("c1", "g1", "src/a.ts", 2),
      makeChunk("c2", "g2", "src/b.ts", 3),
    ],
  };
  const renamedConfig = [
    "diff --git a/packages/legacy/.npmrc b/.npmrc",
    "similarity index 100%",
    "rename from packages/legacy/.npmrc",
    "rename to .npmrc",
  ];
  const binaryLockfile = [
    "diff --git a/yarn.lock b/yarn.lock",
    "index 1111111..2222222 100644",
    "Binary files a/yarn.lock and b/yarn.lock differ",
  ];
  const modeOnlyLockfile = [
    "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
    "old mode 100644",
    "new mode 100755",
  ];
  const modeOnlyConfig = [
    "diff --git a/.npmrc b/.npmrc",
    "old mode 100644",
    "new mode 100755",
  ];

  async function runWithTail(
    tail: string[],
    lockfileSummaries: ReadonlyMap<string, LockfileSummary>,
    output: unknown = coveringOutput,
  ): Promise<Brief> {
    const result = await generateBrief({
      pr: { ...pr, diff: `${wholeDiff}${tail.join("\n")}\n` },
      headIndex: 1,
      commitRange,
      generator: makeQueuedGenerator([output]),
      lockfileSummaries,
    });
    return result.brief;
  }

  it.each([
    ["a renamed registry config", renamedConfig, NO_SUMMARIES, ".npmrc"],
    ["a binary lockfile", binaryLockfile, NO_SUMMARIES, "yarn.lock"],
    [
      "a mode change on a registry config",
      modeOnlyConfig,
      NO_SUMMARIES,
      ".npmrc",
    ],
  ])(
    "carries the flag on %s in the remainder",
    async (_label, tail, summaries, file) => {
      const brief = await runWithTail(tail, summaries);

      expect(brief.unattributed).toEqual([
        {
          file,
          addedRanges: [],
          removedRanges: [],
          riskSurface: [CHANGES_PACKAGE_SOURCE],
        },
      ]);
    },
  );

  it("adds no entry for a lockfile whose patch only changes its mode", async () => {
    const brief = await runWithTail(modeOnlyLockfile, NO_SUMMARIES);

    expect(brief.unattributed).toEqual([]);
  });

  it("adds no entry for a flagged lockfile a chunk already carries", async () => {
    const changedLockfile = [
      "diff --git a/yarn.lock b/yarn.lock",
      "@@ -0,0 +1 @@",
      "+a@1.0.0:",
    ];
    const output = {
      ...coveringOutput,
      chunks: [...coveringOutput.chunks, makeChunk("c3", "g2", "yarn.lock", 1)],
    };

    const brief = await runWithTail(changedLockfile, NO_SUMMARIES, output);

    expect(brief.unattributed).toEqual([]);
    expect(brief.chunks.at(-1)?.riskSurface).toEqual([CHANGES_PACKAGE_SOURCE]);
  });
});

const SHOT_BEFORE = "https://cdn.test/before.png";
const SHOT_AFTER = "https://cdn.test/after.png";
const SHOT_WIDE = "https://cdn.test/wide.png";
const MEDIA_BODY = [
  "Reworks the login page.",
  "",
  "## Screenshots",
  "",
  `![Login before](${SHOT_BEFORE}) ![Login after](${SHOT_AFTER})`,
  "",
  `![Wide layout](${SHOT_WIDE})`,
].join("\n");

const mediaPr: FetchedPr = {
  ...multiCallPr,
  meta: { ...multiCallPr.meta, body: MEDIA_BODY },
};

function listSummaryMediaWarnings(
  warnings: readonly GenerationWarning[],
): GenerationWarning[] {
  return warnings.filter(
    (warning) =>
      warning.kind === GenerationWarningKinds.VALIDATION &&
      warning.check === "summary media",
  );
}

function makeMediaOptions(
  generator: FakeGenerator,
  overrides: Partial<GenerateBriefOptions> = {},
): GenerateBriefOptions {
  return {
    pr: mediaPr,
    headIndex: 1,
    commitRange: { base: "base0007", head: "head0007", commitCount: 1 },
    generator,
    ...overrides,
  };
}

const mediaAnswer = {
  shown: [{ item: 3, position: "before-lede" }],
  pointer: { label: "Before and after", items: [1, 2] },
};

function answerMediaRun(request: RecordedRequest): unknown {
  return request.label === SUMMARY_MEDIA_LABEL ? mediaAnswer : singleBrief;
}

function stubMediaFailure(error: Error): FakeGenerator {
  return new FakeGenerator((request) => {
    if (request.label === SUMMARY_MEDIA_LABEL) {
      throw error;
    }
    return singleBrief;
  });
}

describe("generateBrief Summary Media, one call", () => {
  it("picks Media in its own call after the brief", async () => {
    const generator = new FakeGenerator(answerMediaRun);

    await generateBrief(makeMediaOptions(generator));

    const [briefRequest, mediaRequest] = generator.requests;
    expect(generator.requests).toHaveLength(2);
    expect(briefRequest?.schema).toBe(BriefGenerationSchema);
    expect(briefRequest?.user).not.toContain("<pr_media>");
    expect(briefRequest?.system).not.toContain("## Summary Media");
    expect(mediaRequest?.label).toBe(SUMMARY_MEDIA_LABEL);
    expect(mediaRequest?.user).toContain(
      [
        "<pr_media>",
        '1. image | caption: "Login before" | heading: "Screenshots"',
        '2. image | caption: "Login after" | heading: "Screenshots"',
        '3. image | caption: "Wide layout" | heading: "Screenshots"',
        "</pr_media>",
      ].join("\n"),
    );
    expect(mediaRequest?.user).toContain(
      `<brief_summary>\n${singleBrief.summary}\n</brief_summary>`,
    );
    const block = mediaRequest?.user.split("<pr_media>")[1] ?? "";
    expect(block).not.toContain("cdn.test");
  });

  it("picks Media after an anchored run's stitch", async () => {
    const generator = new FakeGenerator((request) =>
      request.label === SUMMARY_MEDIA_LABEL ? mediaAnswer : revisedOutput,
    );

    const { brief, anchoring } = await generateBrief({
      pr: { ...pr, meta: { ...pr.meta, body: MEDIA_BODY } },
      headIndex: 2,
      commitRange,
      generator,
      previous: makePrevious(await makePreviousBrief()),
    });

    const [briefRequest, mediaRequest] = generator.requests;
    expect(generator.requests).toHaveLength(2);
    expect(briefRequest?.user).toContain("<anchor_brief");
    expect(briefRequest?.system).toContain("## Media (this run)");
    expect(mediaRequest?.label).toBe(SUMMARY_MEDIA_LABEL);
    expect(mediaRequest?.user).toContain(
      `<brief_summary>\n${brief.summary}\n</brief_summary>`,
    );
    expect(anchoring?.carriedGroupIds).toEqual(["g1"]);
    expect(brief.summaryMedia?.shown).toEqual([
      { key: SHOT_WIDE, position: "before-lede" },
    ]);
  });

  it("tells the brief call to keep Media out of the summary", async () => {
    const generator = new FakeGenerator(answerMediaRun);

    await generateBrief(makeMediaOptions(generator));

    expect(generator.requests[0]?.system).toContain("## Media (this run)");
  });

  it("sends one plain brief call without Media", async () => {
    const generator = new FakeGenerator(() => singleBrief);

    await generateBrief(makeMediaOptions(generator, { pr: multiCallPr }));

    expect(generator.requests).toHaveLength(1);
    const [request] = generator.requests;
    expect(request?.schema).toBe(BriefGenerationSchema);
    expect(request?.system).not.toContain("Media");
  });

  it("stores the picked items by key", async () => {
    const generator = new FakeGenerator(answerMediaRun);

    const { brief, warnings } = await generateBrief(
      makeMediaOptions(generator),
    );

    expect(brief.summaryMedia).toEqual({
      shown: [{ key: SHOT_WIDE, position: "before-lede" }],
      pointer: { label: "Before and after", items: [SHOT_BEFORE, SHOT_AFTER] },
    });
    expect(listSummaryMediaWarnings(warnings)).toEqual([]);
  });

  it("warns with counts when it trims the answer", async () => {
    const generator = new FakeGenerator((request) =>
      request.label === SUMMARY_MEDIA_LABEL
        ? { shown: [{ item: 7, position: "middle" }] }
        : singleBrief,
    );

    const { brief, warnings } = await generateBrief(
      makeMediaOptions(generator),
    );

    expect(brief.summaryMedia).toBeUndefined();
    expect(listSummaryMediaWarnings(warnings)).toEqual([
      {
        kind: GenerationWarningKinds.VALIDATION,
        check: "summary media",
        issues: [
          "summaryMedia: dropped 1 item number(s) that name no Media item",
        ],
      },
    ]);
  });

  it("ships the brief without Summary Media when the media call fails", async () => {
    const generator = stubMediaFailure(
      new GeneratorError(GeneratorErrorKinds.SCHEMA_FLOOR, "no valid answer"),
    );

    const { brief, warnings } = await generateBrief(
      makeMediaOptions(generator),
    );

    expect(brief.summary).toBe(singleBrief.summary);
    expect(brief).not.toHaveProperty("summaryMedia");
    expect(
      warnings.filter(
        (warning) =>
          warning.kind === GenerationWarningKinds.SUMMARY_MEDIA_FAILED,
      ),
    ).toHaveLength(1);
  });

  it("rejects when the media call is aborted", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";

    await expect(
      generateBrief(makeMediaOptions(stubMediaFailure(abort))),
    ).rejects.toBe(abort);
  });

  it("keeps the picked items through an anchored run", async () => {
    const first = await generateBrief(
      makeMediaOptions(new FakeGenerator(answerMediaRun)),
    );

    const { brief } = await generateBrief(
      makeMediaOptions(new FakeGenerator(answerMediaRun), {
        headIndex: 2,
        previous: { brief: first.brief },
      }),
    );

    expect(brief.summaryMedia?.shown).toEqual([
      { key: SHOT_WIDE, position: "before-lede" },
    ]);
  });
});
