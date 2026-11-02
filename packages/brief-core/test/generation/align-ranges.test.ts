import { describe, expect, it } from "vitest";
import { splitDiffByFile } from "../../src/diff/file-diff";
import {
  parseChangedRanges,
  type RevisionChangeFile,
} from "../../src/diff/revchanges";
import {
  alignAndSnapChunkRanges,
  alignChunkRanges,
} from "../../src/generation/align-ranges";
import { deriveUnattributed } from "../../src/generation/loc";
import { createWarningCollector } from "../../src/generation/warnings";
import {
  GenerationWarningKinds,
  type WarningCollector,
} from "../../src/generation/warnings/types";
import type { LineRange } from "../../src/types";
import { FILE_TO_SYMLINK_DIFF } from "../helpers";

interface StubChunk {
  file: string;
  addedRanges: LineRange[];
  removedRanges: LineRange[];
}

function stubChunk(
  addedRanges: LineRange[],
  removedRanges: LineRange[] = [],
  file = "src/a.ts",
): StubChunk {
  return { file, addedRanges, removedRanges };
}

function makeCollector(): WarningCollector {
  return createWarningCollector(() => undefined);
}

/** Added line 3 and removed line 3 behind two lines of leading context. */
const LEADING_CONTEXT = parseChangedRanges(
  [
    "diff --git a/src/a.ts b/src/a.ts",
    "@@ -1,4 +1,4 @@",
    " const a = 1;",
    " const b = 2;",
    "-const c = 3;",
    "+const c = 30;",
    " const d = 4;",
    "",
  ].join("\n"),
);

/** Added lines 1 and 3 around one context line. */
const SPLIT_BY_CONTEXT = parseChangedRanges(
  [
    "diff --git a/src/a.ts b/src/a.ts",
    "@@ -1,1 +1,3 @@",
    "+const a = 1;",
    " const b = 2;",
    "+const c = 3;",
    "",
  ].join("\n"),
);

const FILE_TO_SYMLINK = parseChangedRanges(FILE_TO_SYMLINK_DIFF);

function makeLineRange(line: number): LineRange {
  return { start: line, end: line };
}

function makeChangedFile(
  addedLines: number[],
  removedLines: number[] = [],
  file = "src/a.ts",
): RevisionChangeFile {
  return {
    file,
    addedRanges: addedLines.map(makeLineRange),
    removedRanges: removedLines.map(makeLineRange),
  };
}

/**
 * Line 2 sits between changed lines 1 and 3, so a range on it fits either
 * way. Lines 10, 20, 30 and 40 are lone changes: a range one line high on
 * 11 or 21 moves down onto them, one line low on 9, 19 or 29 moves up.
 */
const TIED_FILE = makeChangedFile([1, 3, 10, 20, 30, 40], [1, 3, 10, 20]);

/** One chunk per line, each claiming that single added line. */
function stubAddedChunks(lines: number[], file = "src/a.ts"): StubChunk[] {
  return lines.map((line) => stubChunk([makeLineRange(line)], [], file));
}

function listAddedRanges(chunks: readonly StubChunk[]): LineRange[][] {
  return chunks.map((chunk) => chunk.addedRanges);
}

/**
 * Added 2-4 open an object literal whose tail 3-4 is deeper than its first
 * line; 5 is context between added 4 and 6. Added 9 and 12 each sit above
 * two context lines.
 */
const SNAP_TAIL_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,8 +1,14 @@",
  " const before = 1;",
  "+const config = {",
  '+  name: "a",',
  "+  size: 2,",
  " const middle = 2;",
  "+const extra = 3;",
  " const gap = 4;",
  " const gapAgain = 5;",
  "+const late = 6;",
  " const after = 7;",
  " const afterAgain = 8;",
  "+const last = 9;",
  " const end = 10;",
  " const endAgain = 11;",
  "",
].join("\n");

describe("alignChunkRanges", () => {
  it("keeps both sides of a file turned into a symlink", () => {
    const warnings = makeCollector();
    const chunks = [
      stubChunk([{ start: 1, end: 1 }], [{ start: 1, end: 3 }], "config.json"),
    ];

    const aligned = alignChunkRanges(chunks, FILE_TO_SYMLINK, warnings);

    expect(aligned[0]?.removedRanges).toEqual([{ start: 1, end: 3 }]);
    expect(deriveUnattributed(aligned, FILE_TO_SYMLINK)).toEqual([]);
    expect(warnings.listWarnings()).toEqual([]);
  });

  it.each([
    ["one line early", 2],
    ["one line late", 4],
  ])("moves a range claimed %s onto the change", (_label, line) => {
    const chunks = [stubChunk([{ start: line, end: line }])];

    const [aligned] = alignChunkRanges(
      chunks,
      LEADING_CONTEXT,
      makeCollector(),
    );

    expect(aligned?.addedRanges).toEqual([{ start: 3, end: 3 }]);
  });

  it("leaves no remainder once a misplaced range moves onto the change", () => {
    const chunks = [stubChunk([{ start: 2, end: 2 }], [{ start: 4, end: 4 }])];

    const aligned = alignChunkRanges(chunks, LEADING_CONTEXT, makeCollector());

    expect(aligned[0]?.removedRanges).toEqual([{ start: 3, end: 3 }]);
    expect(deriveUnattributed(aligned, LEADING_CONTEXT)).toEqual([]);
  });

  it("never moves a range onto a line another chunk claims", () => {
    const chunks = [
      stubChunk([{ start: 3, end: 3 }]),
      stubChunk([{ start: 2, end: 2 }]),
    ];

    const aligned = alignChunkRanges(chunks, LEADING_CONTEXT, makeCollector());

    expect(aligned.map((chunk) => chunk.addedRanges)).toEqual([
      [{ start: 3, end: 3 }],
      [],
    ]);
  });

  it("drops a range that could move either way", () => {
    const chunks = [stubChunk([{ start: 2, end: 2 }])];

    const aligned = alignChunkRanges(chunks, SPLIT_BY_CONTEXT, makeCollector());

    expect(aligned[0]?.addedRanges).toEqual([]);
    expect(deriveUnattributed(aligned, SPLIT_BY_CONTEXT)).toEqual([
      {
        file: "src/a.ts",
        addedRanges: [
          { start: 1, end: 1 },
          { start: 3, end: 3 },
        ],
        removedRanges: [],
      },
    ]);
  });

  it("clips a range claiming a whole hunk to its changed lines", () => {
    const chunks = [stubChunk([{ start: 1, end: 2213 }])];

    const aligned = alignChunkRanges(chunks, SPLIT_BY_CONTEXT, makeCollector());

    expect(aligned[0]?.addedRanges).toEqual([
      { start: 1, end: 1 },
      { start: 3, end: 3 },
    ]);
  });

  it("drops every range of a file the diff does not change", () => {
    const chunks = [stubChunk([{ start: 1, end: 4 }], [], "src/other.ts")];

    const [aligned] = alignChunkRanges(
      chunks,
      LEADING_CONTEXT,
      makeCollector(),
    );

    expect(aligned?.addedRanges).toEqual([]);
  });

  it("reports what moved and what it clipped in one warning", () => {
    const warnings = makeCollector();
    const chunks = [
      stubChunk([{ start: 2, end: 2 }]),
      stubChunk([{ start: 1, end: 3 }], [], "src/b.ts"),
    ];

    alignChunkRanges(chunks, LEADING_CONTEXT, warnings);

    expect(warnings.listWarnings()).toEqual([
      expect.objectContaining({
        kind: GenerationWarningKinds.RANGES_ALIGNED,
        shiftedRanges: 1,
        clippedLines: 3,
      }),
    ]);
  });

  it("reports nothing when every range sits on changed lines", () => {
    const warnings = makeCollector();

    alignChunkRanges(
      [stubChunk([{ start: 3, end: 3 }], [{ start: 3, end: 3 }])],
      LEADING_CONTEXT,
      warnings,
    );

    expect(warnings.listWarnings()).toEqual([]);
  });
});

describe("alignChunkRanges ties", () => {
  it("moves a tie the way two shifts on its file side both went", () => {
    const chunks = stubAddedChunks([2, 11, 21]);

    const aligned = alignChunkRanges(chunks, [TIED_FILE], makeCollector());

    expect(listAddedRanges(aligned)).toEqual([
      [makeLineRange(1)],
      [makeLineRange(10)],
      [makeLineRange(20)],
    ]);
  });

  it("clips a tie when its file side has only one shift", () => {
    const chunks = stubAddedChunks([2, 11]);

    const aligned = alignChunkRanges(chunks, [TIED_FILE], makeCollector());

    expect(listAddedRanges(aligned)).toEqual([[], [makeLineRange(10)]]);
  });

  it("clips a tie when one shift on its file side went the other way", () => {
    const chunks = stubAddedChunks([2, 11, 21, 29]);

    const aligned = alignChunkRanges(chunks, [TIED_FILE], makeCollector());

    expect(listAddedRanges(aligned)).toEqual([
      [],
      [makeLineRange(10)],
      [makeLineRange(20)],
      [makeLineRange(30)],
    ]);
  });

  it("never moves an added tie on shifts of the removed side", () => {
    const chunks = [
      stubChunk([makeLineRange(2)]),
      stubChunk([], [makeLineRange(11), makeLineRange(21)]),
    ];

    const aligned = alignChunkRanges(chunks, [TIED_FILE], makeCollector());

    expect(aligned[0]?.addedRanges).toEqual([]);
    expect(aligned[1]?.removedRanges).toEqual([
      makeLineRange(10),
      makeLineRange(20),
    ]);
  });

  it("never moves a tie on shifts in another file", () => {
    const otherFile = makeChangedFile([10, 20], [], "src/b.ts");
    const chunks = [
      stubChunk([makeLineRange(2)]),
      ...stubAddedChunks([11, 21], "src/b.ts"),
    ];

    const aligned = alignChunkRanges(
      chunks,
      [TIED_FILE, otherFile],
      makeCollector(),
    );

    expect(listAddedRanges(aligned)).toEqual([
      [],
      [makeLineRange(10)],
      [makeLineRange(20)],
    ]);
  });

  it("gives two ties on one line to the first chunk and clips the second", () => {
    const chunks = stubAddedChunks([2, 2, 11, 21]);

    const aligned = alignChunkRanges(chunks, [TIED_FILE], makeCollector());

    expect(listAddedRanges(aligned)).toEqual([
      [makeLineRange(1)],
      [],
      [makeLineRange(10)],
      [makeLineRange(20)],
    ]);
  });

  it("clips a tie whose move a later chunk's shift already claimed", () => {
    const changed = makeChangedFile([1, 3]);
    const chunks = stubAddedChunks([2, 4, 2]);

    const aligned = alignChunkRanges(chunks, [changed], makeCollector());

    expect(listAddedRanges(aligned)).toEqual([
      [],
      [makeLineRange(3)],
      [makeLineRange(1)],
    ]);
  });

  it("moves a tie up when two shifts on its file side both went up", () => {
    const chunks = stubAddedChunks([2, 9, 19]);

    const aligned = alignChunkRanges(chunks, [TIED_FILE], makeCollector());

    expect(listAddedRanges(aligned)).toEqual([
      [makeLineRange(3)],
      [makeLineRange(10)],
      [makeLineRange(20)],
    ]);
  });

  it.each([
    ["at the start", [2, 30], [1, 30]],
    ["in the middle", [30, 2, 40], [30, 1, 40]],
  ])(
    "keeps a moved tie %s of the chunk's range list",
    (_place, writtenLines, alignedLines) => {
      const chunks = [
        stubChunk(writtenLines.map(makeLineRange)),
        ...stubAddedChunks([11, 21]),
      ];

      const [aligned] = alignChunkRanges(chunks, [TIED_FILE], makeCollector());

      expect(aligned?.addedRanges).toEqual(alignedLines.map(makeLineRange));
    },
  );

  it("aligns as before when no file side is unanimous", () => {
    const warnings = makeCollector();
    const otherFile = makeChangedFile([1, 3], [], "src/b.ts");
    const chunks = [
      stubChunk(
        [makeLineRange(2), makeLineRange(11), { start: 19, end: 21 }],
        [makeLineRange(2), makeLineRange(11)],
      ),
      stubChunk([makeLineRange(29)], [makeLineRange(19)]),
      stubChunk([makeLineRange(2)], [], "src/b.ts"),
    ];

    const aligned = alignChunkRanges(chunks, [TIED_FILE, otherFile], warnings);

    expect(aligned).toEqual([
      stubChunk([makeLineRange(10), makeLineRange(20)], [makeLineRange(10)]),
      stubChunk([makeLineRange(30)], [makeLineRange(20)]),
      stubChunk([], [], "src/b.ts"),
    ]);
    expect(warnings.listWarnings()).toEqual([
      expect.objectContaining({ shiftedRanges: 4, clippedLines: 5 }),
    ]);
  });

  it("counts a moved tie as shifted and a kept tie as clipped", () => {
    const warnings = makeCollector();
    const otherFile = makeChangedFile([1, 3], [], "src/b.ts");
    const chunks = [
      ...stubAddedChunks([2, 11, 21]),
      stubChunk([makeLineRange(2)], [], "src/b.ts"),
    ];

    alignChunkRanges(chunks, [TIED_FILE, otherFile], warnings);

    expect(warnings.listWarnings()).toEqual([
      expect.objectContaining({ shiftedRanges: 3, clippedLines: 1 }),
    ]);
  });
});

describe("alignAndSnapChunkRanges ties", () => {
  it("stops an earlier chunk's snap before the line a tie moved onto", () => {
    const fileDiffs = splitDiffByFile(SNAP_TAIL_DIFF);
    const changed = parseChangedRanges(SNAP_TAIL_DIFF);
    const chunks = stubAddedChunks([2, 5, 10, 13]);

    const snapped = alignAndSnapChunkRanges(
      chunks,
      fileDiffs,
      changed,
      makeCollector(),
    );

    expect(listAddedRanges(snapped)).toEqual([
      [{ start: 2, end: 3 }],
      [makeLineRange(4)],
      [makeLineRange(9)],
      [makeLineRange(12)],
    ]);
  });
});
