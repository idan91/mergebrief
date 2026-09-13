import { describe, expect, it } from "vitest";

import { mapTokensToRows } from "./mapTokensToRows";
import {
  HunkSideNames,
  type HunkSide,
  type HunkSideName,
  type RowTokenLine,
} from "./types";

function stubSide(
  side: HunkSideName,
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
    const side = stubSide(HunkSideNames.NEW, ["a", "b"], [3, 5]);
    const lines = [makeLine("a"), makeLine("b")];

    const byRow = mapTokensToRows([side], [lines]);

    expect([...byRow.keys()]).toEqual([3, 5]);
    expect(byRow.get(5)).toEqual(makeLine("b"));
  });

  it("lets the new side win a context row present on both sides", () => {
    const old = stubSide(HunkSideNames.OLD, ["ctx"], [1]);
    const next = stubSide(HunkSideNames.NEW, ["ctx"], [1]);

    const byRow = mapTokensToRows(
      [old, next],
      [[makeLine("old")], [makeLine("new")]],
    );

    expect(byRow.get(1)).toEqual(makeLine("new"));
  });

  it("skips a row whose side has no tokenized line", () => {
    const side = stubSide(HunkSideNames.NEW, ["a", "b"], [0, 1]);

    const byRow = mapTokensToRows([side], [[makeLine("a")]]);

    expect(byRow.has(1)).toBe(false);
  });

  it("returns an empty map when no sides were tokenized", () => {
    const side = stubSide(HunkSideNames.OLD, ["a"], [0]);

    expect(mapTokensToRows([side], []).size).toBe(0);
  });
});
