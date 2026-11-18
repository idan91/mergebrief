import { describe, expect, it } from "vitest";
import {
  BetweenHeadsKinds,
  buildPrSpan,
  type BetweenHeadsFile,
} from "../../../src/diff/pr-span";
import {
  IDENTITY_SPAN,
  REST_OF_FILE_LINES,
} from "../../../src/diff/pr-span/consts";
import { RemapOutcomes, remapThroughHops } from "../../../src/diff/remap";
import {
  insertAfter,
  makeBaseLines,
  makeDiff,
  makeFilePatch,
  makeText,
  replaceLine,
} from "./helpers";

const FILE = "src/f.ts";

function makePrDiff(base: readonly string[], head: readonly string[]): string {
  return makeDiff([
    makeFilePatch({ path: FILE, base: makeText(base), head: makeText(head) }),
  ]);
}

function makeBetweenHeads(
  hunks: readonly string[],
): ReadonlyMap<string, BetweenHeadsFile> {
  const patch = [
    `diff --git a/${FILE} b/${FILE}`,
    `--- a/${FILE}`,
    `+++ b/${FILE}`,
    ...hunks,
  ].join("\n");
  return new Map([[FILE, { kind: BetweenHeadsKinds.PATCH, patch }]]);
}

describe("buildPrSpan when only the base moved", () => {
  it("reads an identical tree after a squash as unchanged", () => {
    const base = makeBaseLines(10);
    const diff = makePrDiff(base, insertAfter(base, "b5", ["p1"]));

    const span = buildPrSpan({
      prevPrDiff: diff,
      newPrDiff: diff,
      betweenHeads: new Map(),
    });

    expect(span.isUnchanged).toBe(true);
    expect(span.changedFiles).toEqual([]);
    expect(span.filteredDiff).toBe("");
    expect(span.hop).toEqual([{ file: FILE, hunks: [IDENTITY_SPAN] }]);
    expect(remapThroughHops(FILE, [{ start: 6, end: 6 }], [span.hop])).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 6, end: 6 }],
    });
  });

  it("shifts runs past base inserts above, between and below them", () => {
    const base = makeBaseLines(30);
    const withPr = insertAfter(insertAfter(base, "b5", ["p1"]), "b20", ["p2"]);
    const movedBase = insertAfter(
      insertAfter(insertAfter(base, "b2", ["n1"]), "b12", ["n2"]),
      "b27",
      ["n3"],
    );
    const movedWithPr = insertAfter(
      insertAfter(movedBase, "b5", ["p1"]),
      "b20",
      ["p2"],
    );

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, withPr),
      newPrDiff: makePrDiff(movedBase, movedWithPr),
      betweenHeads: new Map(),
    });

    expect(span.isUnchanged).toBe(true);
    expect(span.hop).toEqual([
      {
        file: FILE,
        hunks: [
          { oldStart: 1, oldLines: 5, newStart: 1, newLines: 6 },
          { oldStart: 7, oldLines: 15, newStart: 8, newLines: 16 },
          {
            oldStart: 23,
            oldLines: REST_OF_FILE_LINES,
            newStart: 25,
            newLines: REST_OF_FILE_LINES,
          },
        ],
      },
    ]);
    expect(
      remapThroughHops(
        FILE,
        [
          { start: 6, end: 6 },
          { start: 22, end: 22 },
        ],
        [span.hop],
      ),
    ).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [
        { start: 7, end: 7 },
        { start: 24, end: 24 },
      ],
    });
  });

  it("demotes ranges in a stretch between or below the runs", () => {
    const base = makeBaseLines(30);
    const withPr = insertAfter(base, "b5", ["p1"]);
    const movedBase = insertAfter(base, "b2", ["n1"]);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, withPr),
      newPrDiff: makePrDiff(movedBase, insertAfter(movedBase, "b5", ["p1"])),
      betweenHeads: new Map(),
    });

    const between = remapThroughHops(FILE, [{ start: 3, end: 3 }], [span.hop]);
    const below = remapThroughHops(FILE, [{ start: 20, end: 20 }], [span.hop]);
    expect(between.outcome).toBe(RemapOutcomes.DEMOTED);
    expect(below.outcome).toBe(RemapOutcomes.DEMOTED);
  });

  it("shifts the second run of a hunk past a base insert in its context", () => {
    const base = makeBaseLines(20);
    const withPr = insertAfter(insertAfter(base, "b5", ["p1"]), "b8", ["p2"]);
    const movedBase = insertAfter(base, "b6", ["n1"]);
    const movedWithPr = insertAfter(
      insertAfter(movedBase, "b5", ["p1"]),
      "b8",
      ["p2"],
    );

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, withPr),
      newPrDiff: makePrDiff(movedBase, movedWithPr),
      betweenHeads: makeBetweenHeads([
        "@@ -5,6 +5,7 @@",
        " b5",
        " p1",
        " b6",
        "+n1",
        " b7",
        " b8",
        " p2",
      ]),
    });

    expect(span.isUnchanged).toBe(true);
    expect(span.filteredDiff).toBe("");
    expect(span.hop[0]?.hunks).toEqual([
      { oldStart: 7, oldLines: 0, newStart: 8, newLines: 1 },
    ]);
    expect(
      remapThroughHops(
        FILE,
        [
          { start: 6, end: 6 },
          { start: 10, end: 10 },
        ],
        [span.hop],
      ),
    ).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [
        { start: 6, end: 6 },
        { start: 11, end: 11 },
      ],
    });
  });

  it("reads a context-only change as unchanged", () => {
    const base = makeBaseLines(12);
    const movedBase = replaceLine(base, "b4", ["b4x"]);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, insertAfter(base, "b5", ["p1"])),
      newPrDiff: makePrDiff(movedBase, insertAfter(movedBase, "b5", ["p1"])),
      betweenHeads: makeBetweenHeads([
        "@@ -1,7 +1,7 @@",
        " b1",
        " b2",
        " b3",
        "-b4",
        "+b4x",
        " b5",
        " p1",
        " b6",
      ]),
    });

    expect(span.isUnchanged).toBe(true);
    expect(span.unchangedFiles).toEqual([FILE]);
    expect(
      remapThroughHops(FILE, [{ start: 6, end: 6 }], [span.hop]).outcome,
    ).toBe(RemapOutcomes.REMAPPED);
    expect(
      remapThroughHops(FILE, [{ start: 4, end: 4 }], [span.hop]).outcome,
    ).toBe(RemapOutcomes.DEMOTED);
  });
});

describe("buildPrSpan when the PR change moved", () => {
  it("reads a run moved from one hunk to the next as changed", () => {
    const base = makeBaseLines(30);
    const prev = insertAfter(insertAfter(base, "b5", ["a", "r"]), "b25", ["b"]);
    const next = insertAfter(insertAfter(base, "b5", ["a"]), "b25", ["r", "b"]);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, prev),
      newPrDiff: makePrDiff(base, next),
      betweenHeads: new Map(),
    });

    expect(span.isUnchanged).toBe(false);
    expect(span.changedFiles).toEqual([FILE]);
  });

  it("reads a PR line moved within the file on one base as changed", () => {
    const base = makeBaseLines(30);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, insertAfter(base, "b10", ["return;"])),
      newPrDiff: makePrDiff(base, insertAfter(base, "b20", ["return;"])),
      betweenHeads: new Map(),
    });

    expect(span.isUnchanged).toBe(false);
    expect(span.changedFiles).toEqual([FILE]);
  });

  it("keeps a hunk restoring a base line the previous head deleted", () => {
    const base = makeBaseLines(12);
    const withP1 = insertAfter(base, "b1", ["p1"]);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, replaceLine(withP1, "b5", [])),
      newPrDiff: makePrDiff(base, withP1),
      betweenHeads: makeBetweenHeads([
        "@@ -3,6 +3,7 @@",
        " b2",
        " b3",
        " b4",
        "+b5",
        " b6",
        " b7",
        " b8",
      ]),
    });

    expect(span.filteredDiff).toContain("+b5");
    expect(span.hop[0]?.hunks).toEqual([
      { oldStart: 3, oldLines: 6, newStart: 3, newLines: 7 },
    ]);
  });

  it("keeps a hunk deleting a base line the new head newly deletes", () => {
    const base = makeBaseLines(12);
    const withP1 = insertAfter(base, "b1", ["p1"]);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, withP1),
      newPrDiff: makePrDiff(base, replaceLine(withP1, "b5", [])),
      betweenHeads: makeBetweenHeads([
        "@@ -3,7 +3,6 @@",
        " b2",
        " b3",
        " b4",
        "-b5",
        " b6",
        " b7",
        " b8",
      ]),
    });

    expect(span.filteredDiff).toContain("-b5");
  });

  it("filters out a base edit beside a PR hunk", () => {
    const base = makeBaseLines(40);
    const movedBase = replaceLine(base, "b9", ["b9x"]);
    const between = makeBetweenHeads([
      "@@ -6,7 +6,7 @@",
      " b6",
      " b7",
      " b8",
      "-b9",
      "+b9x",
      " b10",
      " p1",
      " b11",
      "@@ -29,6 +29,7 @@",
      " b28",
      " b29",
      " b30",
      "+p2",
      " b31",
      " b32",
      " b33",
    ]);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, insertAfter(base, "b10", ["p1"])),
      newPrDiff: makePrDiff(
        movedBase,
        insertAfter(insertAfter(movedBase, "b10", ["p1"]), "b30", ["p2"]),
      ),
      betweenHeads: between,
    });

    expect(span.unfilteredDiff).toContain("+b9x");
    expect(span.filteredDiff).not.toContain("b9x");
    expect(span.filteredDiff).toContain("+p2");
  });

  it("abuts a base edit directly beside a PR run, over-reading it", () => {
    const base = makeBaseLines(40);
    const movedBase = replaceLine(base, "b10", ["b10x"]);
    const between = makeBetweenHeads([
      "@@ -7,7 +7,7 @@",
      " b7",
      " b8",
      " b9",
      "-b10",
      "+b10x",
      " p1",
      " b11",
      " b12",
    ]);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, insertAfter(base, "b10", ["p1"])),
      newPrDiff: makePrDiff(movedBase, insertAfter(movedBase, "b10x", ["p1"])),
      betweenHeads: between,
    });

    expect(span.filteredDiff).toContain("+b10x");
  });

  it("keeps a conflict resolution inside a PR hunk", () => {
    const base = makeBaseLines(12);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, insertAfter(base, "b5", ["p1"])),
      newPrDiff: makePrDiff(base, insertAfter(base, "b5", ["p1x"])),
      betweenHeads: makeBetweenHeads([
        "@@ -3,7 +3,7 @@",
        " b3",
        " b4",
        " b5",
        "-p1",
        "+p1x",
        " b6",
        " b7",
        " b8",
      ]),
    });

    expect(span.filteredDiff).toContain("+p1x");
  });

  it("cuts a base run out of the hunk it shares with a PR run", () => {
    const base = makeBaseLines(14);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, insertAfter(base, "b5", ["p1"])),
      newPrDiff: makePrDiff(
        replaceLine(base, "b8", ["b8x"]),
        insertAfter(replaceLine(base, "b8", ["b8x"]), "b5", ["p1x"]),
      ),
      betweenHeads: makeBetweenHeads([
        "@@ -3,10 +3,10 @@",
        " b3",
        " b4",
        " b5",
        "-p1",
        "+p1x",
        " b6",
        " b7",
        "-b8",
        "+b8x",
        " b9",
        " b10",
        " b11",
      ]),
    });

    expect(span.filteredDiff).toContain("+p1x");
    expect(span.filteredDiff).not.toContain("b8x");
    expect(span.unfilteredDiff).toContain("+b8x");
  });
});

describe("buildPrSpan when the base took or gave back part of the change", () => {
  const base = makeBaseLines(12);
  const head = insertAfter(insertAfter(base, "b5", ["p"]), "b8", ["p2"]);
  const baseWithP2 = insertAfter(base, "b8", ["p2"]);
  const readerRanges = [
    { start: 6, end: 6 },
    { start: 10, end: 10 },
  ];

  function makeIndexedPrDiff(from: readonly string[], index: string): string {
    const patch = makeFilePatch({
      path: FILE,
      base: makeText(from),
      head: makeText(head),
    });
    return makeDiff([patch.replace(/^index \S+/m, `index ${index}`)]);
  }

  it("reads a run the base absorbed as changed under an identity hop", () => {
    const span = buildPrSpan({
      prevPrDiff: makeIndexedPrDiff(base, "aaaaaaa..ccccccc"),
      newPrDiff: makeIndexedPrDiff(baseWithP2, "bbbbbbb..ccccccc"),
      betweenHeads: new Map(),
    });

    expect(span.isUnchanged).toBe(false);
    expect(span.changedFiles).toEqual([FILE]);
    expect(span.unchangedFiles).toEqual([]);
    expect(span.filteredDiff).toBe(`diff --git a/${FILE} b/${FILE}`);
    expect(span.unfilteredDiff).toBe(span.filteredDiff);
    expect(span.hop).toEqual([{ file: FILE, hunks: [IDENTITY_SPAN] }]);
    expect(remapThroughHops(FILE, readerRanges, [span.hop])).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: readerRanges,
    });
  });

  it("reads a run the base gave back as changed with only that run", () => {
    const span = buildPrSpan({
      prevPrDiff: makeIndexedPrDiff(baseWithP2, "bbbbbbb..ccccccc"),
      newPrDiff: makeIndexedPrDiff(base, "aaaaaaa..ccccccc"),
      betweenHeads: new Map(),
    });

    expect(span.isUnchanged).toBe(false);
    expect(span.changedFiles).toEqual([FILE]);
    expect(span.filteredDiff).toContain("+p2");
    expect(span.filteredDiff).not.toContain("+b");
    expect(span.filteredDiff).not.toContain("+p\n");
    expect(span.filteredDiff).toBe(
      [
        `diff --git a/${FILE} b/${FILE}`,
        `--- a/${FILE}`,
        `+++ b/${FILE}`,
        "@@ -6,6 +7,7 @@",
        " b6",
        " b7",
        " b8",
        "+p2",
        " b9",
        " b10",
        " b11",
      ].join("\n"),
    );
    expect(span.unfilteredDiff).toBe(span.filteredDiff);
    expect(span.hop).toEqual([{ file: FILE, hunks: [IDENTITY_SPAN] }]);
    expect(remapThroughHops(FILE, readerRanges, [span.hop])).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: readerRanges,
    });
  });

  it("reads the same runs at the same lines over two bases as unchanged", () => {
    const span = buildPrSpan({
      prevPrDiff: makeIndexedPrDiff(base, "aaaaaaa..ccccccc"),
      newPrDiff: makeIndexedPrDiff(base, "bbbbbbb..ccccccc"),
      betweenHeads: new Map(),
    });

    expect(span.isUnchanged).toBe(true);
    expect(span.hop).toEqual([{ file: FILE, hunks: [IDENTITY_SPAN] }]);
  });

  it("keeps only the header when the base took a line out of one run", () => {
    const withAbc = insertAfter(base, "b5", ["a", "b", "c"]);
    const baseWithB = insertAfter(base, "b5", ["b"]);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, withAbc),
      newPrDiff: makePrDiff(baseWithB, withAbc),
      betweenHeads: new Map(),
    });

    expect(span.changedFiles).toEqual([FILE]);
    expect(span.filteredDiff).toBe(`diff --git a/${FILE} b/${FILE}`);
    expect(span.hop).toEqual([{ file: FILE, hunks: [IDENTITY_SPAN] }]);
  });

  it("keeps only the header when the base later holds part of a new file", () => {
    const added = ["x1", "x2", "x3", "x4"];
    const prevPatch = makeFilePatch({
      path: FILE,
      base: "",
      head: makeText(added),
      isAdded: true,
    });
    const newPatch = makeFilePatch({
      path: FILE,
      base: makeText(["x2", "x3"]),
      head: makeText(added),
    });

    const span = buildPrSpan({
      prevPrDiff: makeDiff([prevPatch]),
      newPrDiff: makeDiff([newPatch]),
      betweenHeads: new Map(),
    });

    expect(span.changedFiles).toEqual([FILE]);
    expect(span.filteredDiff).not.toContain("+x");
    expect(span.hop).toEqual([{ file: FILE, hunks: [IDENTITY_SPAN] }]);
  });

  it("shows a line the base added and the PR now removes", () => {
    const withP = insertAfter(base, "b5", ["p"]);
    const baseWithZ = insertAfter(base, "b8", ["z"]);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, withP),
      newPrDiff: makePrDiff(baseWithZ, withP),
      betweenHeads: new Map(),
    });

    expect(span.changedFiles).toEqual([FILE]);
    expect(span.filteredDiff).toBe(
      [
        `diff --git a/${FILE} b/${FILE}`,
        `--- a/${FILE}`,
        `+++ b/${FILE}`,
        "@@ -6,7 +7,6 @@",
        " b6",
        " b7",
        " b8",
        "-z",
        " b9",
        " b10",
        " b11",
      ].join("\n"),
    );
  });
});

describe("buildPrSpan when the base renamed a path", () => {
  const base = makeText(makeBaseLines(12));
  const head = makeText(insertAfter(makeBaseLines(12), "b5", ["p1"]));

  it("reads a confirmed base rename under the same PR change as unchanged", () => {
    const span = buildPrSpan({
      prevPrDiff: makeDiff([makeFilePatch({ path: "a.ts", base, head })]),
      newPrDiff: makeDiff([makeFilePatch({ path: "a2.ts", base, head })]),
      betweenHeads: new Map(),
      baseRenames: new Set(["a2.ts"]),
    });

    expect(span.isUnchanged).toBe(true);
    expect(span.unchangedFiles).toEqual(["a2.ts"]);
    expect(span.unfilteredDiff).toBe("");
    expect(span.hop).toEqual([{ file: "a.ts", hunks: [] }]);
  });

  it("reads an unconfirmed base rename as two changed files", () => {
    const span = buildPrSpan({
      prevPrDiff: makeDiff([makeFilePatch({ path: "a.ts", base, head })]),
      newPrDiff: makeDiff([makeFilePatch({ path: "a2.ts", base, head })]),
      betweenHeads: new Map(),
    });

    expect(span.isUnchanged).toBe(false);
    expect(span.changedFiles).toEqual(["a2.ts", "a.ts"]);
    expect(span.hop).toEqual([
      { file: "a2.ts", hunks: [] },
      { file: "a.ts", hunks: [] },
    ]);
  });

  it("pairs no base rename when two new-head files share the blobs", () => {
    const span = buildPrSpan({
      prevPrDiff: makeDiff([makeFilePatch({ path: "a.ts", base, head })]),
      newPrDiff: makeDiff([
        makeFilePatch({ path: "b.ts", base, head }),
        makeFilePatch({ path: "c.ts", base, head }),
      ]),
      betweenHeads: new Map(),
      baseRenames: new Set(["b.ts", "c.ts"]),
    });

    expect(span.changedFiles).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(span.unchangedFiles).toEqual([]);
  });

  it("reads a base rename that also changes the mode as changed", () => {
    const span = buildPrSpan({
      prevPrDiff: makeDiff([makeFilePatch({ path: "a.ts", base, head })]),
      newPrDiff: makeDiff([
        makeFilePatch({
          path: "a2.ts",
          base,
          head,
          oldMode: "100644",
          mode: "100755",
        }),
      ]),
      betweenHeads: new Map(),
      baseRenames: new Set(["a2.ts"]),
    });

    expect(span.isUnchanged).toBe(false);
    expect(span.changedFiles).toContain("a2.ts");
  });
});

describe("buildPrSpan on header-only changes", () => {
  const binaryPatch = (blob: string): string =>
    [
      "diff --git a/img.png b/img.png",
      `index 1111111..${blob} 100644`,
      "Binary files a/img.png and b/img.png differ",
    ].join("\n");

  it("reads a binary file changed between heads by its blob id", () => {
    const span = buildPrSpan({
      prevPrDiff: makeDiff([binaryPatch("2222222")]),
      newPrDiff: makeDiff([binaryPatch("3333333")]),
      betweenHeads: new Map(),
    });

    expect(span.changedFiles).toEqual(["img.png"]);
    expect(span.unpairableFiles).toEqual(["img.png"]);
    expect(span.hop).toEqual([{ file: "img.png", hunks: [] }]);
    expect(span.filteredDiff).toContain(
      "Binary files a/img.png and b/img.png differ",
    );
  });

  it("reads the same binary blob at both heads as unchanged", () => {
    const diff = makeDiff([binaryPatch("2222222")]);

    const span = buildPrSpan({
      prevPrDiff: diff,
      newPrDiff: diff,
      betweenHeads: new Map(),
    });

    expect(span.isUnchanged).toBe(true);
  });

  it("marks a binary file deleted at the new head as deleted", () => {
    const deleted = [
      "diff --git a/img.png b/img.png",
      "deleted file mode 100644",
      "index 2222222..0000000",
      "Binary files a/img.png and /dev/null differ",
    ].join("\n");

    const span = buildPrSpan({
      prevPrDiff: makeDiff([binaryPatch("3333333")]),
      newPrDiff: makeDiff([deleted]),
      betweenHeads: new Map(),
    });

    expect(span.changedFiles).toEqual(["img.png"]);
    expect(span.filteredDiff).toContain("deleted file mode 100644");
    expect(span.filteredDiff).toContain(
      "Binary files a/img.png and /dev/null differ",
    );
  });

  it("reads a mode-only change as changed", () => {
    const base = makeBaseLines(8);
    const head = insertAfter(base, "b3", ["p1"]);
    const prevPatch = makeFilePatch({
      path: FILE,
      base: makeText(base),
      head: makeText(head),
    });
    const newPatch = prevPatch
      .replace(/ 100644$/m, "")
      .replace(/^index /m, "old mode 100644\nnew mode 100755\nindex ");

    const span = buildPrSpan({
      prevPrDiff: makeDiff([prevPatch]),
      newPrDiff: makeDiff([newPatch]),
      betweenHeads: new Map(),
    });

    expect(span.changedFiles).toEqual([FILE]);
    expect(span.filteredDiff).toContain("new mode 100755");
    expect(span.hop).toEqual([{ file: FILE, hunks: [] }]);
  });
});

describe("buildPrSpan's old-side hop", () => {
  it("keeps a removed range where the base under the file held still", () => {
    const base = makeBaseLines(10);
    const diff = makePrDiff(base, replaceLine(base, "b4", ["p4"]));

    const span = buildPrSpan({
      prevPrDiff: diff,
      newPrDiff: diff,
      betweenHeads: new Map(),
    });

    expect(span.oldSideHop).toEqual([{ file: FILE, hunks: [IDENTITY_SPAN] }]);
  });

  it("shifts a removed range past base inserts above it", () => {
    const base = makeBaseLines(20);
    const movedBase = insertAfter(base, "b2", ["n1", "n2"]);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, replaceLine(base, "b9", ["p9"])),
      newPrDiff: makePrDiff(movedBase, replaceLine(movedBase, "b9", ["p9"])),
      betweenHeads: new Map(),
    });

    const onRemoved = remapThroughHops(
      FILE,
      [{ start: 9, end: 9 }],
      [span.oldSideHop],
    );
    const onContext = remapThroughHops(
      FILE,
      [{ start: 5, end: 5 }],
      [span.oldSideHop],
    );
    expect(onRemoved).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 11, end: 11 }],
    });
    expect(onContext.outcome).toBe(RemapOutcomes.DEMOTED);
  });

  it("gives a changed file no old-side spans", () => {
    const base = makeBaseLines(10);

    const span = buildPrSpan({
      prevPrDiff: makePrDiff(base, replaceLine(base, "b4", ["p4"])),
      newPrDiff: makePrDiff(base, replaceLine(base, "b4", ["q4"])),
      betweenHeads: new Map(),
    });

    expect(span.oldSideHop).toEqual([{ file: FILE, hunks: [] }]);
  });
});
