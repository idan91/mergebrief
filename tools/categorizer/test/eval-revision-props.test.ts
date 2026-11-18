import { describe, expect, it } from "vitest";
import type { DeltaBrief, RevisionNarrative } from "brief-core/types";
import {
  deltaCommentsFromInput,
  deltaCoversSpan,
  deltaGrounded,
  deltaNoChange,
  deltaNoReplay,
  narrativeCoversSpan,
  narrativeGrounded,
  narrativeNoChange,
  narrativeNoReplay,
} from "../eval/revision-props";
import type { DeltaRun, NarrativeRun } from "../eval/revision-runs";
import { makeBrief } from "./eval-fixtures";
import { DIFF_B } from "./pair-fixtures";

const LINE_TWO = [{ start: 2, end: 2 }];

/** DIFF_B's PR run at line 2, then a base edit the filter dropped: line 12 added. */
const SPAN_WITH_BASE_EDIT = `${DIFF_B}@@ -10,1 +11,2 @@
 ten
+base edit
`;

/** DIFF_B's PR run, then a base deletion the filter dropped, sitting before line 12. */
const SPAN_WITH_BASE_DELETION = `${DIFF_B}@@ -10,2 +11,1 @@
 ten
-gone
`;

function makeNarrativeRun(
  chunks: Partial<RevisionNarrative["chunks"][number]>[],
  unfilteredSpan = DIFF_B,
): NarrativeRun {
  const narrative = {
    artifactKind: "revisionNarrative",
    overview: "o",
    chunks: chunks.map((chunk, index) => ({
      id: `rc${index + 1}`,
      briefChangeGroupId: "g1",
      file: "b.ts",
      addedRanges: LINE_TWO,
      removedRanges: [],
      summary: "s",
      ...chunk,
    })),
  } as RevisionNarrative;
  return {
    brief: makeBrief(),
    narrative,
    modelChunks: narrative.chunks,
    marksFiles: [{ file: "b.ts", addedRanges: LINE_TWO, removedRanges: [] }],
    filteredSpan: DIFF_B,
    unfilteredSpan,
    modelCalls: 1,
  };
}

function makeDeltaRun(
  chunks: Partial<DeltaBrief["chunks"][number]>[],
  overrides: Partial<DeltaRun> = {},
): DeltaRun {
  const delta = {
    summary: "s",
    commentsAddressed: "",
    wholePrImpact: "w",
    changedGroups: [{ id: "d1" }],
    chunks: chunks.map((chunk, index) => ({
      id: `dc${index + 1}`,
      changeGroupId: "d1",
      file: "b.ts",
      role: "core",
      addedRanges: LINE_TWO,
      removedRanges: [],
      addressesComments: [],
      ...chunk,
    })),
  } as unknown as DeltaBrief;
  return {
    delta,
    modelChunks: delta.chunks,
    filteredSpan: DIFF_B,
    unfilteredSpan: DIFF_B,
    reviewComments: [],
    unknownGroupChunkIds: [],
    modelCalls: 1,
    ...overrides,
  };
}

const NARRATIVE_RECORD = {
  artifactKind: "revisionNarrativeUnchanged",
} as NarrativeRun["narrative"];
const DELTA_RECORD = { artifactKind: "deltaUnchanged" } as DeltaRun["delta"];

describe("narrativeNoChange", () => {
  it("passes on the record over an empty span with no model call", () => {
    const run: NarrativeRun = {
      ...makeNarrativeRun([]),
      narrative: NARRATIVE_RECORD,
      marksFiles: [],
      filteredSpan: "",
      modelCalls: 0,
    };

    expect(narrativeNoChange.check(run)).toBe(true);
    expect(narrativeNoChange.check({ ...run, modelCalls: 1 })).toBe(false);
  });

  it("fails on a narrative over an empty span or a record over a change", () => {
    const narrative = makeNarrativeRun([{}]);

    expect(narrativeNoChange.check(narrative)).toBe(true);
    expect(narrativeNoChange.check({ ...narrative, filteredSpan: "" })).toBe(
      false,
    );
    expect(
      narrativeNoChange.check({ ...narrative, narrative: NARRATIVE_RECORD }),
    ).toBe(false);
  });

  it("lets the chunk predicates read a record as no chunks", () => {
    const run = { ...makeNarrativeRun([]), narrative: NARRATIVE_RECORD };

    expect(narrativeGrounded.check(run)).toBe(true);
    expect(narrativeNoReplay.check(run)).toBe(true);
  });
});

describe("deltaNoChange", () => {
  it("passes on the record over an empty span with no model call", () => {
    const run = makeDeltaRun([], {
      delta: DELTA_RECORD,
      filteredSpan: "",
      modelCalls: 0,
    });

    expect(deltaNoChange.check(run)).toBe(true);
    expect(deltaNoChange.check({ ...run, modelCalls: 1 })).toBe(false);
    expect(deltaGrounded.check(run)).toBe(true);
    expect(deltaCommentsFromInput.check(run)).toBe(true);
  });

  it("fails on a delta over an empty span", () => {
    expect(deltaNoChange.check(makeDeltaRun([{}]))).toBe(true);
    expect(deltaNoChange.check(makeDeltaRun([{}], { filteredSpan: "" }))).toBe(
      false,
    );
  });
});

describe("narrativeGrounded", () => {
  it("passes when every chunk names a group and overlaps a mark", () => {
    expect(narrativeGrounded.check(makeNarrativeRun([{}]))).toBe(true);
  });

  it("fails on a chunk naming a group the brief lacks", () => {
    const run = makeNarrativeRun([{ briefChangeGroupId: "ghost" }]);

    expect(narrativeGrounded.check(run)).toBe(false);
  });

  it("fails on a chunk overlapping no mark", () => {
    const run = makeNarrativeRun([{ addedRanges: [{ start: 9, end: 9 }] }]);

    expect(narrativeGrounded.check(run)).toBe(false);
  });
});

describe("narrativeCoversSpan", () => {
  it("passes when a chunk covers every mark", () => {
    expect(narrativeCoversSpan.check(makeNarrativeRun([{}]))).toBe(true);
  });

  it("fails when a mark has no chunk", () => {
    expect(narrativeCoversSpan.check(makeNarrativeRun([]))).toBe(false);
  });
});

describe("narrativeNoReplay", () => {
  it("passes when every chunk file is in the filtered span", () => {
    expect(narrativeNoReplay.check(makeNarrativeRun([{}]))).toBe(true);
  });

  it("fails on a chunk in a file the filtered span lacks", () => {
    const run = makeNarrativeRun([{}, { file: "c.ts" }]);

    expect(narrativeNoReplay.check(run)).toBe(false);
  });

  it("passes on a chunk beside a base edit it does not hold", () => {
    const run = makeNarrativeRun([{}], SPAN_WITH_BASE_EDIT);

    expect(narrativeNoReplay.check(run)).toBe(true);
  });

  it("fails alone on a grounded chunk stretching over a base edit", () => {
    const addedRanges = [...LINE_TWO, { start: 12, end: 12 }];
    const run = makeNarrativeRun([{ addedRanges }], SPAN_WITH_BASE_EDIT);

    expect(narrativeGrounded.check(run)).toBe(true);
    expect(narrativeCoversSpan.check(run)).toBe(true);
    expect(narrativeNoReplay.check(run)).toBe(false);
  });

  it("fails on a chunk spanning the point a base deletion sits before", () => {
    const addedRanges = [{ start: 2, end: 12 }];
    const run = makeNarrativeRun([{ addedRanges }], SPAN_WITH_BASE_DELETION);

    expect(narrativeNoReplay.check(run)).toBe(false);
  });

  it("fails alone on removed lines that replay a base deletion", () => {
    const removedRanges = [{ start: 11, end: 11 }];
    const run = makeNarrativeRun(
      [{}, { addedRanges: [], removedRanges }],
      SPAN_WITH_BASE_DELETION,
    );

    expect(narrativeNoReplay.check(run)).toBe(false);
  });

  it("passes on removed lines beside a base deletion", () => {
    const removedRanges = [{ start: 10, end: 10 }];
    const run = makeNarrativeRun(
      [{}, { addedRanges: [], removedRanges }],
      SPAN_WITH_BASE_DELETION,
    );

    expect(narrativeNoReplay.check(run)).toBe(true);
  });

  it("passes on a chunk ending on the line a base deletion sits before", () => {
    const addedRanges = [{ start: 12, end: 12 }];
    const run = makeNarrativeRun(
      [{}, { addedRanges }],
      SPAN_WITH_BASE_DELETION,
    );

    expect(narrativeNoReplay.check(run)).toBe(true);
  });
});

describe("deltaGrounded", () => {
  it("passes on a clean partition with no dropped chunk", () => {
    expect(deltaGrounded.check(makeDeltaRun([{}]))).toBe(true);
  });

  it("fails when the model named an unknown group", () => {
    const run = makeDeltaRun([{}], { unknownGroupChunkIds: ["dc9"] });

    expect(deltaGrounded.check(run)).toBe(false);
  });

  it("fails on a group with no core chunk", () => {
    expect(deltaGrounded.check(makeDeltaRun([{ role: "supporting" }]))).toBe(
      false,
    );
  });

  it("fails on two chunks claiming one line", () => {
    expect(deltaGrounded.check(makeDeltaRun([{}, {}]))).toBe(false);
  });
});

describe("deltaNoReplay", () => {
  it("passes when every chunk file is in the filtered span", () => {
    expect(deltaNoReplay.check(makeDeltaRun([{}]))).toBe(true);
  });

  it("fails on a chunk in a file the filtered span lacks", () => {
    expect(deltaNoReplay.check(makeDeltaRun([{ file: "c.ts" }]))).toBe(false);
  });

  it("fails alone on a grounded chunk stretching over a base edit", () => {
    const addedRanges = [...LINE_TWO, { start: 12, end: 12 }];
    const run = makeDeltaRun([{ addedRanges }], {
      unfilteredSpan: SPAN_WITH_BASE_EDIT,
    });

    expect(deltaGrounded.check(run)).toBe(true);
    expect(deltaCoversSpan.check(run)).toBe(true);
    expect(deltaNoReplay.check(run)).toBe(false);
  });

  it("fails alone on removed lines that replay a base deletion", () => {
    const removedRanges = [{ start: 11, end: 11 }];
    const run = makeDeltaRun([{}, { addedRanges: [], removedRanges }], {
      unfilteredSpan: SPAN_WITH_BASE_DELETION,
    });

    expect(deltaNoReplay.check(run)).toBe(false);
  });
});

describe("deltaCoversSpan", () => {
  it("passes when a chunk covers every mark", () => {
    expect(deltaCoversSpan.check(makeDeltaRun([{}]))).toBe(true);
  });

  it("fails alone when a mark has no chunk", () => {
    const run = makeDeltaRun([{ addedRanges: [{ start: 3, end: 3 }] }]);

    expect(deltaGrounded.check(run)).toBe(true);
    expect(deltaNoReplay.check(run)).toBe(true);
    expect(deltaCoversSpan.check(run)).toBe(false);
  });

  it("passes on the no-change record over an empty span", () => {
    const run = makeDeltaRun([], { delta: DELTA_RECORD, filteredSpan: "" });

    expect(deltaCoversSpan.check(run)).toBe(true);
  });
});

describe("deltaCommentsFromInput", () => {
  const comment = {
    id: "101",
    file: "b.ts",
    startLine: null,
    line: 2,
    originalStartLine: null,
    originalLine: 2,
    author: "reviewer",
    body: "b",
    inReplyToId: null,
    outdated: false,
  };

  it("passes when every addressed id was an input comment", () => {
    const run = makeDeltaRun([{ addressesComments: ["101"] }], {
      reviewComments: [comment],
    });

    expect(deltaCommentsFromInput.check(run)).toBe(true);
  });

  it("fails on an addressed id the input never held", () => {
    const run = makeDeltaRun([{ addressesComments: ["999"] }], {
      reviewComments: [comment],
    });

    expect(deltaCommentsFromInput.check(run)).toBe(false);
  });

  it("fails on comments-addressed text when the input held none", () => {
    const plain = makeDeltaRun([{}]);
    const run = {
      ...plain,
      delta: { ...plain.delta, commentsAddressed: "Addressed the ask." },
    };

    expect(deltaCommentsFromInput.check(run)).toBe(false);
  });
});
