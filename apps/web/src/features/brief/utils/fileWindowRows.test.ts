import { type DiffLine, DiffLineKinds } from "@web/utils/diffTokens/types";
import { describe, expect, it } from "vitest";

import {
  collectWindowRows,
  countWindowRows,
  isWindowCovered,
} from "./fileWindowRows";

// Three deletions in the first hunk put old numbers three ahead of new.
const FILE_ROWS: DiffLine[] = [
  { kind: "hunk", content: "@@ -10,6 +10,3 @@" },
  { kind: "ctx", content: "keep 10", oldLine: 10, newLine: 10 },
  { kind: "del", content: "gone 11", oldLine: 11 },
  { kind: "del", content: "gone 12", oldLine: 12 },
  { kind: "del", content: "gone 13", oldLine: 13 },
  { kind: "ctx", content: "keep 14", oldLine: 14, newLine: 11 },
  { kind: "ctx", content: "keep 15", oldLine: 15, newLine: 12 },
  { kind: "hunk", content: "@@ -33,3 +30,3 @@" },
  { kind: "ctx", content: "a", oldLine: 33, newLine: 30 },
  { kind: "del", content: "b", oldLine: 34 },
  { kind: "add", content: "c", newLine: 31 },
  { kind: "ctx", content: "d", oldLine: 35, newLine: 32 },
];

function stubRange(from: number, to: number) {
  const lines: string[] = [];
  for (let line = from; line <= to; line += 1) lines.push(`L${String(line)}`);
  return { from, to, lines };
}

describe("collectWindowRows", () => {
  it("takes a hunk's real rows with the diff's own numbers", () => {
    const rows = collectWindowRows({
      fileRows: FILE_ROWS,
      window: { from: 10, to: 12 },
      holeStart: 1,
      base: [],
      range: stubRange(10, 12),
    });

    expect(rows).toEqual([
      {
        kind: "ctx",
        content: "keep 10",
        oldLine: 10,
        newLine: 10,
        origin: "expanded",
      },
      { kind: "del", content: "gone 11", oldLine: 11, origin: "expanded" },
      { kind: "del", content: "gone 12", oldLine: 12, origin: "expanded" },
      { kind: "del", content: "gone 13", oldLine: 13, origin: "expanded" },
      {
        kind: "ctx",
        content: "keep 14",
        oldLine: 14,
        newLine: 11,
        origin: "expanded",
      },
      {
        kind: "ctx",
        content: "keep 15",
        oldLine: 15,
        newLine: 12,
        origin: "expanded",
      },
    ]);
  });

  it("fills lines no hunk covers from the range, numbered by the hunk trail", () => {
    const rows = collectWindowRows({
      fileRows: FILE_ROWS,
      window: { from: 8, to: 14 },
      holeStart: 1,
      base: [],
      range: stubRange(8, 14),
    });

    expect(rows.map((row) => [row.kind, row.oldLine, row.newLine])).toEqual([
      ["ctx", 8, 8],
      ["ctx", 9, 9],
      ["ctx", 10, 10],
      ["del", 11, undefined],
      ["del", 12, undefined],
      ["del", 13, undefined],
      ["ctx", 14, 11],
      ["ctx", 15, 12],
      ["ctx", 16, 13],
      ["ctx", 17, 14],
    ]);
    expect(rows[0]).toMatchObject({ content: "L8", origin: "expanded" });
    expect(rows.at(-1)).toMatchObject({ content: "L14", origin: "expanded" });
  });

  it("keeps a deletion whose anchor line sits just above the hole's top", () => {
    const rows = collectWindowRows({
      fileRows: FILE_ROWS,
      window: { from: 11, to: 12 },
      holeStart: 11,
      base: [],
      range: stubRange(11, 12),
    });

    expect(rows.map((row) => [row.kind, row.oldLine])).toEqual([
      ["del", 11],
      ["del", 12],
      ["del", 13],
      ["ctx", 14],
      ["ctx", 15],
    ]);
  });

  it("leaves a deletion above the window out when the hole starts lower", () => {
    const rows = collectWindowRows({
      fileRows: FILE_ROWS,
      window: { from: 11, to: 12 },
      holeStart: 5,
      base: [],
      range: stubRange(11, 12),
    });

    expect(rows.map((row) => row.kind)).toEqual(["ctx", "ctx"]);
  });

  it("never repeats a deletion the chunk already carries", () => {
    const rows = collectWindowRows({
      fileRows: FILE_ROWS,
      window: { from: 10, to: 12 },
      holeStart: 1,
      base: [{ kind: DiffLineKinds.DEL, content: "gone 12", oldLine: 12 }],
      range: stubRange(10, 12),
    });

    expect(
      rows.filter((row) => row.kind === "del").map((row) => row.oldLine),
    ).toEqual([11, 13]);
  });

  it("skips a range line the read did not deliver", () => {
    const rows = collectWindowRows({
      fileRows: FILE_ROWS,
      window: { from: 40, to: 42 },
      holeStart: 33,
      base: [],
      range: { from: 40, to: 41, lines: ["L40", "L41"] },
    });

    expect(rows.map((row) => [row.oldLine, row.newLine])).toEqual([
      [43, 40],
      [44, 41],
    ]);
  });
});

describe("isWindowCovered", () => {
  it("is true when every line of the window has a row in the file diff", () => {
    expect(isWindowCovered(FILE_ROWS, { from: 10, to: 12 })).toBe(true);
    expect(isWindowCovered(FILE_ROWS, { from: 30, to: 32 })).toBe(true);
  });

  it("is false when any line falls between hunks", () => {
    expect(isWindowCovered(FILE_ROWS, { from: 12, to: 13 })).toBe(false);
    expect(isWindowCovered(FILE_ROWS, { from: 40, to: 41 })).toBe(false);
  });
});

describe("countWindowRows", () => {
  const params = {
    fileRows: FILE_ROWS,
    window: { from: 8, to: 14 },
    holeStart: 1,
    base: [],
  };

  it("counts what collectWindowRows would build, unified", () => {
    expect(countWindowRows(params, "unified")).toBe(10);
  });

  it("pairs a deletion run with the addition run after it in split", () => {
    const window = { from: 30, to: 32 };
    const built = collectWindowRows({
      ...params,
      window,
      range: stubRange(30, 32),
    });

    expect(built.map((row) => row.kind)).toEqual(["ctx", "del", "add", "ctx"]);
    expect(countWindowRows({ ...params, window }, "split")).toBe(3);
    expect(countWindowRows({ ...params, window }, "unified")).toBe(4);
  });
});
