import { describe, expect, it } from "vitest";
import { buildPrSpan, BetweenHeadsKinds } from "../../../src/diff/pr-span";
import {
  filterBetweenHeadsHunks,
  NO_PR_CHANGE,
  type PrChangePlaces,
} from "../../../src/diff/pr-span/logic/filter-hunks";
import { parsePatchRows } from "../../../src/diff/patch-rows";
import { parseHunkSpans } from "../../../src/diff/remap";
import { parseChangedRanges } from "../../../src/diff/revchanges";
import { splitDiffByFile } from "../../../src/diff/file-diff";
import { readGitRevisionDiffs } from "./git-heads";
import { insertAfter, makeBaseLines, replaceLine } from "./helpers";

const FILE = "src/f.ts";
const HEADER = [
  `diff --git a/${FILE} b/${FILE}`,
  `--- a/${FILE}`,
  `+++ b/${FILE}`,
];

function makePatch(hunkLines: readonly string[]): string {
  return [...HEADER, ...hunkLines].join("\n");
}

function readHunks(patch: string | undefined): string[] {
  return (patch ?? "").split("\n").slice(HEADER.length);
}

/** PR change at the new head only: added lines at each listed new-head line. */
function placeAdded(...lines: number[]): PrChangePlaces {
  return {
    addedLines: lines.map((line) => ({ start: line, end: line })),
    deletionAnchors: [],
  };
}

describe("filterBetweenHeadsHunks cutting a kept hunk to its runs", () => {
  it("drops far base edits chained to a PR run through context", () => {
    const patch = makePatch([
      "@@ -7,16 +7,17 @@",
      " b7",
      " b8",
      " b9",
      "+p1",
      " b10",
      " b11",
      " b12",
      " b13",
      "-b14",
      "+b14x",
      " b15",
      " b16",
      " b17",
      " b18",
      "-b19",
      "+b19x",
      " b20",
      " b21",
      " b22",
    ]);

    const cut = filterBetweenHeadsHunks(patch, NO_PR_CHANGE, placeAdded(10));

    expect(readHunks(cut)).toEqual([
      "@@ -7,6 +7,7 @@",
      " b7",
      " b8",
      " b9",
      "+p1",
      " b10",
      " b11",
      " b12",
    ]);
  });

  it("splits around a dropped run and shifts the next hunk past it", () => {
    const patch = makePatch([
      "@@ -5,9 +5,12 @@",
      " b5",
      " b6",
      " b7",
      "+p1",
      " b8",
      "-b9",
      "+b9x",
      "+b9y",
      " b10",
      "+p2",
      " b11",
      " b12",
      " b13",
    ]);

    const cut = filterBetweenHeadsHunks(patch, NO_PR_CHANGE, placeAdded(8, 13));

    expect(readHunks(cut)).toEqual([
      "@@ -5,4 +5,5 @@",
      " b5",
      " b6",
      " b7",
      "+p1",
      " b8",
      "@@ -10,4 +12,5 @@",
      " b10",
      "+p2",
      " b11",
      " b12",
      " b13",
    ]);
  });

  it("stops the context before a dropped run at the hunk's edge", () => {
    const patch = makePatch([
      "@@ -1,8 +1,9 @@",
      " b1",
      " b2",
      "-b3",
      "+b3x",
      " b4",
      " b5",
      "+p1",
      " b6",
      " b7",
      " b8",
    ]);

    const cut = filterBetweenHeadsHunks(patch, NO_PR_CHANGE, placeAdded(6));

    expect(readHunks(cut)).toEqual([
      "@@ -4,5 +4,6 @@",
      " b4",
      " b5",
      "+p1",
      " b6",
      " b7",
      " b8",
    ]);
  });

  it("keeps a run at line 1 and one at a missing final newline", () => {
    const patch = makePatch([
      "@@ -1,12 +1,14 @@",
      "+p0",
      " b1",
      " b2",
      " b3",
      " b4",
      "-b5",
      "+b5x",
      " b6",
      " b7",
      " b8",
      " b9",
      " b10",
      " b11",
      "-b12",
      "\\ No newline at end of file",
      "+b12",
      "+p1",
      "\\ No newline at end of file",
    ]);

    const cut = filterBetweenHeadsHunks(
      patch,
      NO_PR_CHANGE,
      placeAdded(1, 13, 14),
    );

    expect(readHunks(cut)).toEqual([
      "@@ -1,3 +1,4 @@",
      "+p0",
      " b1",
      " b2",
      " b3",
      "@@ -9,4 +10,5 @@",
      " b9",
      " b10",
      " b11",
      "-b12",
      "\\ No newline at end of file",
      "+b12",
      "+p1",
      "\\ No newline at end of file",
    ]);
  });

  it("writes git's zero-line starts for a whole-file add and delete", () => {
    const added = makePatch(["@@ -0,0 +1,2 @@", "+p1", "+p2"]);
    const deleted = makePatch(["@@ -1,2 +0,0 @@", "-p1", "-p2"]);
    const prevPlaces: PrChangePlaces = {
      addedLines: [{ start: 1, end: 2 }],
      deletionAnchors: [],
    };

    expect(
      readHunks(filterBetweenHeadsHunks(added, NO_PR_CHANGE, placeAdded(1, 2))),
    ).toEqual(["@@ -0,0 +1,2 @@", "+p1", "+p2"]);
    expect(
      readHunks(filterBetweenHeadsHunks(deleted, prevPlaces, NO_PR_CHANGE)),
    ).toEqual(["@@ -1,2 +0,0 @@", "-p1", "-p2"]);
  });

  it.each([
    { gap: 6, hunkCount: 1 },
    { gap: 7, hunkCount: 2 },
  ])(
    "merges two kept runs $gap context lines apart into $hunkCount",
    ({ gap, hunkCount }) => {
      const between = Array.from(
        { length: gap },
        (_unused, index) => ` c${index + 1}`,
      );
      const patch = makePatch([
        `@@ -1,${gap + 6} +1,${gap + 8} @@`,
        " a1",
        " a2",
        " a3",
        "+p1",
        ...between,
        "+p2",
        " z1",
        " z2",
        " z3",
      ]);

      const cut = filterBetweenHeadsHunks(
        patch,
        NO_PR_CHANGE,
        placeAdded(4, gap + 5),
      );
      const headers = readHunks(cut).filter((line) => line.startsWith("@@"));

      expect(headers).toHaveLength(hunkCount);
    },
  );

  it("round-trips through the readers to exactly the kept runs", () => {
    const patch = makePatch([
      "@@ -5,9 +5,12 @@",
      " b5",
      " b6",
      " b7",
      "+p1",
      " b8",
      "-b9",
      "+b9x",
      "+b9y",
      " b10",
      "+p2",
      " b11",
      " b12",
      " b13",
    ]);

    const cut =
      filterBetweenHeadsHunks(patch, NO_PR_CHANGE, placeAdded(8, 13)) ?? "";
    const [file] = splitDiffByFile(cut);
    const rows = parsePatchRows(file?.patch ?? "");

    expect(rows.find((row) => row.content === "b10")).toMatchObject({
      oldLine: 10,
      newLine: 12,
    });
    expect(parseChangedRanges(cut)).toEqual([
      {
        file: FILE,
        addedRanges: [
          { start: 8, end: 8 },
          { start: 13, end: 13 },
        ],
        removedRanges: [],
      },
    ]);
  });
});

describe("buildPrSpan over git's chained hunk", () => {
  it("sends only the PR run when far base edits share its hunk", () => {
    const base = makeBaseLines(40);
    const prevHead = insertAfter(base, "b35", ["p0"]);
    const newBase = replaceLine(replaceLine(base, "b14", ["b14x"]), "b19", [
      "b19x",
    ]);
    const newHead = insertAfter(insertAfter(newBase, "b35", ["p0"]), "b9", [
      "p1",
    ]);
    const diffs = readGitRevisionDiffs(FILE, {
      prevBase: base,
      prevHead,
      newBase,
      newHead,
    });

    const span = buildPrSpan({
      prevPrDiff: diffs.prevPrDiff,
      newPrDiff: diffs.newPrDiff,
      betweenHeads: new Map([
        [
          FILE,
          { kind: BetweenHeadsKinds.PATCH, patch: diffs.betweenHeadsPatch },
        ],
      ]),
    });

    expect(span.unfilteredDiff).toContain("+b14x");
    expect(span.hop).toEqual([
      { file: FILE, hunks: parseHunkSpans(diffs.betweenHeadsPatch) },
    ]);
    expect(parseChangedRanges(span.filteredDiff)).toEqual([
      { file: FILE, addedRanges: [{ start: 10, end: 10 }], removedRanges: [] },
    ]);
  });
});
