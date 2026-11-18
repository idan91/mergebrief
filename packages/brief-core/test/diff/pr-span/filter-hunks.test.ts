import { describe, expect, it } from "vitest";
import {
  BetweenHeadsKinds,
  buildPrSpan,
  readPrSpan,
  type PrSpan,
  type PrSpanRefs,
} from "../../../src/diff/pr-span";
import {
  filterBetweenHeadsHunks,
  NO_PR_CHANGE,
  type PrChangePlaces,
} from "../../../src/diff/pr-span/logic/filter-hunks";
import { formatBetweenHeadsPatch } from "../../../src/diff/pr-span/logic/line-diff";
import { parseChangedRanges } from "../../../src/diff/revchanges";
import {
  insertAfter,
  makeBaseLines,
  makeBlobId,
  makeDiff,
  makeFilePatch,
  makeText,
  replaceLine,
  stubSource,
} from "./helpers";

const FILE = "src/f.ts";
const REFS: PrSpanRefs = {
  prevBase: "base1",
  prevHead: "head1",
  newBase: "base2",
  newHead: "head2",
};

const prevHeadText = makeText([
  "x1",
  "x2",
  "x3",
  "a",
  "}",
  "}",
  "b",
  "y1",
  "y2",
  "y3",
]);
const newHeadText = makeText([
  "x1",
  "x2",
  "x3",
  "a",
  "}",
  "}",
  "}",
  "b",
  "y1",
  "y2",
  "y3",
  "p9",
]);

/** The new head's PR patch as a differ may write it: the added `}` placed first of the three. */
const newPrPatch = [
  `diff --git a/${FILE} b/${FILE}`,
  `index ${makeBlobId(prevHeadText)}..${makeBlobId(newHeadText)} 100644`,
  `--- a/${FILE}`,
  `+++ b/${FILE}`,
  "@@ -2,9 +2,11 @@",
  " x2",
  " x3",
  " a",
  "+}",
  " }",
  " }",
  " b",
  " y1",
  " y2",
  " y3",
  "+p9",
].join("\n");

/** The deletion mirror: the new head drops one of three `}` lines, and the PR patch names the first. */
const prevHeadDeletionText = makeText([
  "x1",
  "x2",
  "x3",
  "a",
  "}",
  "}",
  "}",
  "b",
  "y1",
  "y2",
  "y3",
]);
const newHeadDeletionText = makeText([
  "x1",
  "x2",
  "x3",
  "a",
  "}",
  "}",
  "b",
  "y1",
  "y2",
  "y3",
  "p9",
]);
const newPrDeletionPatch = [
  `diff --git a/${FILE} b/${FILE}`,
  `index ${makeBlobId(prevHeadDeletionText)}..${makeBlobId(newHeadDeletionText)} 100644`,
  `--- a/${FILE}`,
  `+++ b/${FILE}`,
  "@@ -2,10 +2,10 @@",
  " x2",
  " x3",
  " a",
  "-}",
  " }",
  " }",
  " b",
  " y1",
  " y2",
  " y3",
  "+p9",
].join("\n");

async function readSpan(
  diffs: Record<string, string>,
  blobs: Record<string, string>,
): Promise<PrSpan | undefined> {
  const source = stubSource({
    diffs: Object.fromEntries(
      Object.entries(diffs).map(([key, value]) => [key, { ok: true, value }]),
    ),
    blobs,
  });
  const result = await readPrSpan(source, REFS, new AbortController().signal);
  return result.ok ? result.value : undefined;
}

describe("filterBetweenHeadsHunks on a run that can slide", () => {
  it("keeps a PR run the line diff placed two lines off among equal lines", async () => {
    const span = await readSpan(
      { "base1..head1": "", "base2..head2": makeDiff([newPrPatch]) },
      { [`head1:${FILE}`]: prevHeadText, [`head2:${FILE}`]: newHeadText },
    );

    expect(parseChangedRanges(span?.filteredDiff ?? "")).toEqual([
      {
        file: FILE,
        addedRanges: [
          { start: 7, end: 7 },
          { start: 12, end: 12 },
        ],
        removedRanges: [],
      },
    ]);
  });

  it("keeps a PR deletion placed two lines off among equal lines", async () => {
    const span = await readSpan(
      { "base1..head1": "", "base2..head2": makeDiff([newPrDeletionPatch]) },
      {
        [`head1:${FILE}`]: prevHeadDeletionText,
        [`head2:${FILE}`]: newHeadDeletionText,
      },
    );

    expect(parseChangedRanges(span?.filteredDiff ?? "")).toEqual([
      {
        file: FILE,
        addedRanges: [{ start: 11, end: 11 }],
        removedRanges: [{ start: 7, end: 7 }],
      },
    ]);
  });

  it("still drops a base run two lines from a PR run that cannot slide", async () => {
    const base = makeBaseLines(20);
    const newBase = replaceLine(base, "b8", ["b8x"]);
    const prevHead = insertAfter(base, "b5", ["p1"]);
    const newHead = insertAfter(newBase, "b5", ["p1x"]);
    const makePrPatch = (
      from: readonly string[],
      to: readonly string[],
    ): string =>
      makeDiff([
        makeFilePatch({ path: FILE, base: makeText(from), head: makeText(to) }),
      ]);

    const span = await readSpan(
      {
        "base1..head1": makePrPatch(base, prevHead),
        "base2..head2": makePrPatch(newBase, newHead),
      },
      {
        [`head1:${FILE}`]: makeText(prevHead),
        [`head2:${FILE}`]: makeText(newHead),
      },
    );

    expect(span?.filteredDiff).toContain("+p1x");
    expect(span?.filteredDiff).not.toContain("b8x");
  });

  it("drops the misplaced run when no blob text came with the patch", () => {
    const patch = formatBetweenHeadsPatch({
      prevPath: FILE,
      path: FILE,
      prevContent: prevHeadText,
      newContent: newHeadText,
    });

    const span = buildPrSpan({
      prevPrDiff: "",
      newPrDiff: makeDiff([newPrPatch]),
      betweenHeads: new Map([
        [FILE, { kind: BetweenHeadsKinds.PATCH, patch: patch ?? "" }],
      ]),
    });

    expect(parseChangedRanges(span.filteredDiff)).toEqual([
      { file: FILE, addedRanges: [{ start: 12, end: 12 }], removedRanges: [] },
    ]);
  });
});

const DISTINCT_LINES = 6_000;
const BLANK_LINES = 90_000;
const FAR_PLACES = 20_000;
/** The first line of the blank region, where an inserted blank line can slide to. */
const SLIDE_TOP = DISTINCT_LINES + 1;

/** Distinct lines, then a long run of blank ones: a blank line added or dropped at the end can slide over all of them. */
function makeUniformRegionTexts(blankCount: number): string {
  const distinct = Array.from(
    { length: DISTINCT_LINES },
    (_unused, index) => `d${index + 1}`,
  );
  return makeText([...distinct, ...Array<string>(blankCount).fill("")]);
}

/** Many PR change places, every one well above the blank region. */
function makeFarPlaces(): PrChangePlaces {
  const lines = Array.from(
    { length: FAR_PLACES },
    (_unused, index) => (index % (DISTINCT_LINES - 1000)) + 1,
  );
  return {
    addedLines: lines.map((line) => ({ start: line, end: line })),
    deletionAnchors: lines,
  };
}

describe("filterBetweenHeadsHunks over a long uniform region", () => {
  const shorter = makeUniformRegionTexts(BLANK_LINES);
  const longer = makeUniformRegionTexts(BLANK_LINES + 1);

  it.each([
    { edit: "an added", prevContent: shorter, newContent: longer },
    { edit: "a dropped", prevContent: longer, newContent: shorter },
  ])(
    "tests $edit blank line once per side, not once per slide place",
    ({ prevContent, newContent }) => {
      const patch =
        formatBetweenHeadsPatch({
          prevPath: FILE,
          path: FILE,
          prevContent,
          newContent,
        }) ?? "";

      const filtered = filterBetweenHeadsHunks(
        patch,
        makeFarPlaces(),
        makeFarPlaces(),
        { prevContent, newContent },
      );

      expect(filtered).toBeUndefined();
    },
  );

  it.each([
    { place: SLIDE_TOP - 1, kept: true },
    { place: SLIDE_TOP - 2, kept: false },
  ])(
    "keeps the run when a PR line at $place meets its slide: $kept",
    ({ place, kept }) => {
      const patch =
        formatBetweenHeadsPatch({
          prevPath: FILE,
          path: FILE,
          prevContent: shorter,
          newContent: longer,
        }) ?? "";
      const next: PrChangePlaces = {
        addedLines: [{ start: place, end: place }],
        deletionAnchors: [],
      };

      const filtered = filterBetweenHeadsHunks(patch, NO_PR_CHANGE, next, {
        prevContent: shorter,
        newContent: longer,
      });

      expect(filtered !== undefined).toBe(kept);
    },
  );

  it.each([
    { place: SLIDE_TOP, kept: true },
    { place: SLIDE_TOP - 1, kept: false },
  ])(
    "keeps a deletion when a PR deletion at $place meets its slide: $kept",
    ({ place, kept }) => {
      const patch =
        formatBetweenHeadsPatch({
          prevPath: FILE,
          path: FILE,
          prevContent: longer,
          newContent: shorter,
        }) ?? "";
      const next: PrChangePlaces = {
        addedLines: [],
        deletionAnchors: [place],
      };

      const filtered = filterBetweenHeadsHunks(patch, NO_PR_CHANGE, next, {
        prevContent: longer,
        newContent: shorter,
      });

      expect(filtered !== undefined).toBe(kept);
    },
  );
});
