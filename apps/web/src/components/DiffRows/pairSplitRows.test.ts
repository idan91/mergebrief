import { describe, expect, it } from "vitest";

import type { DiffLine } from "@web/utils/diffTokens/types";
import { countSplitRows, pairSplitRows } from "./pairSplitRows";

function makeDiff(): DiffLine[] {
  return [
    { kind: "hunk", content: "@@ -1,3 +1,4 @@" },
    { kind: "ctx", content: "keep", oldLine: 1, newLine: 1 },
    { kind: "del", content: "old a", oldLine: 2 },
    { kind: "del", content: "old b", oldLine: 3 },
    { kind: "add", content: "new a", newLine: 2 },
    { kind: "add", content: "new b", newLine: 3 },
    { kind: "add", content: "new c", newLine: 4 },
    { kind: "note", content: "truncated" },
  ];
}

describe("pairSplitRows", () => {
  it("spans hunk and note rows across both sides", () => {
    const rows = pairSplitRows(makeDiff());

    expect(rows[0]?.full?.index).toBe(0);
    expect(rows.at(-1)?.full?.index).toBe(7);
  });

  it("puts a context row on both sides with one index", () => {
    const rows = pairSplitRows(makeDiff());

    expect(rows[1]?.left?.index).toBe(1);
    expect(rows[1]?.right?.index).toBe(1);
  });

  it("zips a deletion run with the additions that follow it", () => {
    const rows = pairSplitRows(makeDiff());

    expect(rows[2]?.left?.index).toBe(2);
    expect(rows[2]?.right?.index).toBe(4);
    expect(rows[3]?.left?.index).toBe(3);
    expect(rows[3]?.right?.index).toBe(5);
  });

  it("leaves a filler where the longer side runs on", () => {
    const rows = pairSplitRows(makeDiff());

    expect(rows[4]?.left).toBeUndefined();
    expect(rows[4]?.right?.index).toBe(6);
  });

  it("renders an added-only chunk with an empty left side", () => {
    const rows = pairSplitRows([
      { kind: "add", content: "a", newLine: 1 },
      { kind: "add", content: "b", newLine: 2 },
    ]);

    expect(rows.every((row) => row.left === undefined)).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("keeps additions before a deletion on their own rows", () => {
    const rows = pairSplitRows([
      { kind: "add", content: "a", newLine: 1 },
      { kind: "del", content: "d", oldLine: 1 },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.right?.index).toBe(0);
    expect(rows[0]?.left).toBeUndefined();
    expect(rows[1]?.left?.index).toBe(1);
  });

  it("keys every row uniquely", () => {
    const keys = pairSplitRows(makeDiff()).map((row) => row.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts the rows the split view paints", () => {
    expect(countSplitRows(makeDiff())).toBe(6);
    expect(countSplitRows(makeDiff())).toBe(pairSplitRows(makeDiff()).length);
  });

  it("counts an add run that follows no deletion as its own rows", () => {
    const diff: DiffLine[] = [
      { kind: "add", content: "a", newLine: 1 },
      { kind: "ctx", content: "k", oldLine: 1, newLine: 2 },
      { kind: "del", content: "d", oldLine: 2 },
    ];

    expect(countSplitRows(diff)).toBe(pairSplitRows(diff).length);
  });
});

describe("pairSplitRows with expanded context", () => {
  it("sits expanded context on both sides like a context row", () => {
    const rows = pairSplitRows([
      {
        kind: "expanded-context",
        content: "read",
        oldLine: 9,
        newLine: 9,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.left).toBe(rows[0]?.right);
  });

  it("counts an expanded context row as one split row", () => {
    expect(
      countSplitRows([
        { kind: "expanded-context", content: "a", oldLine: 1, newLine: 1 },
        { kind: "expanded-context", content: "b", oldLine: 2, newLine: 2 },
      ]),
    ).toBe(2);
  });
});
