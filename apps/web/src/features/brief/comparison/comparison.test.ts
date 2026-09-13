import type { DiffLine } from "@web/utils/diffTokens/types";
import { describe, expect, it } from "vitest";

import {
  bindComparisonCallout,
  bindDeltaCallout,
  bindRevisionNarrativeCallout,
  buildChunkComparisonView,
  comparisonRunKey,
  deriveRevisionJumpTargets,
  groupComparisonRuns,
  markComparisonRows,
} from "./comparison";
import type {
  Brief,
  BriefChunk,
  RevisionChanges,
  RevisionNarrative,
} from "../types";

function chunk(file: string, diff: DiffLine[]): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "core",
    loc: { added: 0, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff,
  };
}

// hunk, ctx@10, add@11, add@12, ctx@13, del(old12), ctx@14
const scenario = chunk("src/a.ts", [
  { kind: "hunk", content: "@@" },
  { kind: "ctx", content: "ctx", oldLine: 10, newLine: 10 },
  { kind: "add", content: "added 11", newLine: 11 },
  { kind: "add", content: "added 12", newLine: 12 },
  { kind: "ctx", content: "ctx", oldLine: 11, newLine: 13 },
  { kind: "del", content: "gone", oldLine: 12 },
  { kind: "ctx", content: "ctx", oldLine: 13, newLine: 14 },
]);

const marks: RevisionChanges = {
  headSha: "head",
  prevHeadSha: "prev",
  prevIndex: 1,
  files: [
    {
      file: "src/a.ts",
      addedRanges: [{ start: 11, end: 12 }],
      removedRanges: [{ start: 12, end: 12 }],
    },
  ],
};

function firstRun() {
  const run = groupComparisonRuns(
    scenario,
    markComparisonRows(scenario, marks),
  )[0];
  if (!run) throw new Error("expected a run");
  return run;
}

describe("markComparisonRows", () => {
  it("marks add rows by head line and del rows by old line", () => {
    const rows = markComparisonRows(scenario, marks);
    expect(rows.get(2)).toBe("added");
    expect(rows.get(3)).toBe("added");
    expect(rows.get(5)).toBe("removed");
    expect(rows.has(1)).toBe(false); // ctx@10 not in any range
    expect(rows.has(4)).toBe(false); // ctx@13 not in any range
  });

  it("marks a context row whose head line changed for this baseline", () => {
    const ctxChunk = chunk("src/a.ts", [
      { kind: "ctx", content: "x", oldLine: 11, newLine: 11 },
    ]);
    expect(markComparisonRows(ctxChunk, marks).get(0)).toBe("added");
  });

  it("returns no marks when marks are absent or the file is untouched", () => {
    expect(markComparisonRows(scenario, null).size).toBe(0);
    expect(
      markComparisonRows(chunk("src/other.ts", scenario.diff ?? []), marks)
        .size,
    ).toBe(0);
  });
});

describe("groupComparisonRuns", () => {
  it("groups contiguous adds into one run and a lone deletion into another", () => {
    const runs = groupComparisonRuns(
      scenario,
      markComparisonRows(scenario, marks),
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ rowIndexes: [2, 3], kind: "added" });
    expect(runs[1]).toMatchObject({ rowIndexes: [5], kind: "removed" });
  });

  it("reads a del and add pair as one added run", () => {
    const mod = chunk("src/a.ts", [
      { kind: "del", content: "old", oldLine: 20 },
      { kind: "add", content: "new", newLine: 20 },
    ]);
    const modMarks: RevisionChanges = {
      headSha: "head",
      prevHeadSha: "prev",
      prevIndex: 1,
      files: [
        {
          file: "src/a.ts",
          addedRanges: [{ start: 20, end: 20 }],
          removedRanges: [{ start: 20, end: 20 }],
        },
      ],
    };
    const runs = groupComparisonRuns(mod, markComparisonRows(mod, modMarks));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ rowIndexes: [0, 1], kind: "added" });
  });
});

describe("buildChunkComparisonView", () => {
  it("maps each marked row index to its run", () => {
    const view = buildChunkComparisonView(scenario, marks);
    expect(view.runByRow.get(2)?.kind).toBe("added");
    expect(view.runByRow.get(5)?.kind).toBe("removed");
    expect(view.runByRow.has(1)).toBe(false);
  });
});

const delta: Brief = {
  artifactKind: "delta",
  pr: {
    repo: "o/r",
    number: 1,
    title: "t",
    url: "https://example.com/o/r/pull/1",
    sha: "head",
    description: "",
  },
  summary: "s",
  changeGroups: [
    {
      id: "g1",
      title: "Typed state",
      summary: "group summary",
      dominantCategory: "logic-refactor",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "d1",
      changeGroupId: "g1",
      file: "src/a.ts",
      concern: "implementation",
      role: "core",
      loc: { added: 2, deleted: 0 },
      addedRanges: [{ start: 11, end: 12 }],
      removedRanges: [],
      riskSurface: [],
      summary: "chunk summary",
    },
  ],
  concernView: [],
};

describe("bindDeltaCallout", () => {
  it("resolves the delta change-group for an added run once a delta loads", () => {
    expect(bindDeltaCallout(firstRun(), scenario, delta)).toEqual({
      available: true,
      groupTitle: "Typed state",
      summary: "chunk summary",
    });
  });

  it("is unavailable with no delta or no matching delta chunk", () => {
    expect(bindDeltaCallout(firstRun(), scenario, null)).toEqual({
      available: false,
    });
    const otherFileRun = { ...firstRun(), file: "src/missing.ts" };
    expect(
      bindDeltaCallout(
        otherFileRun,
        chunk("src/missing.ts", scenario.diff ?? []),
        delta,
      ),
    ).toEqual({ available: false });
  });
});

const fullBrief: Brief = {
  artifactKind: "brief",
  pr: delta.pr,
  summary: "s",
  changeGroups: [
    {
      id: "g2",
      title: "Extract scroller hook",
      summary: "group summary",
      dominantCategory: "logic-refactor",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [],
  concernView: [],
};

const narrative: RevisionNarrative = {
  artifactKind: "revisionNarrative",
  pr: delta.pr,
  prevHeadSha: "prev",
  headSha: "head",
  prevIndex: 1,
  headIndex: 2,
  generation: { provider: "anthropic", model: "m", effort: null },
  overview: "This revision extracts a hook.",
  chunks: [
    {
      id: "rc1",
      briefChangeGroupId: "g2",
      file: "src/a.ts",
      addedRanges: [{ start: 11, end: 12 }],
      removedRanges: [],
      summary: "Adds the scroller hook.",
    },
  ],
};

describe("bindRevisionNarrativeCallout", () => {
  it("titles from the full Brief group and bodies from the narrative chunk", () => {
    expect(
      bindRevisionNarrativeCallout(firstRun(), scenario, fullBrief, narrative),
    ).toEqual({
      available: true,
      groupTitle: "Extract scroller hook",
      summary: "Adds the scroller hook.",
    });
  });

  // The scenario chunk's own group, for the degraded fallback.
  const briefWithOwnGroup: Brief = {
    ...fullBrief,
    changeGroups: [
      ...fullBrief.changeGroups,
      {
        id: "g1",
        title: "Owning group",
        summary: "own group summary",
        dominantCategory: "logic-refactor",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
  };

  it("degrades to the chunk's own group when no narrative chunk matches", () => {
    const elsewhere: RevisionNarrative = {
      ...narrative,
      chunks: [
        { ...narrative.chunks[0]!, addedRanges: [{ start: 90, end: 95 }] },
      ],
    };
    expect(
      bindRevisionNarrativeCallout(
        firstRun(),
        scenario,
        briefWithOwnGroup,
        elsewhere,
      ),
    ).toEqual({
      available: true,
      degraded: true,
      groupTitle: "Owning group",
      summary: "own group summary", // scenario chunk has no summary → group's
    });
  });

  it("prefers the chunk's own summary in the degraded fallback", () => {
    const summarized = { ...scenario, summary: "chunk summary" };
    expect(
      bindRevisionNarrativeCallout(firstRun(), summarized, briefWithOwnGroup, {
        ...narrative,
        chunks: [],
      }),
    ).toEqual({
      available: true,
      degraded: true,
      groupTitle: "Owning group",
      summary: "chunk summary",
    });
  });

  it("keeps the span summary under the chunk's group when the group dangles", () => {
    const orphan: RevisionNarrative = {
      ...narrative,
      chunks: [{ ...narrative.chunks[0]!, briefChangeGroupId: "missing" }],
    };
    // The span summary is real: no degraded note, only the title is re-homed.
    expect(
      bindRevisionNarrativeCallout(
        firstRun(),
        scenario,
        briefWithOwnGroup,
        orphan,
      ),
    ).toEqual({
      available: true,
      groupTitle: "Owning group",
      summary: "Adds the scroller hook.",
    });
  });

  it("omits the summary in the removed-run degraded fallback", () => {
    const removedRun = groupComparisonRuns(
      scenario,
      markComparisonRows(scenario, marks),
    )[1];
    if (!removedRun) throw new Error("expected the standalone-deletion run");
    expect(removedRun.kind).toBe("removed");
    const summarized = { ...scenario, summary: "Adds the scroller hook." };
    expect(
      bindRevisionNarrativeCallout(removedRun, summarized, briefWithOwnGroup, {
        ...narrative,
        chunks: [],
      }),
    ).toEqual({
      available: true,
      degraded: true,
      groupTitle: "Owning group",
    });
  });

  it("stays unavailable when the fallback group is missing from the Brief", () => {
    const orphan: RevisionNarrative = {
      ...narrative,
      chunks: [{ ...narrative.chunks[0]!, briefChangeGroupId: "missing" }],
    };
    // fullBrief has no "g1" (the scenario chunk's group), nothing to degrade to.
    expect(
      bindRevisionNarrativeCallout(firstRun(), scenario, fullBrief, orphan),
    ).toEqual({ available: false });
  });

  it("is unavailable when the narrative is absent", () => {
    expect(
      bindRevisionNarrativeCallout(firstRun(), scenario, fullBrief, null),
    ).toEqual({ available: false });
  });
});

describe("bindRevisionNarrativeCallout remainder rows", () => {
  const remainderChunk: BriefChunk = {
    ...scenario,
    id: "u-3f0d7c10",
    changeGroupId: "unattributed-remainder",
  };

  it("titles a remainder row with the marker when a narrative covers it", () => {
    expect(
      bindRevisionNarrativeCallout(
        firstRun(),
        remainderChunk,
        fullBrief,
        narrative,
      ),
    ).toEqual({
      available: true,
      remainder: true,
      summary: "Adds the scroller hook.",
    });
  });

  it("degrades a remainder row with the marker when no narrative covers it", () => {
    expect(
      bindRevisionNarrativeCallout(firstRun(), remainderChunk, fullBrief, {
        ...narrative,
        chunks: [],
      }),
    ).toEqual({
      available: true,
      degraded: true,
      remainder: true,
    });
  });
});

describe("bindComparisonCallout", () => {
  it("dispatches to the narrative adapter for previous-brief", () => {
    expect(
      bindComparisonCallout(firstRun(), scenario, {
        kind: "previous-brief",
        brief: fullBrief,
        narrative,
      }),
    ).toMatchObject({ available: true, groupTitle: "Extract scroller hook" });
  });

  it("dispatches to the delta adapter for last-review", () => {
    expect(
      bindComparisonCallout(firstRun(), scenario, {
        kind: "last-review",
        delta,
      }),
    ).toMatchObject({ available: true, groupTitle: "Typed state" });
  });
});

describe("deriveRevisionJumpTargets", () => {
  it("emits one target per run, in chunk order, keyed like the gutter", () => {
    const targets = deriveRevisionJumpTargets([scenario], marks);
    const { runs } = buildChunkComparisonView(scenario, marks);
    expect(targets.length).toBe(runs.length);
    expect(targets.map((target) => target.railKey)).toEqual(
      runs.map(comparisonRunKey),
    );
    for (const target of targets) expect(target.chunkId).toBe("c1");
  });

  it("returns nothing for null marks or unmarked chunks", () => {
    expect(deriveRevisionJumpTargets([scenario], null)).toEqual([]);
    const untouched = chunk("src/other.ts", [
      { kind: "ctx", content: "ctx", oldLine: 1, newLine: 1 },
    ]);
    expect(deriveRevisionJumpTargets([untouched], marks)).toEqual([]);
  });
});
