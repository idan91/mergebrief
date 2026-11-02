import {
  BetweenHeadsKinds,
  type BetweenHeadsContents,
  type BetweenHeadsFile,
  type PrSpanInput,
} from "brief-core/pr-span";
import { describe, expect, it } from "vitest";
import { SpanStepAnswerSchema, SpanStepRequestSchema } from "./schemas";
import { SpanStepAnswerKinds, SpanStepKinds } from "./types";

/** Every field typed required, so a field added to the contents fails here until the schema reads it. */
const FULL_CONTENTS: Required<BetweenHeadsContents> = {
  prevPath: "lib/old.ts",
  path: "lib/new.ts",
  prevContent: "a\n",
  newContent: "b\n",
  modeChange: { prevMode: "100644", newMode: "100755" },
  prevMode: "100644",
  newMode: "100755",
};

/** Every field typed required, so a field added to the build input fails here until the schema reads it. */
const FULL_BUILD_INPUT: Required<PrSpanInput> = {
  prevPrDiff: "diff --git a/a b/a\n",
  newPrDiff: "diff --git a/a b/a\n",
  betweenHeads: new Map<string, BetweenHeadsFile>([
    [
      "a",
      {
        kind: BetweenHeadsKinds.PATCH,
        patch: "@@ -1 +1 @@\n-a\n+b\n",
        texts: { prevContent: "a\n", newContent: "b\n" },
      },
    ],
    ["b", { kind: BetweenHeadsKinds.UNREADABLE }],
  ]),
  baseRenames: new Set(["a"]),
};

function makeLineDiffRequest(input: Record<string, unknown>) {
  return { id: 1, step: { kind: SpanStepKinds.LINE_DIFF, input } };
}

describe("SpanStepRequestSchema", () => {
  it("reads back every contents field the parent sends", () => {
    const request = {
      id: 1,
      step: {
        kind: SpanStepKinds.LINE_DIFF,
        input: { contents: FULL_CONTENTS, maxEditLength: 9 },
      },
    };

    expect(SpanStepRequestSchema.parse(request)).toEqual(request);
  });

  it.each([
    [
      "the request",
      {
        ...makeLineDiffRequest({ contents: FULL_CONTENTS, maxEditLength: 9 }),
        extra: 1,
      },
    ],
    [
      "the input",
      makeLineDiffRequest({
        contents: FULL_CONTENTS,
        maxEditLength: 9,
        extra: 1,
      }),
    ],
    [
      "the contents",
      makeLineDiffRequest({
        contents: { ...FULL_CONTENTS, extra: 1 },
        maxEditLength: 9,
      }),
    ],
    [
      "a build input",
      {
        id: 1,
        step: {
          kind: SpanStepKinds.BUILD_PR_SPAN,
          input: { ...FULL_BUILD_INPUT, extra: 1 },
        },
      },
    ],
  ])("refuses a field it does not know on %s", (_level, request) => {
    expect(SpanStepRequestSchema.safeParse(request).success).toBe(false);
  });

  it("reads back every build field the parent sends", () => {
    const request = {
      id: 2,
      step: { kind: SpanStepKinds.BUILD_PR_SPAN, input: FULL_BUILD_INPUT },
    };

    expect(SpanStepRequestSchema.parse(request)).toEqual(request);
  });
});

const HUNK = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2 };

const SPAN = {
  changedFiles: ["a"],
  unchangedFiles: [],
  unpairableFiles: [],
  filteredDiff: "",
  unfilteredDiff: "",
  hop: [{ file: "a", hunks: [HUNK] }],
  isUnchanged: false,
};

const LINE_DIFF_FILE = {
  path: "a",
  prevPath: "a",
  prev: { mode: "100644" },
  next: { mode: "100644" },
};

function makePlanAnswer(lineDiffFile: Record<string, unknown>) {
  return {
    id: 3,
    kind: SpanStepAnswerKinds.PLAN,
    plan: {
      changedCount: 1,
      lineDiffFiles: [lineDiffFile],
      baseRenameCandidates: [],
    },
  };
}

describe("SpanStepAnswerSchema", () => {
  it("reads back a span answer the thread sends", () => {
    const answer = { id: 3, kind: SpanStepAnswerKinds.SPAN, span: SPAN };

    expect(SpanStepAnswerSchema.parse(answer)).toEqual(answer);
  });

  it.each([
    ["the answer", { id: 3, kind: SpanStepAnswerKinds.NO_PATCH, extra: 1 }],
    [
      "a span",
      { id: 3, kind: SpanStepAnswerKinds.SPAN, span: { ...SPAN, extra: 1 } },
    ],
    [
      "a hop hunk",
      {
        id: 3,
        kind: SpanStepAnswerKinds.SPAN,
        span: { ...SPAN, hop: [{ file: "a", hunks: [{ ...HUNK, extra: 1 }] }] },
      },
    ],
    ["a line-diff file", makePlanAnswer({ ...LINE_DIFF_FILE, extra: 1 })],
  ])("refuses a field it does not know on %s", (_level, answer) => {
    expect(SpanStepAnswerSchema.safeParse(answer).success).toBe(false);
  });
});
