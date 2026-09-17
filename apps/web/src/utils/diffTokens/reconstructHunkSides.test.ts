import { describe, expect, it } from "vitest";

import { reconstructHunkSides } from "./reconstructHunkSides";
import { DiffLineKinds, DiffRowOrigins, type DiffLine } from "./types";

function makeRow(kind: DiffLine["kind"], content: string): DiffLine {
  return { kind, content };
}

describe("reconstructHunkSides", () => {
  it("sends del and ctx to the old side and add and ctx to the new", () => {
    const sides = reconstructHunkSides([
      makeRow(DiffLineKinds.CTX, "const a = 1;"),
      makeRow(DiffLineKinds.DEL, "drop(a);"),
      makeRow(DiffLineKinds.ADD, "keep(a);"),
    ]);

    expect(sides).toEqual([
      {
        side: "old",
        text: ["const a = 1;", "drop(a);"],
        rowIndexes: [0, 1],
      },
      {
        side: "new",
        text: ["const a = 1;", "keep(a);"],
        rowIndexes: [0, 2],
      },
    ]);
  });

  it("starts a fresh pair of sides at every hunk header row", () => {
    const sides = reconstructHunkSides([
      makeRow(DiffLineKinds.HUNK, "@@ -1 +1 @@"),
      makeRow(DiffLineKinds.ADD, "one();"),
      makeRow(DiffLineKinds.HUNK, "@@ -9 +9 @@"),
      makeRow(DiffLineKinds.ADD, "two();"),
    ]);

    expect(sides.map((side) => side.text)).toEqual([["one();"], ["two();"]]);
    expect(sides.map((side) => side.rowIndexes)).toEqual([[1], [3]]);
  });

  it("flushes at a note row and drops sides that gathered no text", () => {
    const sides = reconstructHunkSides([
      makeRow(DiffLineKinds.DEL, "gone();"),
      makeRow(DiffLineKinds.NOTE, "truncated"),
      makeRow(DiffLineKinds.ADD, "fresh();"),
    ]);

    expect(sides).toHaveLength(2);
    expect(sides[0]?.side).toBe("old");
    expect(sides[1]?.side).toBe("new");
  });

  it("stamps each side with the file line its first row sits on", () => {
    const sides = reconstructHunkSides([
      { kind: "hunk", content: "@@ -0,0 +1,2 @@" },
      { kind: "add", content: "a", newLine: 1 },
      { kind: "add", content: "b", newLine: 2 },
    ]);

    expect(sides.map((side) => [side.side, side.startLine])).toEqual([
      ["new", 1],
    ]);
  });

  it("starts a fresh pair where file lines are missing between rows", () => {
    const sides = reconstructHunkSides([
      { kind: "ctx", content: "/**", oldLine: 14, newLine: 13 },
      { kind: "del", content: " * old", oldLine: 15 },
      { kind: "add", content: " * new", newLine: 14 },
      { kind: "ctx", content: "  inputs,", oldLine: 23, newLine: 22 },
      { kind: "del", content: "  const cap =", oldLine: 24 },
    ]);

    expect(sides.map((side) => [side.side, side.startLine, side.text])).toEqual(
      [
        ["old", 14, ["/**", " * old"]],
        ["new", 13, ["/**", " * new"]],
        ["old", 23, ["  inputs,", "  const cap ="]],
        ["new", 22, ["  inputs,"]],
      ],
    );
    expect(sides.map((side) => side.rowIndexes)).toEqual([
      [0, 1],
      [0, 2],
      [3, 4],
      [3],
    ]);
  });

  it("keeps one pair while a del run and an add run stay contiguous", () => {
    const sides = reconstructHunkSides([
      { kind: "ctx", content: "a", oldLine: 10, newLine: 10 },
      { kind: "del", content: "b", oldLine: 11 },
      { kind: "del", content: "c", oldLine: 12 },
      { kind: "add", content: "d", newLine: 11 },
      { kind: "ctx", content: "e", oldLine: 13, newLine: 12 },
    ]);

    expect(sides.map((side) => side.text)).toEqual([
      ["a", "b", "c", "e"],
      ["a", "d", "e"],
    ]);
  });

  it("returns no sides for rows that carry no code", () => {
    expect(reconstructHunkSides([])).toEqual([]);
    expect(reconstructHunkSides([makeRow(DiffLineKinds.HUNK, "@@")])).toEqual(
      [],
    );
  });
});

describe("reconstructHunkSides with expanded context", () => {
  it("sends expanded context to both sides like a context row", () => {
    const sides = reconstructHunkSides([
      {
        ...makeRow(DiffLineKinds.CTX, "const a = 1;"),
        origin: DiffRowOrigins.EXPANDED,
      },
      makeRow(DiffLineKinds.ADD, "keep(a);"),
    ]);

    expect(sides).toEqual([
      { side: "old", text: ["const a = 1;"], rowIndexes: [0] },
      { side: "new", text: ["const a = 1;", "keep(a);"], rowIndexes: [0, 1] },
    ]);
  });
});
