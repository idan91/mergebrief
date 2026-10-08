import { describe, expect, it } from "vitest";

import { mapTokensToRows } from "./mapTokensToRows";
import { type HunkSide, type RowTokenLine } from "./types";
import { DiffSides, type DiffSide } from "types/comments";

function stubSide(
  side: DiffSide,
  text: string[],
  rowIndexes: number[],
): HunkSide {
  return { side, text, rowIndexes };
}

function makeLine(...texts: string[]): RowTokenLine {
  return texts.map((text, classId) => ({ text, classId }));
}

describe("mapTokensToRows", () => {
  it("keys each tokenized line by the diff row it came from", () => {
    const side = stubSide(DiffSides.NEW, ["a", "b"], [3, 5]);
    const lines = [makeLine("a"), makeLine("b")];

    const byRow = mapTokensToRows([side], [lines]);

    expect([...byRow.keys()]).toEqual([3, 5]);
    expect(byRow.get(5)).toEqual(makeLine("b"));
  });

  it("lets the new side win a context row present on both sides", () => {
    const old = stubSide(DiffSides.OLD, ["ctx"], [1]);
    const next = stubSide(DiffSides.NEW, ["ctx"], [1]);
    const oldTokens = [[{ text: "ctx", classId: 1 }]];
    const newTokens = [[{ text: "ctx", classId: 2 }]];

    const byRow = mapTokensToRows([old, next], [oldTokens, newTokens]);

    expect(byRow.get(1)).toEqual(newTokens[0]);
  });

  it("drops a line whose tokens do not spell the row's text", () => {
    const side = stubSide(DiffSides.NEW, ["const a", "b"], [0, 1]);
    const lines = [makeLine("const", " a"), makeLine("shifted")];

    const byRow = mapTokensToRows([side], [lines]);

    expect(byRow.get(0)).toEqual(makeLine("const", " a"));
    expect(byRow.has(1)).toBe(false);
  });

  it("skips a row whose side has no tokenized line", () => {
    const side = stubSide(DiffSides.NEW, ["a", "b"], [0, 1]);

    const byRow = mapTokensToRows([side], [[makeLine("a")]]);

    expect(byRow.has(1)).toBe(false);
  });

  it("returns an empty map when no sides were tokenized", () => {
    const side = stubSide(DiffSides.OLD, ["a"], [0]);

    expect(mapTokensToRows([side], []).size).toBe(0);
  });
});
