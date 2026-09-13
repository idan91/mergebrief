import type { DiffLine } from "@web/utils/diffTokens/types";
import { describe, expect, it } from "vitest";

import type { BriefChunk, EdgeExpansion } from "../types";
import { findExpansionGaps } from "./expandRows";
import {
  buildExpansionKey,
  collectClaimedLines,
  collectStoredEdges,
  countExpandedLines,
  mapBaseIndexes,
  placeExpandableEdges,
  resolveExpanderStep,
  spliceStoredEdges,
} from "./expansionState";

// Old numbers run three ahead of new: a wrong offset would show here.
const base: DiffLine[] = [
  { kind: "hunk", content: "@@ -33,3 +30,3 @@" },
  { kind: "ctx", content: "a", oldLine: 33, newLine: 30 },
  { kind: "del", content: "b", oldLine: 34 },
  { kind: "add", content: "c", newLine: 31 },
  { kind: "ctx", content: "d", oldLine: 35, newLine: 32 },
  { kind: "hunk", content: "@@ -63,2 +60,2 @@" },
  { kind: "ctx", content: "e", oldLine: 63, newLine: 60 },
  { kind: "ctx", content: "f", oldLine: 64, newLine: 61 },
];

function stubLines(from: number, to: number): Map<number, string> {
  const lines = new Map<number, string>();
  for (let line = from; line <= to; line += 1) lines.set(line, `L${line}`);
  return lines;
}

function stubExpansion(start: number, end: number): EdgeExpansion {
  return { range: { start, end }, windows: [{ start, end }] };
}

describe("spliceStoredEdges", () => {
  it("lands a top and a lower expansion where each belongs", () => {
    const gaps = findExpansionGaps(base);
    const edges = new Map<string, EdgeExpansion>([
      ["c1:1:up", stubExpansion(10, 29)],
      ["c1:6:up", stubExpansion(40, 59)],
    ]);
    const stored = collectStoredEdges("c1", gaps, edges);
    const rows = spliceStoredEdges({
      rows: base,
      edges: stored,
      lines: stubLines(1, 70),
      claimed: [],
    });

    const expanded = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.kind === "expanded-context");
    expect(expanded).toHaveLength(40);
    expect(expanded[0]).toMatchObject({
      index: 1,
      row: { newLine: 10, oldLine: 13, content: "L10" },
    });
    expect(expanded[20]).toMatchObject({
      index: 26,
      row: { newLine: 40, oldLine: 43 },
    });
    expect(rows[25]).toMatchObject({
      kind: "hunk",
      content: "@@ -63,2 +60,2 @@",
    });
  });
});

describe("mapBaseIndexes", () => {
  it("maps spliced rows back to base rows and expanded rows to -1", () => {
    const spliced: DiffLine[] = [
      base[0]!,
      { kind: "expanded-context", content: "x", oldLine: 32, newLine: 29 },
      base[1]!,
      base[2]!,
    ];

    expect(mapBaseIndexes(base, spliced)).toEqual([0, -1, 1, 2]);
  });

  it("skips a base row the splice dropped", () => {
    const spliced: DiffLine[] = [base[4]!, base[6]!];

    expect(mapBaseIndexes(base, spliced)).toEqual([4, 6]);
  });
});

describe("placeExpandableEdges", () => {
  it("keys a spliced gap on its base edge and places it on spliced rows", () => {
    const baseGaps = findExpansionGaps(base);
    const edges = new Map<string, EdgeExpansion>([
      ["c1:1:up", stubExpansion(10, 29)],
    ]);
    const spliced = spliceStoredEdges({
      rows: base,
      edges: collectStoredEdges("c1", baseGaps, edges),
      lines: stubLines(1, 70),
      claimed: [],
    });
    const placed = placeExpandableEdges(
      "c1",
      baseGaps,
      findExpansionGaps(spliced),
      edges,
    );

    const top = placed.find((edge) => edge.edgeKey === "c1:1:up");
    expect(top).toMatchObject({ rowIndex: 1, gap: { from: 1, to: 29 } });
    expect(top?.expansion?.range).toEqual({ start: 10, end: 29 });
    const lower = placed.find((edge) => edge.edgeKey === "c1:6:up");
    expect(lower).toMatchObject({ rowIndex: 26, expansion: undefined });
  });
});

describe("resolveExpanderStep", () => {
  it("takes twenty lines while more remain and all of a short remainder", () => {
    const baseGaps = findExpansionGaps(base);
    const placed = placeExpandableEdges("c1", baseGaps, baseGaps, new Map());
    const top = placed.find((edge) => edge.edgeKey === "c1:1:up")!;
    const lower = placed.find((edge) => edge.edgeKey === "c1:6:up")!;

    expect(resolveExpanderStep(top, [])).toEqual({
      window: { from: 10, to: 29 },
      takesAll: false,
    });
    expect(resolveExpanderStep(lower, [{ start: 33, end: 50 }])).toEqual({
      window: { from: 51, to: 59 },
      takesAll: true,
    });
  });

  it("is spent once a read reached the end of the file", () => {
    const baseGaps = findExpansionGaps(base);
    const edges = new Map<string, EdgeExpansion>([
      ["c1:8:down", { ...stubExpansion(62, 70), totalLines: 70 }],
    ]);
    const placed = placeExpandableEdges("c1", baseGaps, baseGaps, edges);
    const tail = placed.find((edge) => edge.edgeKey === "c1:8:down")!;

    expect(resolveExpanderStep(tail, [])).toBeUndefined();
  });

  it("never calls an open tail a whole remainder", () => {
    const baseGaps = findExpansionGaps(base);
    const placed = placeExpandableEdges("c1", baseGaps, baseGaps, new Map());
    const tail = placed.find((edge) => edge.edgeKey === "c1:8:down")!;

    expect(resolveExpanderStep(tail, [])).toEqual({
      window: { from: 62, to: 81 },
      takesAll: false,
    });
  });
});

describe("countExpandedLines and buildExpansionKey", () => {
  it("count the chunk's own edges only and name the state", () => {
    const edges = new Map<string, EdgeExpansion>([
      ["c1:1:up", stubExpansion(10, 29)],
      ["c2:1:up", stubExpansion(1, 5)],
    ]);
    const stored = collectStoredEdges("c1", findExpansionGaps(base), edges);

    expect(countExpandedLines(edges, "c1")).toBe(20);
    expect(buildExpansionKey(stored)).toBe("c1:1:up=10-29");
    expect(buildExpansionKey([])).toBeUndefined();
  });
});

describe("collectClaimedLines", () => {
  it("gives each chunk its same-file siblings' new-line envelopes", () => {
    const sibling = {
      id: "c2",
      file: "src/a.ts",
      diff: base.slice(5),
    } as BriefChunk;
    const other = {
      id: "c3",
      file: "src/b.ts",
      diff: [{ kind: "ctx", content: "z", oldLine: 1, newLine: 1 }],
    } as BriefChunk;
    const own = {
      id: "c1",
      file: "src/a.ts",
      diff: base.slice(0, 5),
    } as BriefChunk;

    const claimed = collectClaimedLines([own, sibling, other]);

    expect(claimed.get("c1")).toEqual([{ start: 60, end: 61 }]);
    expect(claimed.get("c2")).toEqual([{ start: 30, end: 32 }]);
    expect(claimed.get("c3")).toEqual([]);
  });
});

describe("two edges of one hole", () => {
  const hole: DiffLine[] = [
    { kind: "hunk", content: "@@ -99,1 +99,1 @@" },
    { kind: "ctx", content: "top", oldLine: 99, newLine: 99 },
    { kind: "hunk", content: "@@ -145,1 +145,1 @@" },
    { kind: "ctx", content: "bottom", oldLine: 145, newLine: 145 },
  ];

  function click(edges: Map<string, EdgeExpansion>, edgeKey: string) {
    const baseGaps = findExpansionGaps(hole);
    const spliced = spliceStoredEdges({
      rows: hole,
      edges: collectStoredEdges("c1", baseGaps, edges),
      lines: stubLines(1, 200),
      claimed: [],
    });
    const placed = placeExpandableEdges(
      "c1",
      baseGaps,
      findExpansionGaps(spliced),
      edges,
    );
    const edge = placed.find((candidate) => candidate.edgeKey === edgeKey)!;
    const step = resolveExpanderStep(edge, [])!;
    const current = edges.get(edgeKey)?.range;
    const start = Math.min(current?.start ?? Infinity, step.window.from);
    const end = Math.max(current?.end ?? -Infinity, step.window.to);
    edges.set(edgeKey, stubExpansion(start, end));
    return { step, spliced };
  }

  it("stops each edge at the other's take and closes on the last click", () => {
    const edges = new Map<string, EdgeExpansion>();
    const down = "c1:2:down";
    const up = "c1:3:up";

    expect(click(edges, down).step.window).toEqual({ from: 100, to: 119 });
    expect(click(edges, up).step.window).toEqual({ from: 125, to: 144 });
    const last = click(edges, down);
    expect(last.step).toEqual({
      window: { from: 120, to: 124 },
      takesAll: true,
    });

    const rows = spliceStoredEdges({
      rows: hole,
      edges: collectStoredEdges("c1", findExpansionGaps(hole), edges),
      lines: stubLines(1, 200),
      claimed: [],
    });
    const shown = rows
      .filter((row) => row.kind === "expanded-context")
      .map((row) => row.newLine);
    expect(shown).toEqual(
      Array.from({ length: 45 }, (_unused, offset) => 100 + offset),
    );
    expect(rows.filter((row) => row.kind === "hunk")).toHaveLength(1);
    expect(
      new Set(rows.map((row) => `${row.kind}-${String(row.newLine)}`)).size,
    ).toBe(rows.length);
  });
});

describe("collectClaimedLines with sibling expansions", () => {
  const top = {
    id: "a",
    file: "src/a.ts",
    diff: [{ kind: "ctx", content: "t", oldLine: 20, newLine: 20 }],
  } as BriefChunk;
  const bottom = {
    id: "b",
    file: "src/a.ts",
    diff: [{ kind: "ctx", content: "u", oldLine: 50, newLine: 50 }],
  } as BriefChunk;

  it("stops each chunk at what the other has already expanded", () => {
    const edges = new Map<string, EdgeExpansion>([
      ["b:0:up", stubExpansion(30, 49)],
    ]);
    const claimed = collectClaimedLines([top, bottom], edges);
    const tail = placeExpandableEdges(
      "a",
      findExpansionGaps(top.diff!),
      findExpansionGaps(top.diff!),
      new Map(),
    ).find((edge) => edge.gap.edge.direction === "down")!;

    expect(claimed.get("a")).toEqual([
      { start: 50, end: 50 },
      { start: 30, end: 49 },
    ]);
    expect(resolveExpanderStep(tail, claimed.get("a")!)?.window).toEqual({
      from: 21,
      to: 29,
    });
  });
});
