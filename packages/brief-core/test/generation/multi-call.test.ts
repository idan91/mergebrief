import { describe, expect, it, vi } from "vitest";
import type { GenerateRequest, Generation, Generator } from "generators";
import type { z } from "zod/v4";
import { generateBrief } from "../../src/generation/brief";
import type {
  MultiCallHooks,
  PartKey,
  PlannedDetailCalls,
} from "../../src/generation/multi-call/types";
import { INSTRUCTIONS_INJECTION_BUDGET_BYTES } from "../../src/generation/repo-context";
import { DETAIL_BATCH_MAX_DIFF_TOKENS } from "../../src/generation/multi-call/consts";
import { BYTES_PER_TOKEN } from "../../src/generation/size/consts";
import { SUMMARY_MEDIA_LABEL } from "../../src/generation/summary-media/consts";
import { CallPlanKinds } from "../../src/generation/size/types";
import { GenerationWarningKinds } from "../../src/generation/warnings/types";
import { buildMermaidMediaKey } from "../../src/media";
import {
  GroupingGenerationSchema,
  type Brief,
  type DetailGeneration,
} from "../../src/types";
import { FakeGenerator, type RecordedRequest } from "../helpers";
import {
  answerDetail,
  grouping,
  LOCKFILE_DIFF,
  makeAnswer,
  makeFile,
  makeGroup,
  makeOptions,
  PATHS,
  pr,
} from "./fixtures/multi-call-pr";

/** One added line's characters; enough of them make a hunk over a detail call's budget. */
const CUT_LINE_CHARS = 100;
const CUT_HUNK_LINES = Math.ceil(
  (DETAIL_BATCH_MAX_DIFF_TOKENS * BYTES_PER_TOKEN.DIFF * 3) /
    (2 * CUT_LINE_CHARS),
);
const CUT_FILE = "big.js";

/** A PR of one added file whose one hunk is over a detail call's budget. */
function makeCutHunkOptions(generator: FakeGenerator, withLockfile = false) {
  const lines = Array.from(
    { length: CUT_HUNK_LINES },
    (_, index) => `+${String(index).padEnd(CUT_LINE_CHARS - 1, "x")}`,
  );
  const files = [{ path: CUT_FILE, additions: CUT_HUNK_LINES, deletions: 0 }];
  if (withLockfile) {
    files.push({ path: "pnpm-lock.yaml", additions: 1, deletions: 1 });
  }
  const cutPr = {
    ...pr,
    meta: { ...pr.meta, files },
    diff: [
      `diff --git a/${CUT_FILE} b/${CUT_FILE}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${CUT_FILE}`,
      `@@ -0,0 +1,${CUT_HUNK_LINES} @@`,
      ...lines,
      "",
    ].join("\n"),
  };
  if (!withLockfile) {
    return makeOptions(generator, { pr: cutPr, lockfileSummaries: new Map() });
  }
  return makeOptions(generator, {
    pr: { ...cutPr, diff: cutPr.diff + LOCKFILE_DIFF },
  });
}

/** The fixture's group ids as a chain reserving g1..g3 renumbers them. */
const RENUMBERED_PAST_THREE: Record<string, string> = {
  g1: "g4",
  g2: "g5",
  g3: "g6",
};

/** A run whose chain reserves `chainGroupIds`; an empty chain runs with no previous brief. */
function makeChainOptions(
  generator: FakeGenerator,
  previousBrief: Brief,
  chain: { chainGroupIds: string[]; hooks: MultiCallHooks },
) {
  if (chain.chainGroupIds.length === 0) {
    return makeOptions(generator, { multiCallHooks: chain.hooks });
  }
  return makeOptions(generator, {
    multiCallHooks: chain.hooks,
    headIndex: 2,
    previous: {
      brief: previousBrief,
      baseShaMoved: false,
      chainGroupIds: chain.chainGroupIds,
    },
  });
}

/** Each chunk's group by title, which survives a renumbering. */
function readChunkGroupTitles(brief: Brief): (string | undefined)[] {
  const titles = new Map(
    brief.changeGroups.map((group) => [group.id, group.title]),
  );
  return brief.chunks.map((chunk) => titles.get(chunk.changeGroupId));
}

/** One group over the cut hunk, and a detail answer claiming `firstClaimed` through the hunk's last line. */
function answerCutHunk(firstClaimed: number) {
  const oneGroup = {
    ...grouping,
    changeGroups: [makeGroup("g1")],
    hunkMap: [{ groupId: "g1", hunks: ["f1"] }],
    readingOrder: undefined,
  };
  const claim = {
    id: "c1",
    changeGroupId: "g1",
    file: CUT_FILE,
    concern: "implementation",
    role: "core",
    addedRanges: [{ start: firstClaimed, end: CUT_HUNK_LINES }],
    removedRanges: [],
    riskSurface: [],
  };
  return (request: RecordedRequest) =>
    request.label === "grouping" ? oneGroup : { chunks: [claim] };
}

describe("generateBrief on the multi-call path", () => {
  it("runs the grouping call, then one detail call per batch", async () => {
    const generator = new FakeGenerator(makeAnswer());

    const { brief, warnings, ranAs } = await generateBrief(
      makeOptions(generator),
    );

    expect(generator.requests.map((request) => request.label)).toEqual([
      "grouping",
      "detail:1",
      "detail:2",
    ]);
    expect(ranAs).toBe(CallPlanKinds.MULTI);
    expect(brief.outlineForm).toBe("full");
    expect(brief.summary).toBe(grouping.summary);
    expect(brief.changeGroups.map((group) => group.id)).toEqual([
      "g1",
      "g2",
      "g3",
    ]);
    expect(brief.readingOrder?.map((step) => step.groupId)).toEqual([
      "g2",
      "g1",
      "g3",
    ]);
    expect(brief.unattributed).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("runs one call when the caller passes no multi-call hooks", async () => {
    const generator = new FakeGenerator(() => {
      throw new Error("no single-call answer in this fixture");
    });
    const options = makeOptions(generator, { multiCallHooks: undefined });

    await expect(generateBrief(options)).rejects.toThrow("no single-call");
    expect(generator.requests.map((request) => request.label)).toEqual([
      "brief",
    ]);
  });

  it("merges detail chunks in batch order with renumbered ids", async () => {
    const generator = new FakeGenerator(makeAnswer());

    const { brief } = await generateBrief(makeOptions(generator));

    const detailChunks = brief.chunks.filter(
      (chunk) => chunk.readAs === undefined,
    );
    expect(detailChunks.map((chunk) => chunk.id)).toEqual(
      detailChunks.map((_, position) => `c${position + 1}`),
    );
    expect(
      detailChunks.slice(0, 30).every((chunk) => chunk.file === "src/b.ts"),
    ).toBe(true);
    expect(
      detailChunks.slice(30, 60).every((chunk) => chunk.file === "src/a.ts"),
    ).toBe(true);
    expect(
      detailChunks.slice(60).every((chunk) => chunk.file === "src/c.ts"),
    ).toBe(true);
    expect(detailChunks).toHaveLength(90);
  });

  it("writes the shortened lockfile's chunk under its group", async () => {
    const generator = new FakeGenerator(makeAnswer());

    const { brief } = await generateBrief(makeOptions(generator));

    const lockfile = brief.chunks.find(
      (chunk) => chunk.file === "pnpm-lock.yaml",
    );
    expect(lockfile).toMatchObject({
      id: "c91",
      changeGroupId: "g2",
      concern: "generated",
      readAs: "package-summary",
    });
    expect(generator.requests[1]?.user).not.toContain("pnpm-lock.yaml");
  });

  it("reads a lockfile with no summary by its counts, flagged", async () => {
    const generator = new FakeGenerator(makeAnswer());
    const options = makeOptions(generator, { lockfileSummaries: new Map() });

    const { brief } = await generateBrief(options);

    const [groupingRequest, ...detailRequests] = generator.requests;
    expect(groupingRequest?.user).toContain(
      "pnpm-lock.yaml (modified, +1 -1, lockfile)\n    package changes not read: unavailable",
    );
    expect(groupingRequest?.user).toContain("(90 in all)");
    for (const request of detailRequests) {
      expect(request.user).not.toContain("pnpm-lock.yaml");
    }
    const lockfileChunks = brief.chunks.filter(
      (chunk) => chunk.file === "pnpm-lock.yaml",
    );
    expect(lockfileChunks).toHaveLength(1);
    expect(lockfileChunks[0]).toMatchObject({
      changeGroupId: "g2",
      concern: "generated",
      readAs: "counts-only",
      riskSurface: ["changes-package-source"],
    });
  });

  it("reads another ecosystem's lockfile with no summary as one line", async () => {
    const cargoDiff = LOCKFILE_DIFF.replaceAll("pnpm-lock.yaml", "Cargo.lock");
    const cargoPr = { ...pr, diff: pr.diff.replace(LOCKFILE_DIFF, cargoDiff) };
    const generator = new FakeGenerator(makeAnswer());
    const options = makeOptions(generator, {
      pr: cargoPr,
      lockfileSummaries: new Map(),
    });

    const { brief } = await generateBrief(options);

    const groupingUser = generator.requests[0]?.user ?? "";
    expect(groupingUser).toContain("Cargo.lock (modified, +1 -1, lockfile)\n");
    expect(groupingUser).not.toContain("react@18.3.1");
    const lockfileChunks = brief.chunks.filter(
      (chunk) => chunk.file === "Cargo.lock",
    );
    expect(lockfileChunks).toHaveLength(1);
    expect(lockfileChunks[0]).toMatchObject({
      concern: "generated",
      readAs: "counts-only",
      riskSurface: [],
    });
  });

  it("sends the detail calls a cached shared prefix and the chunks schema", async () => {
    const generator = new FakeGenerator(makeAnswer());

    await generateBrief(makeOptions(generator));

    const [, first, second] = generator.requests;
    expect(first?.userPrefix).toBeDefined();
    expect(first?.userPrefix).toBe(second?.userPrefix);
    expect(first?.userPrefix).toContain("<pr_grouping>");
    expect(first?.user).toContain("## Batch 1 of 2");
    expect(second?.user).toContain("## Batch 2 of 2");
    expect(first?.salvageFields).toContain("riskSurface");
  });

  it("drops a detail chunk naming a group outside its batch", async () => {
    const generator = new FakeGenerator((request) =>
      request.label === "detail:2"
        ? answerDetail(request, "g1")
        : makeAnswer()(request),
    );

    const { brief, warnings } = await generateBrief(makeOptions(generator));

    expect(brief.chunks.some((chunk) => chunk.file === "src/c.ts")).toBe(false);
    expect(brief.unattributed?.map((file) => file.file)).toEqual(["src/c.ts"]);
    expect(warnings).toContainEqual({
      kind: GenerationWarningKinds.VALIDATION,
      check: "detail batch detail:2",
      issues: expect.arrayContaining([expect.stringContaining("g1")]),
    });
  });

  it("leaves a cut hunk's unshown lines to the remainder", async () => {
    const generator = new FakeGenerator(answerCutHunk(1));

    const { brief } = await generateBrief(makeCutHunkOptions(generator));

    const shownEnd = brief.chunks[0]?.addedRanges.at(-1)?.end ?? 0;
    expect(shownEnd).toBeGreaterThan(1);
    expect(shownEnd).toBeLessThan(CUT_HUNK_LINES);
    expect(brief.unattributed).toMatchObject([
      {
        file: CUT_FILE,
        addedRanges: [{ start: shownEnd + 1, end: CUT_HUNK_LINES }],
      },
    ]);
  });

  it("numbers the chunks after a dropped one without reusing an id", async () => {
    const withLockfile = {
      ...grouping,
      changeGroups: [makeGroup("g1")],
      hunkMap: [{ groupId: "g1", hunks: ["f1", "f2"] }],
      readingOrder: undefined,
    };
    const claim = (id: string, start: number, end: number) => ({
      id,
      changeGroupId: "g1",
      file: CUT_FILE,
      concern: "implementation",
      role: "core",
      addedRanges: [{ start, end }],
      removedRanges: [],
      riskSurface: [],
    });
    const generator = new FakeGenerator((request) =>
      request.label === "grouping"
        ? withLockfile
        : {
            chunks: [
              claim("c1", 1, 1),
              claim("c2", CUT_HUNK_LINES, CUT_HUNK_LINES),
              claim("c3", 2, 2),
            ],
          },
    );

    const { brief } = await generateBrief(makeCutHunkOptions(generator, true));

    const ids = brief.chunks.map((chunk) => chunk.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops a chunk claiming only a cut hunk's unshown lines", async () => {
    const generator = new FakeGenerator(answerCutHunk(CUT_HUNK_LINES));

    const { brief, warnings } = await generateBrief(
      makeCutHunkOptions(generator),
    );

    expect(brief.chunks).toEqual([]);
    expect(brief.unattributed).toMatchObject([
      { file: CUT_FILE, addedRanges: [{ start: 1, end: CUT_HUNK_LINES }] },
    ]);
    expect(warnings).toContainEqual(
      expect.objectContaining({ check: "cut hunk" }),
    );
  });

  it("leaves an unlisted hunk to the remainder with a warning", async () => {
    const partial = {
      ...grouping,
      hunkMap: grouping.hunkMap.filter((entry) => entry.groupId !== "g3"),
    };
    const generator = new FakeGenerator((request) =>
      request.label === "grouping" ? partial : answerDetail(request),
    );

    const { brief, warnings } = await generateBrief(makeOptions(generator));

    expect(generator.requests.map((request) => request.label)).toEqual([
      "grouping",
      "detail:1",
    ]);
    expect(brief.unattributed?.map((file) => file.file)).toEqual(["src/c.ts"]);
    expect(warnings.map((warning) => warning.kind)).toContain(
      GenerationWarningKinds.HUNK_MAP_UNLISTED,
    );
  });

  it("drops a group the hunk map left empty with every reference to it", async () => {
    const accomplished = {
      bucket: "accomplished",
      intent: "Refactor the modules",
      quote: "",
      sourceUrl: "",
      groupIds: ["g1", "g3"],
      acknowledged: false,
    };
    const partial = {
      ...grouping,
      hunkMap: grouping.hunkMap.filter((entry) => entry.groupId !== "g3"),
      intentCheck: {
        ...grouping.intentCheck,
        specificity: "precise",
        items: [accomplished],
      },
    };
    const generator = new FakeGenerator((request) =>
      request.label === "grouping" ? partial : answerDetail(request),
    );

    const { brief, warnings } = await generateBrief(makeOptions(generator));

    expect(brief.changeGroups.map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(brief.readingOrder?.map((step) => step.groupId)).toEqual([
      "g2",
      "g1",
    ]);
    expect(
      brief.intentCheck?.accomplished.map((item) => item.groupIds),
    ).toEqual([["g1"]]);
    expect(warnings).toContainEqual({
      kind: GenerationWarningKinds.VALIDATION,
      check: "empty group",
      issues: [expect.stringContaining("g3")],
    });
  });

  it("counts only the hunks the outline marks, not a shortened file's", async () => {
    const generator = new FakeGenerator(makeAnswer());

    await generateBrief(makeOptions(generator));

    expect(generator.requests[0]?.user).toContain("(90 in all)");
    expect(generator.requests[0]?.user).toContain("4 files, 90 hunks");
  });

  it("logs how many files the .gitattributes match budget left unread", async () => {
    const longPaths = Array.from(
      { length: 8 },
      (_, index) => `${index}${"a/".repeat(499)}a`,
    );
    const longPathFiles = longPaths.map((path) => ({
      path,
      additions: 1,
      deletions: 1,
    }));
    const longPathPr = {
      ...pr,
      meta: { ...pr.meta, files: [...pr.meta.files, ...longPathFiles] },
      diff: pr.diff + longPaths.map((path) => makeFile(path, 1)).join(""),
    };
    const starRules = Array.from(
      { length: 16 },
      () => `/${"*a".repeat(127)} linguist-generated`,
    ).join("\n");
    const lines: string[] = [];

    await generateBrief(
      makeOptions(new FakeGenerator(makeAnswer()), {
        pr: longPathPr,
        gitAttributes: starRules,
        log: (line) => lines.push(line),
      }),
    );

    expect(lines).toContainEqual(
      expect.stringMatching(
        /^\.gitattributes match budget ran out: [1-9]\d* files read in full$/,
      ),
    );
  });

  it("accepts the repo context once per run", async () => {
    const generator = new FakeGenerator(makeAnswer());
    const oversized = {
      customAttributes: [],
      instructions: {
        path: ".mergebrief/instructions.md",
        blobSha: "abc123",
        content: "x".repeat(INSTRUCTIONS_INJECTION_BUDGET_BYTES + 1),
      },
    };

    const { warnings } = await generateBrief(
      makeOptions(generator, { repoContext: oversized }),
    );

    expect(
      warnings.filter(
        (warning) =>
          warning.kind === GenerationWarningKinds.REPO_INSTRUCTIONS_OMITTED,
      ),
    ).toHaveLength(1);
  });

  it("rejects a detailConcurrency under 1 or fractional before any call", async () => {
    for (const detailConcurrency of [0, -1, 1.5, Number.NaN]) {
      const generator = new FakeGenerator(makeAnswer());

      await expect(
        generateBrief(makeOptions(generator, { detailConcurrency })),
      ).rejects.toThrow("detailConcurrency");
      expect(generator.requests).toEqual([]);
    }
  });

  it("reuses stored parts and reports only fresh ones", async () => {
    const stored = new Map<PartKey, unknown>();
    const seeding = new FakeGenerator(makeAnswer());
    await generateBrief(
      makeOptions(seeding, {
        multiCallHooks: {
          onPartDone: async (key, body) => {
            stored.set(key, body);
          },
        },
      }),
    );
    expect([...stored.keys()]).toEqual(["grouping", "detail:1", "detail:2"]);

    stored.set("detail:2", { chunks: "not a list" });
    const done: PartKey[] = [];
    const plans: PlannedDetailCalls[] = [];
    const generator = new FakeGenerator(makeAnswer());
    const { brief } = await generateBrief(
      makeOptions(generator, {
        multiCallHooks: {
          loadPart: async (key) => stored.get(key),
          onGroupingDone: async (plan) => {
            plans.push(plan);
          },
          onPartDone: async (key) => {
            done.push(key);
          },
        },
      }),
    );

    expect(generator.requests.map((request) => request.label)).toEqual([
      "detail:2",
    ]);
    expect(plans).toEqual([{ detailCalls: 2, missingDetailCalls: [2] }]);
    expect(done).toEqual(["detail:2"]);
    expect(brief.chunks).toHaveLength(91);
  });

  it("re-sends every detail part when the stored grouping no longer parses", async () => {
    const stored = new Map<PartKey, unknown>();
    const firstRun = new FakeGenerator(makeAnswer());
    await generateBrief(
      makeOptions(firstRun, {
        multiCallHooks: {
          onPartDone: async (key, body) => {
            stored.set(key, body);
          },
        },
      }),
    );
    stored.set("grouping", { changeGroups: "not a list" });

    const done: PartKey[] = [];
    const generator = new FakeGenerator(makeAnswer());
    const { brief } = await generateBrief(
      makeOptions(generator, {
        multiCallHooks: {
          loadPart: async (key) => stored.get(key),
          onPartDone: async (key) => {
            done.push(key);
          },
        },
      }),
    );

    expect(generator.requests.map((request) => request.label)).toEqual([
      "grouping",
      "detail:1",
      "detail:2",
    ]);
    expect(done).toEqual(["grouping", "detail:1", "detail:2"]);
    expect(brief.chunks).toHaveLength(91);
  });

  it("calls the hooks in order and lets onGroupingDone end the run", async () => {
    const events: string[] = [];
    const hooks: MultiCallHooks = {
      onGroupingDone: async (parts) => {
        events.push(`grouping done: ${parts.detailCalls}`);
      },
      onDetailStart: async () => {
        events.push("detail start");
      },
      onPartDone: async (key) => {
        events.push(`part ${key}`);
      },
    };
    const generator = new FakeGenerator(makeAnswer());

    await generateBrief(makeOptions(generator, { multiCallHooks: hooks }));

    expect(events).toEqual([
      "part grouping",
      "grouping done: 2",
      "detail start",
      "part detail:1",
      "part detail:2",
    ]);

    const capped = new FakeGenerator(makeAnswer());
    await expect(
      generateBrief(
        makeOptions(capped, {
          multiCallHooks: {
            onGroupingDone: async () => {
              throw new Error("capped");
            },
          },
        }),
      ),
    ).rejects.toThrow("capped");
    expect(capped.requests.map((request) => request.label)).toEqual([
      "grouping",
    ]);
  });

  it("skips the anchor plan and the stitch on a multi-call run", async () => {
    const generator = new FakeGenerator(makeAnswer());
    const first = await generateBrief(makeOptions(generator));
    let planned = false;
    const revision = new FakeGenerator(makeAnswer());

    const second = await generateBrief(
      makeOptions(revision, {
        headIndex: 2,
        previous: {
          brief: first.brief,
          baseShaMoved: false,
          onPlan: async () => {
            planned = true;
          },
        },
      }),
    );

    expect(planned).toBe(false);
    expect(second.anchoring).toBeUndefined();
    expect(second.ranAs).toBe(CallPlanKinds.MULTI);
    expect(second.brief.outlineForm).toBe("full");
  });

  it("mints the group ids past the chain's when a previous brief exists", async () => {
    const firstRun = new FakeGenerator(makeAnswer());
    const first = await generateBrief(makeOptions(firstRun));
    const revision = new FakeGenerator(makeAnswer());

    const { brief } = await generateBrief(
      makeOptions(revision, {
        headIndex: 2,
        previous: {
          brief: first.brief,
          baseShaMoved: false,
          chainGroupIds: ["g1", "g2", "g3", "g4"],
        },
      }),
    );

    expect(brief.changeGroups.map((group) => group.id)).toEqual([
      "g5",
      "g6",
      "g7",
    ]);
    expect(brief.readingOrder?.map((step) => step.groupId)).toEqual([
      "g6",
      "g5",
      "g7",
    ]);
    expect(new Set(brief.chunks.map((chunk) => chunk.changeGroupId))).toEqual(
      new Set(["g5", "g6", "g7"]),
    );
    expect(brief.unattributed).toEqual([]);
  });

  it.each([
    { chains: [["g1", "g2", "g3", "g4"], []] },
    { chains: [[], ["g1", "g2", "g3", "g4"]] },
    { chains: [["g1"], []] },
    { chains: [[], ["g1"], []] },
    { chains: [["g1", "g2", "g3", "g4"], [], ["g1"]] },
  ])(
    "keeps stored chunks on their groups when the chain changes on resume",
    async ({ chains }) => {
      const [firstChain = [], ...resumedChains] = chains;
      const lastChain = resumedChains.pop() ?? [];
      const seed = await generateBrief(
        makeOptions(new FakeGenerator(makeAnswer())),
      );
      const stored = new Map<PartKey, unknown>();
      async function loadPart(key: PartKey): Promise<unknown> {
        return stored.get(key);
      }
      async function onPartDone(key: PartKey, body: unknown): Promise<void> {
        stored.set(key, body);
      }
      const storing = await generateBrief(
        makeChainOptions(new FakeGenerator(makeAnswer()), seed.brief, {
          chainGroupIds: firstChain,
          hooks: { onPartDone },
        }),
      );
      for (const chainGroupIds of resumedChains) {
        stored.delete("detail:2");
        // oxlint-disable-next-line no-await-in-loop -- each resume stores what the next one reads
        await generateBrief(
          makeChainOptions(new FakeGenerator(makeAnswer()), seed.brief, {
            chainGroupIds,
            hooks: { loadPart, onPartDone },
          }),
        );
      }

      const generator = new FakeGenerator(makeAnswer());
      const { brief } = await generateBrief(
        makeChainOptions(generator, seed.brief, {
          chainGroupIds: lastChain,
          hooks: { loadPart },
        }),
      );

      expect(generator.requests).toEqual([]);
      expect(brief.unattributed).toEqual([]);
      expect(readChunkGroupTitles(brief)).toEqual(
        readChunkGroupTitles(storing.brief),
      );
    },
  );

  it("never resumes a chunk onto a group its storing run never showed", async () => {
    const seed = await generateBrief(
      makeOptions(new FakeGenerator(makeAnswer())),
    );
    const stored = new Map<PartKey, unknown>();
    await generateBrief(
      makeOptions(new FakeGenerator(makeAnswer()), {
        multiCallHooks: {
          onPartDone: async (key, body) => {
            stored.set(key, body);
          },
        },
      }),
    );
    const detail = stored.get("detail:1") as DetailGeneration;
    const [first, ...rest] = detail.chunks;
    if (first === undefined) {
      throw new Error("detail:1 holds no chunk");
    }
    const resumedId = RENUMBERED_PAST_THREE[first.changeGroupId];
    stored.set("detail:1", {
      chunks: [{ ...first, changeGroupId: resumedId }, ...rest],
    });
    const loadPart = async (key: PartKey) => stored.get(key);

    const sameChain = await generateBrief(
      makeOptions(new FakeGenerator(makeAnswer()), {
        multiCallHooks: { loadPart },
      }),
    );
    const otherChain = await generateBrief(
      makeChainOptions(new FakeGenerator(makeAnswer()), seed.brief, {
        chainGroupIds: ["g1", "g2", "g3"],
        hooks: { loadPart },
      }),
    );

    expect(sameChain.brief.unattributed).not.toEqual([]);
    expect(readChunkGroupTitles(otherChain.brief)).toEqual(
      readChunkGroupTitles(sameChain.brief),
    );
  });

  it("stamps the detail effort as the Brief's generation effort", async () => {
    const generator = new FakeGenerator(makeAnswer());

    const { brief } = await generateBrief(
      makeOptions(generator, { effort: "low", detailEffort: "high" }),
    );

    expect(brief.generation.effort).toBe("high");
    expect(generator.requests[0]?.effort).toBe("low");
    expect(generator.requests[1]?.effort).toBe("high");
  });

  it("runs call 1 alone, then at most detailConcurrency calls at once", async () => {
    const releases: (() => void)[] = [];
    let inFlight = 0;
    const peaks: number[] = [];
    const gated: Generator = {
      origin: (effort): Generation => ({
        provider: "fake",
        model: "fake-model",
        effort,
      }),
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        const request: RecordedRequest = {
          label: req.label,
          system: req.system,
          user: req.user,
          effort: req.effort,
          schema: req.schema,
          salvageFields: [],
        };
        if (req.label === "grouping") {
          return req.schema.parse(wideGrouping);
        }
        inFlight += 1;
        peaks.push(inFlight);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        inFlight -= 1;
        return req.schema.parse(answerDetail(request));
      },
    };
    const wideGrouping = {
      ...grouping,
      changeGroups: PATHS.map((_, index) => makeGroup(`g${index + 1}`)),
      hunkMap: PATHS.map((_, index) => ({
        groupId: `g${index + 1}`,
        hunks: [`f${index + 1}`, ...(index === 0 ? ["f4"] : [])],
      })),
      readingOrder: undefined,
    };
    const run = generateBrief(
      makeOptions(gated, {
        detailConcurrency: 2,
        pr: {
          ...pr,
          diff:
            PATHS.map((path) => makeFile(path, 50)).join("") + LOCKFILE_DIFF,
        },
      }),
    );

    // Three groups of 50 hunks make three batches: call 1 runs alone.
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    expect(peaks).toEqual([1]);
    releases[0]?.();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    expect(Math.max(...peaks)).toBe(2);
    for (const release of releases.slice(1)) {
      release();
    }
    const { brief } = await run;
    expect(
      brief.chunks.filter((chunk) => chunk.readAs === undefined),
    ).toHaveLength(150);
  });

  it("lets the calls in flight finish and store when one fails", async () => {
    const paths = [...PATHS, "src/d.ts"];
    const events: string[] = [];
    const failure = new Error("detail:3 failed");
    let releaseHeld: (() => void) | undefined;
    const fourGrouping = {
      ...grouping,
      changeGroups: paths.map((_, index) => makeGroup(`g${index + 1}`)),
      hunkMap: paths.map((_, index) => ({
        groupId: `g${index + 1}`,
        hunks: [`f${index + 1}`, ...(index === 0 ? ["f5"] : [])],
      })),
      readingOrder: undefined,
    };
    const generator: Generator = {
      origin: (effort): Generation => ({
        provider: "fake",
        model: "fake-model",
        effort,
      }),
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        if (req.label === "grouping") {
          return req.schema.parse(fourGrouping);
        }
        events.push(`start ${req.label}`);
        if (req.label === "detail:2") {
          await new Promise<void>((resolve) => {
            releaseHeld = resolve;
          });
        }
        if (req.label === "detail:3") {
          throw failure;
        }
        const request: RecordedRequest = {
          label: req.label,
          system: req.system,
          user: req.user,
          effort: req.effort,
          schema: req.schema,
          salvageFields: [],
        };
        return req.schema.parse(answerDetail(request));
      },
    };
    const hooks: MultiCallHooks = {
      onPartDone: async (key) => {
        events.push(`part ${key}`);
      },
    };
    const run = generateBrief(
      makeOptions(generator, {
        detailConcurrency: 2,
        multiCallHooks: hooks,
        pr: {
          ...pr,
          diff:
            paths.map((path) => makeFile(path, 50)).join("") + LOCKFILE_DIFF,
        },
      }),
    );
    const settled = run.then(
      () => events.push("resolved"),
      (error: unknown) => events.push(error === failure ? "rejected" : "other"),
    );

    await vi.waitFor(() => expect(events).toContain("start detail:3"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).not.toContain("rejected");
    releaseHeld?.();
    await settled;

    expect(events).toEqual([
      "part grouping",
      "start detail:1",
      "part detail:1",
      "start detail:2",
      "start detail:3",
      "part detail:2",
      "rejected",
    ]);
  });
});

describe("a multi-call run over a few large hunks", () => {
  const LARGE_HUNK_LINES = 1_500;

  /** One file of one added hunk, about 75k tokens at the diff rate. */
  function makeLargeFile(path: string): string {
    const lines = Array.from(
      { length: LARGE_HUNK_LINES },
      (_, index) => `+${String(index).padEnd(99, "x")}`,
    );
    return [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,1 +1,${LARGE_HUNK_LINES} @@`,
      "-old",
      ...lines,
      "",
    ].join("\n");
  }

  it("splits the detail calls by tokens when the hunks are few", async () => {
    const oneGroup = {
      ...grouping,
      changeGroups: [makeGroup("g1")],
      hunkMap: [{ groupId: "g1", hunks: ["f1", "f2", "f3"] }],
      readingOrder: [{ groupId: "g1", why: "the change" }],
    };
    const generator = new FakeGenerator((request) =>
      request.label === "grouping" ? oneGroup : answerDetail(request),
    );

    await generateBrief(
      makeOptions(generator, {
        pr: { ...pr, diff: PATHS.map(makeLargeFile).join("") },
      }),
    );

    const details = generator.requests.filter(
      (request) => request.label !== "grouping",
    );
    const budgetBytes = DETAIL_BATCH_MAX_DIFF_TOKENS * BYTES_PER_TOKEN.DIFF;
    expect(details.map((request) => request.label)).toEqual([
      "detail:1",
      "detail:2",
    ]);
    expect(details.every((request) => request.user.length <= budgetBytes)).toBe(
      true,
    );
  });
});

describe("a failed detail call", () => {
  it("ends the run without starting the batches still queued", async () => {
    const wide = {
      ...grouping,
      changeGroups: [1, 2, 3, 4].map((n) => makeGroup(`g${n}`)),
      hunkMap: [1, 2, 3, 4].map((n) => ({
        groupId: `g${n}`,
        hunks: [`f${n}`],
      })),
      readingOrder: undefined,
    };
    const generator = new FakeGenerator((request) => {
      if (request.label === "grouping") {
        return wide;
      }
      if (request.label === "detail:2") {
        throw new Error("provider down");
      }
      return answerDetail(request);
    });
    const fourFiles = [...PATHS, "src/d.ts"].map((path) => makeFile(path, 50));

    await expect(
      generateBrief(
        makeOptions(generator, {
          detailConcurrency: 2,
          pr: { ...pr, diff: fourFiles.join("") },
        }),
      ),
    ).rejects.toThrow("provider down");

    const labels = generator.requests.map((request) => request.label);
    expect(labels.slice(0, 3)).toEqual(["grouping", "detail:1", "detail:2"]);
    expect(labels).not.toContain("detail:4");
  });
});

const SHOT = "https://cdn.test/shot.png";
const DIAGRAM_CODE = "flowchart LR\n  A --> B\n";
const MEDIA_BODY = [
  "Touches three files.",
  "",
  `![New layout](${SHOT})`,
  "",
  "```mermaid",
  DIAGRAM_CODE.trimEnd(),
  "```",
].join("\n");
const mediaPr = { ...pr, meta: { ...pr.meta, body: MEDIA_BODY } };
const mediaAnswer = {
  shown: [{ item: 2, position: "after-lede" }],
  pointer: { label: "The layout", items: [1] },
};

function answerMediaRun(request: RecordedRequest): unknown {
  if (request.label === SUMMARY_MEDIA_LABEL) {
    return mediaAnswer;
  }
  return request.label === "grouping" ? grouping : answerDetail(request);
}

describe("generateBrief Summary Media, multi-call run", () => {
  it("picks Media in its own call after the detail calls", async () => {
    const generator = new FakeGenerator(answerMediaRun);

    await generateBrief(makeOptions(generator, { pr: mediaPr }));

    const [groupingRequest, ...rest] = generator.requests;
    const mediaRequest = rest.at(-1);
    expect(groupingRequest?.schema).toBe(GroupingGenerationSchema);
    expect(groupingRequest?.system).toContain("## Media (this run)");
    for (const request of generator.requests.slice(0, -1)) {
      expect(`${request.userPrefix}${request.user}`).not.toContain(
        "<pr_media>",
      );
    }
    expect(mediaRequest?.label).toBe(SUMMARY_MEDIA_LABEL);
    expect(mediaRequest?.user).toContain(
      [
        "<pr_media>",
        '1. image | caption: "New layout"',
        "2. diagram | type: flowchart",
        "</pr_media>",
      ].join("\n"),
    );
  });

  it("sends no media call or note without Media", async () => {
    const generator = new FakeGenerator(makeAnswer());

    await generateBrief(makeOptions(generator));

    const labels = generator.requests.map((request) => request.label);
    expect(labels).not.toContain(SUMMARY_MEDIA_LABEL);
    expect(generator.requests[0]?.schema).toBe(GroupingGenerationSchema);
    expect(generator.requests[0]?.system).not.toContain("Media (this run)");
  });

  it("stores the media call's picks by key", async () => {
    const generator = new FakeGenerator(answerMediaRun);

    const { brief } = await generateBrief(
      makeOptions(generator, { pr: mediaPr }),
    );

    expect(brief.summaryMedia).toEqual({
      shown: [
        { key: buildMermaidMediaKey(DIAGRAM_CODE), position: "after-lede" },
      ],
      pointer: { label: "The layout", items: [SHOT] },
    });
  });

  it("stores the grouping part without Summary Media", async () => {
    const stored = new Map<PartKey, unknown>();
    const generator = new FakeGenerator(answerMediaRun);

    await generateBrief(
      makeOptions(generator, {
        pr: mediaPr,
        multiCallHooks: {
          onPartDone: async (key, body) => {
            stored.set(key, body);
          },
        },
      }),
    );

    expect(stored.get("grouping")).not.toHaveProperty("summaryMedia");
  });
});
