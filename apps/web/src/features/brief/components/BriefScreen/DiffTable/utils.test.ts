import { describe, expect, it } from "vitest";

import type { DiffLine } from "@web/utils/diffTokens/types";
import { pairSplitRows } from "@web/components/DiffRows/pairSplitRows";
import type { SiblingSpan } from "../../../utils/siblingSpans";
import {
  frameSpans,
  frameSpansOnPairs,
  resolveSpanLines,
  unzipPairsByOwner,
} from "./utils";

const ROWS: DiffLine[] = [
  { kind: "ctx", origin: "expanded", content: "k", oldLine: 9, newLine: 9 },
  { kind: "del", origin: "expanded", content: "x1", oldLine: 10 },
  { kind: "del", origin: "expanded", content: "x2", oldLine: 11 },
  { kind: "add", origin: "expanded", content: "y1", newLine: 10 },
  { kind: "add", origin: "expanded", content: "y2", newLine: 11 },
  { kind: "ctx", content: "own", oldLine: 12, newLine: 12 },
];
const SPANS: SiblingSpan[] = [
  { start: 1, end: 2, owner: "x" },
  { start: 3, end: 4, owner: "y" },
];

describe("frameSpans", () => {
  it("frames a unified span on its own rows", () => {
    expect(frameSpans(SPANS)).toEqual([
      { owner: "x", headerAt: 1, endAt: 2, rows: [1, 2] },
      { owner: "y", headerAt: 3, endAt: 4, rows: [3, 4] },
    ]);
  });
});

describe("frameSpansOnPairs", () => {
  it("leaves a pair that straddles two owners unframed", () => {
    const pairs = pairSplitRows(ROWS);

    expect(frameSpansOnPairs(SPANS, pairs)).toEqual([]);
  });

  it("frames the pairs whose two cells share the owner, once per pair", () => {
    const rows: DiffLine[] = [
      { kind: "del", origin: "expanded", content: "x1", oldLine: 10 },
      { kind: "add", origin: "expanded", content: "x2", newLine: 10 },
      { kind: "add", origin: "expanded", content: "x3", newLine: 11 },
      { kind: "ctx", content: "own", oldLine: 11, newLine: 12 },
    ];
    const spans: SiblingSpan[] = [{ start: 0, end: 2, owner: "x" }];

    expect(frameSpansOnPairs(spans, pairSplitRows(rows))).toEqual([
      { owner: "x", headerAt: 0, endAt: 2, rows: [0, 1, 2] },
    ]);
  });

  it("closes a frame at the pair where the owner changes", () => {
    const rows: DiffLine[] = [
      { kind: "add", origin: "expanded", content: "x1", newLine: 10 },
      { kind: "del", origin: "expanded", content: "x2", oldLine: 11 },
      { kind: "add", origin: "expanded", content: "y1", newLine: 11 },
      { kind: "add", origin: "expanded", content: "y2", newLine: 12 },
    ];
    const spans: SiblingSpan[] = [
      { start: 0, end: 0, owner: "x" },
      { start: 1, end: 1, owner: "x" },
      { start: 2, end: 3, owner: "y" },
    ];

    expect(frameSpansOnPairs(spans, pairSplitRows(rows))).toEqual([
      { owner: "x", headerAt: 0, endAt: 0, rows: [0] },
      { owner: "y", headerAt: 3, endAt: 3, rows: [3] },
    ]);
  });
});

describe("resolveSpanLines", () => {
  it("reads the new side of the changed rows and skips context", () => {
    const rows: DiffLine[] = [
      { kind: "del", origin: "expanded", content: "x", oldLine: 20 },
      {
        kind: "ctx",
        origin: "expanded",
        content: "k",
        oldLine: 21,
        newLine: 19,
      },
      { kind: "add", origin: "expanded", content: "y", newLine: 20 },
      { kind: "add", origin: "expanded", content: "y", newLine: 21 },
    ];

    expect(resolveSpanLines(rows, [0, 1, 2, 3])).toEqual({
      side: "new",
      from: 20,
      to: 21,
    });
  });

  it("reads the old side when the span only deletes", () => {
    const rows: DiffLine[] = [
      { kind: "del", origin: "expanded", content: "x", oldLine: 20 },
      {
        kind: "ctx",
        origin: "expanded",
        content: "k",
        oldLine: 21,
        newLine: 19,
      },
      { kind: "del", origin: "expanded", content: "x", oldLine: 22 },
    ];

    expect(resolveSpanLines(rows, [0, 1, 2])).toEqual({
      side: "old",
      from: 20,
      to: 22,
    });
  });
});

describe("unzipPairsByOwner", () => {
  const owners: Record<number, string> = { 1: "x", 2: "x", 3: "y", 4: "y" };

  it("splits a pair whose sides belong to different owners", () => {
    const pairs = unzipPairsByOwner(
      pairSplitRows(ROWS),
      (index) => owners[index],
    );

    expect(pairs.map((pair) => [pair.left?.index, pair.right?.index])).toEqual([
      [0, 0],
      [1, undefined],
      [2, undefined],
      [undefined, 3],
      [undefined, 4],
      [5, 5],
    ]);
    expect(new Set(pairs.map((pair) => pair.key)).size).toBe(pairs.length);
  });

  it("keeps a pair the chunk's own rows or one owner share", () => {
    const pairs = unzipPairsByOwner(pairSplitRows(ROWS), () => undefined);

    expect(pairs).toHaveLength(4);
  });
});
