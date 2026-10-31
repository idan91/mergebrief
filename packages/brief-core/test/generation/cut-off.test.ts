import { describe, expect, it } from "vitest";
import { GeneratorError, GeneratorErrorKinds } from "generators";
import { generateBrief } from "../../src/generation/brief";
import type { PlannedDetailCalls } from "../../src/generation/multi-call/types";
import { INSTRUCTIONS_INJECTION_BUDGET_BYTES } from "../../src/generation/repo-context";
import { CallPlanKinds } from "../../src/generation/size/types";
import { GenerationWarningKinds } from "../../src/generation/warnings/types";
import { FakeGenerator, type RecordedRequest } from "../helpers";
import {
  answerDetail,
  grouping,
  makeAnswer,
  makeFile,
  makeGroup,
  makeOptions,
  pr,
  singleBrief,
} from "./fixtures/multi-call-pr";

function cut(): never {
  throw new GeneratorError(GeneratorErrorKinds.OUTPUT_CUT, "output cut");
}

function answerUnlessCut(cutLabels: readonly string[]) {
  return (request: RecordedRequest) => {
    if (cutLabels.includes(request.label)) {
      return cut();
    }
    if (request.label === "grouping") {
      return grouping;
    }
    if (request.label === "brief") {
      return singleBrief;
    }
    return answerDetail(request);
  };
}

/** The parts a run whose first batch was cut stores: the grouping, both halves and batch 2. */
async function storeSplitRun(): Promise<Map<string, unknown>> {
  const stored = new Map<string, unknown>();
  await generateBrief(
    makeOptions(new FakeGenerator(answerUnlessCut(["detail:1"])), {
      multiCallHooks: {
        onPartDone: async (key, body) => {
          stored.set(key, body);
        },
      },
    }),
  );
  return stored;
}

describe("a cut detail call", () => {
  it("splits once into two halves and merges their chunks", async () => {
    const generator = new FakeGenerator(answerUnlessCut(["detail:1"]));

    const { brief, warnings } = await generateBrief(makeOptions(generator));

    expect(generator.requests.map((request) => request.label)).toEqual([
      "grouping",
      "detail:1",
      "detail:1:1",
      "detail:1:2",
      "detail:2",
    ]);
    expect(generator.requests[2]?.user).toContain("## Batch 1 of 2, half 1");
    expect(generator.requests[3]?.user).toContain("## Batch 1 of 2, half 2");
    expect(
      brief.chunks.filter((chunk) => chunk.readAs === undefined),
    ).toHaveLength(90);
    expect(brief.unattributed).toEqual([]);
    expect(warnings.map((warning) => warning.kind)).toContain(
      GenerationWarningKinds.DETAIL_CALL_CUT,
    );
  });

  it("stores each half under its own part key", async () => {
    const done: string[] = [];
    const generator = new FakeGenerator(answerUnlessCut(["detail:1"]));

    await generateBrief(
      makeOptions(generator, {
        multiCallHooks: {
          onPartDone: async (key) => {
            done.push(key);
          },
        },
      }),
    );

    expect(done).toEqual(["grouping", "detail:1:1", "detail:1:2", "detail:2"]);
  });

  it("resumes a split batch from its stored halves without re-sending it", async () => {
    const stored = new Map<string, unknown>();
    const cutOnce = new FakeGenerator(answerUnlessCut(["detail:1"]));
    await generateBrief(
      makeOptions(cutOnce, {
        multiCallHooks: {
          onPartDone: async (key, body) => {
            stored.set(key, body);
          },
        },
      }),
    );
    expect([...stored.keys()]).toEqual([
      "grouping",
      "detail:1:1",
      "detail:1:2",
      "detail:2",
    ]);

    const plans: PlannedDetailCalls[] = [];
    const generator = new FakeGenerator(answerUnlessCut([]));
    const { brief } = await generateBrief(
      makeOptions(generator, {
        multiCallHooks: {
          loadPart: async (key) => stored.get(key),
          onGroupingDone: async (plan) => {
            plans.push(plan);
          },
        },
      }),
    );

    expect(generator.requests).toEqual([]);
    expect(plans).toEqual([{ detailCalls: 2, missingDetailCalls: [] }]);
    expect(brief.chunks).toHaveLength(91);

    stored.delete("detail:1:2");
    const oneHalf: PlannedDetailCalls[] = [];
    await generateBrief(
      makeOptions(new FakeGenerator(answerUnlessCut([])), {
        multiCallHooks: {
          loadPart: async (key) => stored.get(key),
          onGroupingDone: async (plan) => {
            oneHalf.push(plan);
          },
        },
      }),
    );
    expect(oneHalf).toEqual([{ detailCalls: 2, missingDetailCalls: [1] }]);
  });

  it("re-sends a split batch whole when the stored grouping does not parse", async () => {
    const stored = await storeSplitRun();
    stored.set("grouping", { unparseable: true });
    const generator = new FakeGenerator(answerUnlessCut([]));

    await generateBrief(
      makeOptions(generator, {
        multiCallHooks: { loadPart: async (key) => stored.get(key) },
      }),
    );

    expect(generator.requests.map((request) => request.label)).toEqual([
      "grouping",
      "detail:1",
      "detail:2",
    ]);
  });

  it("resumes a split batch from its first half and sends the second", async () => {
    const stored = await storeSplitRun();
    stored.delete("detail:1:2");
    const generator = new FakeGenerator(answerUnlessCut([]));

    const { brief, warnings } = await generateBrief(
      makeOptions(generator, {
        multiCallHooks: { loadPart: async (key) => stored.get(key) },
      }),
    );

    expect(generator.requests.map((request) => request.label)).toEqual([
      "detail:1:2",
    ]);
    expect(brief.chunks).toHaveLength(91);
    expect(warnings.map((warning) => warning.kind)).toContain(
      GenerationWarningKinds.DETAIL_CALL_CUT,
    );
  });

  it("fails the run when a cut batch holds one hunk", async () => {
    const oneHunk = {
      ...grouping,
      changeGroups: [makeGroup("g1")],
      hunkMap: [{ groupId: "g1", hunks: ["f1"] }],
      readingOrder: undefined,
    };
    const generator = new FakeGenerator((request) =>
      request.label === "grouping" ? oneHunk : cut(),
    );

    await expect(
      generateBrief(
        makeOptions(generator, {
          pr: { ...pr, diff: makeFile("src/a.ts", 1) },
          lockfileSummaries: new Map(),
        }),
      ),
    ).rejects.toMatchObject({ kind: GeneratorErrorKinds.OUTPUT_CUT });
    expect(generator.requests.map((request) => request.label)).toEqual([
      "grouping",
      "detail:1",
    ]);
  });

  it("fails the run when a half is cut again", async () => {
    const generator = new FakeGenerator(
      answerUnlessCut(["detail:1", "detail:1:2"]),
    );

    await expect(generateBrief(makeOptions(generator))).rejects.toMatchObject({
      kind: GeneratorErrorKinds.OUTPUT_CUT,
    });
  });
});

/** A large middle group between two small ones: 10 + 60 + 10 hunks, one detail batch. */
const UNEVEN_PR = {
  ...pr,
  diff: [
    makeFile("src/a.ts", 10),
    makeFile("src/b.ts", 60),
    makeFile("src/c.ts", 10),
  ].join(""),
};
const UNEVEN_GROUPING = {
  ...grouping,
  hunkMap: [
    { groupId: "g1", hunks: ["f1"] },
    { groupId: "g2", hunks: ["f2"] },
    { groupId: "g3", hunks: ["f3"] },
  ],
};
/** More hunks than the stub model answers before its output is cut. */
const CUT_ABOVE_HUNKS = 45;
const DETAIL_MARKER = /\[hunk f\d+h\d+ ->/g;

function countMarkers(request: RecordedRequest): number {
  return [...request.user.matchAll(DETAIL_MARKER)].length;
}

/** A model whose answer is cut whenever a detail call carries too many hunks. */
function answerUnlessLarge(request: RecordedRequest) {
  if (request.label === "grouping") {
    return UNEVEN_GROUPING;
  }
  return countMarkers(request) > CUT_ABOVE_HUNKS
    ? cut()
    : answerDetail(request);
}

describe("a cut batch with one large group", () => {
  it("halves it evenly, so neither half is cut again", async () => {
    const generator = new FakeGenerator(answerUnlessLarge);

    const { brief } = await generateBrief(
      makeOptions(generator, { pr: UNEVEN_PR, lockfileSummaries: new Map() }),
    );

    expect(generator.requests.map((request) => request.label)).toEqual([
      "grouping",
      "detail:1",
      "detail:1:1",
      "detail:1:2",
    ]);
    expect(generator.requests.slice(2).map(countMarkers)).toEqual([40, 40]);
    expect(brief.chunks).toHaveLength(80);
    expect(brief.unattributed).toEqual([]);
  });
});

describe("a cut single call", () => {
  it("re-runs once as a multi-call run and records why", async () => {
    const generator = new FakeGenerator(answerUnlessCut(["brief"]));

    const { brief, warnings } = await generateBrief(
      makeOptions(generator, { forceMultiCall: false }),
    );

    expect(generator.requests.map((request) => request.label)).toEqual([
      "brief",
      "grouping",
      "detail:1",
      "detail:2",
    ]);
    expect(brief.outlineForm).toBe("full");
    expect(warnings).toContainEqual({
      kind: GenerationWarningKinds.SINGLE_CALL_CUT,
      message: expect.stringContaining("multi-call"),
    });
  });

  it("starts the multi-call run with only the cut warning carried over", async () => {
    const generator = new FakeGenerator(answerUnlessCut(["brief"]));
    const oversized = {
      customAttributes: [],
      instructions: {
        path: ".mergebrief/instructions.md",
        blobSha: "abc123",
        content: "x".repeat(INSTRUCTIONS_INJECTION_BUDGET_BYTES + 1),
      },
    };

    const { warnings } = await generateBrief(
      makeOptions(generator, { forceMultiCall: false, repoContext: oversized }),
    );

    expect(warnings.map((warning) => warning.kind)).toEqual([
      GenerationWarningKinds.SINGLE_CALL_CUT,
      GenerationWarningKinds.REPO_INSTRUCTIONS_OMITTED,
    ]);
  });

  it("mints the ids past the chain and reports the run as not anchored", async () => {
    const firstRun = new FakeGenerator(makeAnswer());
    const first = await generateBrief(makeOptions(firstRun));
    const generator = new FakeGenerator(answerUnlessCut(["brief"]));

    const { brief, ranAs, anchoring } = await generateBrief(
      makeOptions(generator, {
        forceMultiCall: false,
        headIndex: 2,
        previous: {
          brief: first.brief,
          baseShaMoved: false,
          chainGroupIds: ["g1", "g2", "g3", "g4"],
        },
      }),
    );

    expect(generator.requests[0]?.label).toBe("brief");
    expect(ranAs).toBe(CallPlanKinds.MULTI);
    expect(anchoring).toBeUndefined();
    expect(brief.changeGroups.map((group) => group.id)).toEqual([
      "g5",
      "g6",
      "g7",
    ]);
  });

  it("resumes a retry from stored parts without resending the single call", async () => {
    const stored = new Map<string, unknown>();
    const firstAttempt = new FakeGenerator((request) => {
      if (request.label === "detail:2") {
        throw new Error("rate limited");
      }
      return answerUnlessCut(["brief"])(request);
    });
    const hooks = {
      loadPart: async (key: string) => stored.get(key),
      onPartDone: async (key: string, body: unknown) => {
        stored.set(key, body);
      },
    };
    await expect(
      generateBrief(
        makeOptions(firstAttempt, {
          forceMultiCall: false,
          multiCallHooks: hooks,
        }),
      ),
    ).rejects.toThrow("rate limited");

    const retry = new FakeGenerator(answerUnlessCut(["brief"]));
    const { ranAs, warnings } = await generateBrief(
      makeOptions(retry, { forceMultiCall: false, multiCallHooks: hooks }),
    );

    expect(retry.requests.map((request) => request.label)).toEqual([
      "detail:2",
    ]);
    expect(ranAs).toBe(CallPlanKinds.MULTI);
    expect(warnings.map((warning) => warning.kind)).toContain(
      GenerationWarningKinds.SINGLE_CALL_CUT,
    );
  });

  it("sends the single call when the stored grouping cannot be read", async () => {
    const generator = new FakeGenerator(answerUnlessCut([]));
    const multiCallHooks = {
      loadPart: async () => {
        throw new Error("parts store unavailable");
      },
    };

    const { ranAs } = await generateBrief(
      makeOptions(generator, { forceMultiCall: false, multiCallHooks }),
    );

    expect(generator.requests.map((request) => request.label)).toEqual([
      "brief",
    ]);
    expect(ranAs).toBe(CallPlanKinds.SINGLE);
  });

  it("re-throws a cut single call when the caller passes no hooks", async () => {
    const generator = new FakeGenerator(answerUnlessCut(["brief"]));

    await expect(
      generateBrief(
        makeOptions(generator, {
          forceMultiCall: false,
          multiCallHooks: undefined,
        }),
      ),
    ).rejects.toMatchObject({ kind: GeneratorErrorKinds.OUTPUT_CUT });
    expect(generator.requests).toHaveLength(1);
  });

  it("fails the run when the grouping call is cut too", async () => {
    const generator = new FakeGenerator(answerUnlessCut(["brief", "grouping"]));

    await expect(
      generateBrief(makeOptions(generator, { forceMultiCall: false })),
    ).rejects.toMatchObject({ kind: GeneratorErrorKinds.OUTPUT_CUT });
  });

  it("leaves any other failure to the caller", async () => {
    const generator = new FakeGenerator((request) => {
      if (request.label === "brief") {
        throw new GeneratorError(GeneratorErrorKinds.REFUSAL, "refused");
      }
      return grouping;
    });

    await expect(
      generateBrief(makeOptions(generator, { forceMultiCall: false })),
    ).rejects.toMatchObject({ kind: GeneratorErrorKinds.REFUSAL });
    expect(generator.requests).toHaveLength(1);
  });
});
