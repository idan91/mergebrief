import { describe, expect, it } from "vitest";
import { parseChangedRanges } from "../../src/diff/revchanges";
import { alignChunkRanges } from "../../src/generation/align-ranges";
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
