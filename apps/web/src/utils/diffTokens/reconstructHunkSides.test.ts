import { describe, expect, it } from "vitest";

import { reconstructHunkSides } from "./reconstructHunkSides";
import { DiffLineKinds, type DiffLine } from "./types";

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

  it("returns no sides for rows that carry no code", () => {
    expect(reconstructHunkSides([])).toEqual([]);
    expect(reconstructHunkSides([makeRow(DiffLineKinds.HUNK, "@@")])).toEqual(
      [],
    );
  });
});
