import { describe, expect, it } from "vitest";

import { bindCallout, buildChunkRevisionView, groupRevisionRuns, markRevisionRows } from "./revisionChanges";
import type { Brief, BriefChunk, DiffLine, RevisionChanges } from "./types";

function chunk(file: string, diff: DiffLine[]): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "carrier",
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

const rc: RevisionChanges = {
  headSha: "head",
  prevHeadSha: "prev",
  prevIndex: 1,
  files: [{ file: "src/a.ts", addedRanges: [{ start: 11, end: 12 }], removedRanges: [{ start: 12, end: 12 }] }],
};

describe("markRevisionRows", () => {
  it("marks add rows by head line and del rows by old line", () => {
    const marks = markRevisionRows(scenario, rc);
    expect(marks.get(2)).toBe("added");
    expect(marks.get(3)).toBe("added");
    expect(marks.get(5)).toBe("removed");
    expect(marks.has(1)).toBe(false); // ctx@10 not in any range
    expect(marks.has(4)).toBe(false); // ctx@13 not in any range
  });

  it("marks a context row whose head line changed this revision", () => {
    const ctxChunk = chunk("src/a.ts", [{ kind: "ctx", content: "x", oldLine: 11, newLine: 11 }]);
    expect(markRevisionRows(ctxChunk, rc).get(0)).toBe("added");
  });

  it("returns no marks when the sidecar is absent or the file is untouched", () => {
    expect(markRevisionRows(scenario, null).size).toBe(0);
    expect(markRevisionRows(chunk("src/other.ts", scenario.diff ?? []), rc).size).toBe(0);
  });
});

describe("groupRevisionRuns", () => {
  it("groups contiguous adds into one run and a standalone deletion into another", () => {
    const runs = groupRevisionRuns(scenario, markRevisionRows(scenario, rc));
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ rowIndexes: [2, 3], kind: "added" });
    expect(runs[1]).toMatchObject({ rowIndexes: [5], kind: "removed" });
  });

  it("reads a modification (del+add pair) as a single 'added' run", () => {
    const mod = chunk("src/a.ts", [
      { kind: "del", content: "old", oldLine: 20 },
      { kind: "add", content: "new", newLine: 20 },
    ]);
    const modRc: RevisionChanges = {
      headSha: "head",
      prevHeadSha: "prev",
      prevIndex: 1,
      files: [{ file: "src/a.ts", addedRanges: [{ start: 20, end: 20 }], removedRanges: [{ start: 20, end: 20 }] }],
    };
    const runs = groupRevisionRuns(mod, markRevisionRows(mod, modRc));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ rowIndexes: [0, 1], kind: "added" });
  });
});

describe("buildChunkRevisionView", () => {
  it("maps each marked row index to its run", () => {
    const view = buildChunkRevisionView(scenario, rc);
    expect(view.runByRow.get(2)?.kind).toBe("added");
    expect(view.runByRow.get(5)?.kind).toBe("removed");
    expect(view.runByRow.has(1)).toBe(false);
  });
});

describe("bindCallout", () => {
  const delta: Brief = {
    artifactKind: "delta",
    pr: { repo: "o/r", number: 1, title: "t", url: "u", sha: "head", description: "" },
    summary: "s",
    changeGroups: [
      { id: "g1", title: "Typed state", summary: "group summary", dominantCategory: "logic-refactor", secondaryCategories: [], uncertain: false, uncertainBetween: [] },
    ],
    chunks: [
      { id: "d1", changeGroupId: "g1", file: "src/a.ts", concern: "implementation", role: "carrier", loc: { added: 2, deleted: 0 }, addedRanges: [{ start: 11, end: 12 }], removedRanges: [], riskSurface: [], summary: "chunk summary" },
    ],
    concernView: [],
  };

  it("resolves the delta change-group for an added run when a delta is loaded", () => {
    const run = groupRevisionRuns(scenario, markRevisionRows(scenario, rc))[0];
    if (!run) throw new Error("expected a run");
    expect(bindCallout(run, scenario, delta)).toEqual({ available: true, groupTitle: "Typed state", summary: "chunk summary" });
  });

  it("is unavailable with no delta or no matching delta chunk", () => {
    const run = groupRevisionRuns(scenario, markRevisionRows(scenario, rc))[0];
    if (!run) throw new Error("expected a run");
    expect(bindCallout(run, scenario, null)).toEqual({ available: false });
    const otherFileRun = { ...run, file: "src/missing.ts" };
    expect(bindCallout(otherFileRun, chunk("src/missing.ts", scenario.diff ?? []), delta)).toEqual({ available: false });
  });
});
