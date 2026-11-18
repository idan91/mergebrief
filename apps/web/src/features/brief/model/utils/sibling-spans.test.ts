import type { DiffLine } from "@web/utils/diffTokens/types";
import { describe, expect, it } from "vitest";

import { groupSiblingSpans } from "./sibling-spans";

const OWNERS: Record<number, string> = {
  20: "c2",
  21: "c2",
  22: "c2",
  30: "u-1",
};
const OLD_OWNERS: Record<number, string> = { 20: "c2", 29: "u-1" };

function readOwner(line: DiffLine): string | undefined {
  if (line.kind === "del") {
    return line.oldLine === undefined ? undefined : OLD_OWNERS[line.oldLine];
  }
  return line.newLine === undefined ? undefined : OWNERS[line.newLine];
}

const ROWS: DiffLine[] = [
  { kind: "hunk", content: "@@" },
  { kind: "ctx", origin: "expanded", content: "k", oldLine: 19, newLine: 19 },
  { kind: "del", origin: "expanded", content: "gone", oldLine: 20 },
  { kind: "add", origin: "expanded", content: "a", newLine: 20 },
  { kind: "ctx", origin: "expanded", content: "k", oldLine: 21, newLine: 21 },
  { kind: "add", origin: "expanded", content: "b", newLine: 22 },
  { kind: "ctx", origin: "expanded", content: "k", oldLine: 22, newLine: 23 },
  { kind: "ctx", origin: "expanded", content: "k", oldLine: 28, newLine: 29 },
  { kind: "del", origin: "expanded", content: "gone", oldLine: 29 },
  { kind: "add", origin: "expanded", content: "c", newLine: 30 },
  { kind: "ctx", content: "base", oldLine: 30, newLine: 31 },
  { kind: "add", content: "own", newLine: 32 },
];

describe("groupSiblingSpans", () => {
  it("frames each run of expanded changed rows by owner, context inside", () => {
    expect(groupSiblingSpans(ROWS, readOwner)).toEqual([
      { start: 2, end: 5, owner: "c2" },
      { start: 8, end: 9, owner: "u-1" },
    ]);
  });

  it("never frames the chunk's own rows", () => {
    expect(groupSiblingSpans(ROWS.slice(10), readOwner)).toEqual([]);
  });

  it("splits two owners that touch into two spans", () => {
    const rows: DiffLine[] = [
      { kind: "add", origin: "expanded", content: "a", newLine: 20 },
      { kind: "add", origin: "expanded", content: "c", newLine: 30 },
    ];

    expect(groupSiblingSpans(rows, readOwner)).toEqual([
      { start: 0, end: 0, owner: "c2" },
      { start: 1, end: 1, owner: "u-1" },
    ]);
  });
});
