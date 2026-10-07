import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod/v4";
import type {
  Effort,
  GenerateRequest,
  Generation,
  Generator,
} from "generators";
import type { CompareFiles } from "../../src/anchoring/types";
import { generateBrief } from "../../src/generation/brief";
import type {
  GenerateBriefOptions,
  PreviousBriefInput,
} from "../../src/generation/brief/types";
import { categorize } from "../../src/generation/categorize";
import type { FetchedPr } from "../../src/github";
import type { Brief } from "../../src/types";

const OVER_CAP_SUMMARY = "s".repeat(300);

/** Answers each request with the next queued output, recording the request. */
class QueuedGenerator implements Generator {
  readonly requests: { system: string; user: string }[] = [];
  constructor(private readonly outputs: unknown[]) {}

  origin(effort: Effort): Generation {
    return { provider: "fake", model: "fake-model", effort };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    this.requests.push({ system: req.system, user: req.user });
    const output = this.outputs[this.requests.length - 1];
    return req.schema.parse(output);
  }
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

function makeChunk(id: string, groupId: string, file: string, end: number) {
  return {
    id,
    changeGroupId: groupId,
    file,
    concern: "implementation",
    role: "core",
    addedRanges: [{ start: 1, end }],
    removedRanges: [],
    riskSurface: [],
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

async function makePreviousBrief(): Promise<Brief> {
  return categorize(pr, 1, commitRange, new QueuedGenerator([baseOutput]));
}

function makePrevious(brief: Brief): PreviousBriefInput {
  return { brief, incrementalDiff, compareFiles, baseShaMoved: false };
}

describe("generateBrief, a fresh run", () => {
  it("returns the brief categorize produces", async () => {
    const generator = new QueuedGenerator([baseOutput]);

    const result = await generateBrief({
      pr,
      headIndex: 1,
      commitRange,
      generator,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.brief).toEqual(await makePreviousBrief());
    expect(result.value.anchoring).toBeUndefined();
  });

  it("returns the typed warnings behind the stored lines", async () => {
    const result = await generateBrief({
      pr,
      headIndex: 1,
      commitRange,
      generator: new QueuedGenerator([baseOutput]),
    });

    expect(result.ok && result.value.warnings).toContainEqual(
      expect.objectContaining({ kind: "validation", check: "text length" }),
    );
  });

  it("takes the generator as a required option", () => {
    expectTypeOf<
      GenerateBriefOptions["generator"]
    >().toEqualTypeOf<Generator>();
  });
});

describe("generateBrief, an anchored run", () => {
  it("carries the frozen group and returns its chunk ids", async () => {
    const generator = new QueuedGenerator([revisedOutput]);

    const result = await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator,
      previous: makePrevious(await makePreviousBrief()),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const { brief, anchoring } = result.value;
    expect(brief.changeGroups.map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(anchoring?.carriedGroupIds).toEqual(["g1"]);
    expect(anchoring?.carriedChunkIds).toEqual(["c1"]);
    expect(anchoring?.regeneratedGroupIds).toEqual(["g2"]);
    expect(generator.requests[0]?.user).toContain("<anchor_brief");
  });

  it("hands the plan to the hook before the model call", async () => {
    const generator = new QueuedGenerator([revisedOutput]);
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

    const result = await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator: new QueuedGenerator([reEmitted]),
      previous: makePrevious(await makePreviousBrief()),
    });

    expect(result.ok && result.value.warnings).toContainEqual({
      kind: "validation",
      check: "anchored stitch",
      issues: expect.arrayContaining([
        expect.stringContaining("re-emitted without a new file"),
      ]),
    });
  });

  it("returns a coverage failure instead of throwing", async () => {
    const split = {
      ...revisedOutput,
      changeGroups: [makeGroup("t1"), makeGroup("t2")],
      chunks: [...revisedOutput.chunks, makeChunk("c7", "t2", "src/b.ts", 1)],
    };

    const result = await generateBrief({
      pr,
      headIndex: 2,
      commitRange,
      generator: new QueuedGenerator([split]),
      previous: makePrevious(await makePreviousBrief()),
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain(
      "anchored coverage check failed",
    );
  });
});
