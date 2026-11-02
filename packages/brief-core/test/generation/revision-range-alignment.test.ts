import { describe, expect, it } from "vitest";
import {
  categorizeDelta,
  categorizeRevisionNarrative,
  type DeltaInput,
  type RevisionNarrativeInput,
} from "../../src/generation/categorize";
import { parseChangedRanges } from "../../src/diff/revchanges";
import type { DeltaChunk, RevisionNarrativeChunk } from "../../src/types";
import {
  makeFakeGenerator,
  makeTwoGroupBrief,
  makeValidBrief,
  makeValidDeltaBrief,
  makeValidRevisionNarrative,
} from "../helpers";

type NarrativeChunkFields = Partial<RevisionNarrativeChunk>;
type DeltaChunkFields = Partial<DeltaChunk>;

const PREV_HEAD = "aaaa111100000000";
const HEAD = "bbbb222200000000";

/** One line replaced at line 11 on both sides, between two context lines. */
const SINGLE_LINE_CHANGE = [
  "diff --git a/a.ts b/a.ts",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -10,3 +10,3 @@",
  " const before = 1;",
  "-const value = 2;",
  "+const value = 20;",
  " const after = 3;",
  "",
].join("\n");

/**
 * The shape of the Node changelog hunk `-149,15 +150,15`: added 153, 155-156
 * and 159-161, removed 152, 154-155 and 158-160.
 */
const NODE_HUNK = [
  "diff --git a/a.ts b/a.ts",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -149,15 +150,15 @@",
  " * doc: discourage AbortSignal cleanup",
  " * doc: document REPL DEP0185 throws",
  " * doc: deprecate Server.prototype._listen2",
  "-* 992c5f6b4b errors: validate constructor name",
  "+* 6b99b5ba6f errors: validate constructor name",
  " * events: fix weak listener retention overwrite",
  "-* bfbc810698 ffi: throw on missing memory helper arguments",
  "-* 8b9d2bd9c3 ffi: include SharedArrayBuffer in error message",
  "+* a412d2ae28 ffi: throw on missing memory helper arguments",
  "+* 60e085df5d ffi: include SharedArrayBuffer in error message",
  " * ffi: enable module by default",
  " * ffi: validate DynamicLibrary getter receivers",
  "-* 36f0fd92fb fs: copy directory trees for fs.cp()",
  "-* b19703450c fs: give directories created by cpSync a mode",
  "-* bb4d42cfac fs: write files in one thread pool round trip",
  "+* d5ac0f4e36 fs: copy directory trees for fs.cp()",
  "+* 4f8195078c fs: give directories created by cpSync a mode",
  "+* 9a6bef435c fs: write files in one thread pool round trip",
  " * fs: handle recursive watch setup races",
  " * fs: apply nocase to literal glob exclude patterns",
  " * fs: improve performance of recursive directory read",
  "",
].join("\n");

/** A three-line object literal added after line 1: its statement runs 2-5. */
const ADDED_STATEMENT = [
  "diff --git a/a.ts b/a.ts",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1,1 +1,5 @@",
  " const before = 1;",
  "+const config = {",
  '+  name: "a",',
  "+  size: 2,",
  "+};",
  "",
].join("\n");

const LOCATOR = { owner: "o", repo: "r", number: 1 };

const META = {
  title: "t",
  body: "d",
  url: "https://github.com/o/r/pull/1",
  sha: HEAD,
  baseSha: "base000000000000",
  commitCount: 2,
  files: [{ path: "a.ts", additions: 1, deletions: 1 }],
};

function makeNarrativeInput(incrementalDiff: string): RevisionNarrativeInput {
  return {
    locator: LOCATOR,
    meta: META,
    prevHeadSha: PREV_HEAD,
    headSha: HEAD,
    prevIndex: 1,
    headIndex: 2,
    incrementalDiff,
    brief: makeValidBrief(),
  };
}

function makeDeltaInput(incrementalDiff: string): DeltaInput {
  return {
    locator: LOCATOR,
    meta: META,
    baselineSha: PREV_HEAD,
    headSha: HEAD,
    incrementalDiff,
  };
}

function stubNarrativeAnswer(chunks: readonly NarrativeChunkFields[]) {
  const narrative = makeValidRevisionNarrative();
  const [template] = narrative.chunks;

  return {
    overview: narrative.overview,
    chunks: chunks.map((fields, index) => ({
      ...template,
      id: `rc${String(index + 1)}`,
      ...fields,
    })),
  };
}

function stubDeltaAnswer(chunks: readonly DeltaChunkFields[]) {
  const delta = makeValidDeltaBrief();
  const [template] = delta.chunks;

  return {
    ...delta,
    chunks: chunks.map((fields, index) => ({
      ...template,
      id: `c${String(index + 1)}`,
      riskSurface: [],
      ...fields,
    })),
  };
}

function formatAlignedWarning(shifted: number, clipped: number): string {
  return `chunk ranges aligned to the diff: ${String(shifted)} range(s) moved one line onto the change beside them, ${String(clipped)} claimed line(s) off the changed lines clipped`;
}

describe("revision chunk ranges aligned to the span", () => {
  it("moves a narrative chunk one line off onto the change it meant", async () => {
    const answer = stubNarrativeAnswer([
      {
        addedRanges: [{ start: 12, end: 12 }],
        removedRanges: [{ start: 12, end: 12 }],
      },
    ]);

    const narrative = await categorizeRevisionNarrative(
      makeNarrativeInput(SINGLE_LINE_CHANGE),
      makeFakeGenerator(answer),
    );

    expect(narrative.chunks[0]).toMatchObject({
      addedRanges: [{ start: 11, end: 11 }],
      removedRanges: [{ start: 11, end: 11 }],
    });
    expect(narrative.generationWarnings).toEqual([formatAlignedWarning(2, 0)]);
  });

  it("moves a delta chunk onto its change and counts the line in loc", async () => {
    const answer = stubDeltaAnswer([
      {
        addedRanges: [{ start: 12, end: 12 }],
        removedRanges: [{ start: 12, end: 12 }],
      },
    ]);

    const delta = await categorizeDelta(
      makeDeltaInput(SINGLE_LINE_CHANGE),
      makeFakeGenerator(answer),
    );

    expect(delta.chunks[0]).toMatchObject({
      addedRanges: [{ start: 11, end: 11 }],
      removedRanges: [{ start: 11, end: 11 }],
      loc: { added: 1, deleted: 1 },
    });
    expect(delta.generationWarnings).toContain(formatAlignedWarning(2, 0));
  });

  it("clips a range whose one-line move lands on another chunk's line", async () => {
    const answer = stubDeltaAnswer([
      { addedRanges: [{ start: 11, end: 11 }], removedRanges: [] },
      { addedRanges: [{ start: 12, end: 12 }], removedRanges: [] },
    ]);

    const delta = await categorizeDelta(
      makeDeltaInput(SINGLE_LINE_CHANGE),
      makeFakeGenerator(answer),
    );

    expect(delta.chunks.map((chunk) => chunk.addedRanges)).toEqual([
      [{ start: 11, end: 11 }],
      [],
    ]);
    const warnings = delta.generationWarnings?.join("\n") ?? "";
    expect(warnings).toContain(formatAlignedWarning(0, 1));
    expect(warnings).not.toContain("loc overlap");
  });

  it("clips a Node hunk written one line high and leaves mark 153 open", async () => {
    const answer = stubNarrativeAnswer([
      {
        addedRanges: [
          { start: 154, end: 154 },
          { start: 156, end: 157 },
          { start: 160, end: 162 },
        ],
        removedRanges: [
          { start: 153, end: 153 },
          { start: 155, end: 156 },
          { start: 159, end: 161 },
        ],
      },
    ]);

    const narrative = await categorizeRevisionNarrative(
      {
        ...makeNarrativeInput(NODE_HUNK),
        marksFiles: parseChangedRanges(NODE_HUNK),
      },
      makeFakeGenerator(answer),
    );

    expect(narrative.chunks[0]).toMatchObject({
      addedRanges: [
        { start: 156, end: 156 },
        { start: 160, end: 161 },
      ],
      removedRanges: [
        { start: 155, end: 155 },
        { start: 159, end: 160 },
      ],
    });
    const warnings = narrative.generationWarnings?.join("\n") ?? "";
    expect(warnings).toContain(formatAlignedWarning(0, 6));
    expect(warnings).toContain(
      "no narrative chunk covers added 153; removed 152",
    );
  });

  it("drops removes-validation from a delta chunk removing no changed line", async () => {
    const answer = stubDeltaAnswer([
      {
        addedRanges: [{ start: 11, end: 11 }],
        removedRanges: [{ start: 30, end: 30 }],
        riskSurface: ["removes-validation"],
      },
    ]);

    const delta = await categorizeDelta(
      makeDeltaInput(SINGLE_LINE_CHANGE),
      makeFakeGenerator(answer),
    );

    expect(delta.chunks[0]).toMatchObject({
      removedRanges: [],
      riskSurface: [],
    });
    expect(delta.generationWarnings?.join("\n")).toContain(
      "chunk removes no lines",
    );
  });

  it("warns on a delta chunk alignment leaves with no changed line", async () => {
    const answer = stubDeltaAnswer([
      { addedRanges: [{ start: 11, end: 11 }], removedRanges: [] },
      { addedRanges: [{ start: 30, end: 30 }], removedRanges: [] },
      { addedRanges: [], removedRanges: [] },
    ]);

    const delta = await categorizeDelta(
      makeDeltaInput(SINGLE_LINE_CHANGE),
      makeFakeGenerator(answer),
    );

    expect(delta.chunks.map((chunk) => chunk.id)).toEqual(["c1", "c2", "c3"]);
    const warnings = delta.generationWarnings?.join("\n") ?? "";
    expect(warnings).toContain(
      "chunk c2 (a.ts): no range left on a changed line of the span",
    );
    expect(warnings).not.toContain("chunk c3 (a.ts): no range left");
  });

  it("snaps a delta range over its statement's tail and counts it", async () => {
    const answer = stubDeltaAnswer([
      { addedRanges: [{ start: 2, end: 2 }], removedRanges: [] },
    ]);

    const delta = await categorizeDelta(
      makeDeltaInput(ADDED_STATEMENT),
      makeFakeGenerator(answer),
    );

    expect(delta.chunks[0]).toMatchObject({
      addedRanges: [{ start: 2, end: 5 }],
      loc: { added: 4, deleted: 0 },
    });
  });

  it("clips a narrative chunk on a file only the brief holds", async () => {
    const answer = stubNarrativeAnswer([
      {
        addedRanges: [{ start: 11, end: 11 }],
        removedRanges: [{ start: 11, end: 11 }],
      },
      { file: "b.ts", addedRanges: [{ start: 5, end: 5 }], removedRanges: [] },
    ]);

    const narrative = await categorizeRevisionNarrative(
      {
        ...makeNarrativeInput(SINGLE_LINE_CHANGE),
        brief: makeTwoGroupBrief(),
        marksFiles: parseChangedRanges(SINGLE_LINE_CHANGE),
      },
      makeFakeGenerator(answer),
    );

    expect(narrative.chunks[1]).toMatchObject({
      file: "b.ts",
      addedRanges: [],
      removedRanges: [],
    });
    expect(narrative.generationWarnings?.join("\n")).toContain(
      "revision narrative marks overlap",
    );
  });
});
