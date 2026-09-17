import type { DiffLine } from "@web/utils/diffTokens/types";
import { describe, expect, it } from "vitest";

import type { EdgeExpansion } from "../types";
import { findExpansionGaps } from "./expandRows";
import {
  buildExpansionKey,
  collectStoredEdges,
  countExpandedRows,
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
    });

    const expanded = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.origin === "expanded");
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
      {
        kind: "ctx",
        origin: "expanded",
        content: "x",
        oldLine: 32,
        newLine: 29,
      },
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

    expect(resolveExpanderStep(top)).toEqual({
      window: { from: 10, to: 29 },
      takesAll: false,
    });
    expect(resolveExpanderStep(lower)).toEqual({
      window: { from: 40, to: 59 },
      takesAll: false,
    });
  });

  it("is spent once a read reached the end of the file", () => {
    const baseGaps = findExpansionGaps(base);
    const edges = new Map<string, EdgeExpansion>([
      ["c1:8:down", { ...stubExpansion(62, 70), totalLines: 70 }],
    ]);
    const placed = placeExpandableEdges("c1", baseGaps, baseGaps, edges);
    const tail = placed.find((edge) => edge.edgeKey === "c1:8:down")!;

    expect(resolveExpanderStep(tail)).toBeUndefined();
  });

  it("never calls an open tail a whole remainder", () => {
    const baseGaps = findExpansionGaps(base);
    const placed = placeExpandableEdges("c1", baseGaps, baseGaps, new Map());
    const tail = placed.find((edge) => edge.edgeKey === "c1:8:down")!;

    expect(resolveExpanderStep(tail)).toEqual({
      window: { from: 62, to: 81 },
      takesAll: false,
    });
  });
});

describe("buildExpansionKey", () => {
  it("names the chunk's own edges only", () => {
    const edges = new Map<string, EdgeExpansion>([
      ["c1:1:up", stubExpansion(10, 29)],
      ["c2:1:up", stubExpansion(1, 5)],
    ]);
    const stored = collectStoredEdges("c1", findExpansionGaps(base), edges);

    expect(buildExpansionKey(stored)).toBe("c1:1:up=10-29");
    expect(buildExpansionKey([])).toBeUndefined();
  });
});

describe("countExpandedRows", () => {
  const fileRows: DiffLine[] = [
    { kind: "hunk", content: "@@ -10,6 +10,3 @@" },
    { kind: "ctx", content: "keep", oldLine: 10, newLine: 10 },
    { kind: "del", content: "gone", oldLine: 11 },
    { kind: "del", content: "gone", oldLine: 12 },
    { kind: "del", content: "gone", oldLine: 13 },
    { kind: "ctx", content: "keep", oldLine: 14, newLine: 11 },
    { kind: "ctx", content: "keep", oldLine: 15, newLine: 12 },
    ...base,
  ];
  const edges = new Map<string, EdgeExpansion>([
    ["c1:1:up", stubExpansion(10, 29)],
    ["c2:1:up", stubExpansion(1, 5)],
  ]);

  it("counts the deletions a window brings, not only its lines", () => {
    expect(countExpandedRows(edges, "c1", base, fileRows, "unified")).toBe(23);
  });

  it("counts a deletion run beside the lines it precedes once in split", () => {
    expect(countExpandedRows(edges, "c1", base, fileRows, "split")).toBe(23);
  });

  it("falls back to the window's lines without the file's rows", () => {
    expect(countExpandedRows(edges, "c1", base, undefined, "unified")).toBe(20);
  });

  it("counts nothing for a chunk with no stored edge", () => {
    expect(countExpandedRows(edges, "c9", base, fileRows, "unified")).toBe(0);
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
    });
    const placed = placeExpandableEdges(
      "c1",
      baseGaps,
      findExpansionGaps(spliced),
      edges,
    );
    const edge = placed.find((candidate) => candidate.edgeKey === edgeKey)!;
    const step = resolveExpanderStep(edge)!;
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
    });
    const shown = rows
      .filter((row) => row.origin === "expanded")
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

describe("file end", () => {
  it("retires a trailing edge whose hole starts past the file end", () => {
    const edge = placeExpandableEdges(
      "c1",
      findExpansionGaps(TAIL_ONLY),
      findExpansionGaps(TAIL_ONLY),
      new Map(),
      3,
    ).find((candidate) => candidate.gap.to === undefined);

    expect(edge?.fileEnd).toBe(3);
    expect(edge && resolveExpanderStep(edge)).toBeUndefined();
  });

  it("clamps a trailing step to a file end a sibling read named", () => {
    const edge = placeExpandableEdges(
      "c1",
      findExpansionGaps(TAIL_ONLY),
      findExpansionGaps(TAIL_ONLY),
      new Map(),
      12,
    ).find((candidate) => candidate.gap.to === undefined);

    expect(edge && resolveExpanderStep(edge)).toEqual({
      window: { from: 4, to: 12 },
      takesAll: true,
    });
  });

  it("keeps a trailing edge that still has lines below it", () => {
    const edge = placeExpandableEdges(
      "c1",
      findExpansionGaps(TAIL_ONLY),
      findExpansionGaps(TAIL_ONLY),
      new Map(),
      40,
    ).find((candidate) => candidate.gap.to === undefined);

    expect(edge && resolveExpanderStep(edge)?.window).toEqual({
      from: 4,
      to: 23,
    });
  });
});

const TAIL_ONLY: DiffLine[] = [
  { kind: "hunk", content: "@@ -1,3 +1,3 @@" },
  { kind: "ctx", content: "a", oldLine: 1, newLine: 1 },
  { kind: "add", content: "b", newLine: 2 },
  { kind: "ctx", content: "c", oldLine: 2, newLine: 3 },
];
