import { splitUnifiedDiffByFile } from "brief-core/chunk-layout";
import { describe, expect, it } from "vitest";
import { attachSlicedDiffs, attachSpanDiffs } from "./diff-slicing";
import { createFileRowsCache } from "../file-rows/cache";
import type { Brief, BriefChunk } from "../types";

function stubChunk(overrides: Partial<BriefChunk>): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/app.ts",
    concern: "implementation",
    role: "core",
    loc: { added: 2, deleted: 1 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    ...overrides,
  };
}

const MULTI_FILE_DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,2 @@",
  "-const a = 1;",
  "+const a = 10;",
  " const b = 2;",
  "diff --git a/docs/readme.md b/docs/readme.md",
  "index 3333333..4444444 100644",
  "--- a/docs/readme.md",
  "+++ b/docs/readme.md",
  "@@ -5,1 +5,2 @@",
  " intro",
  "+added line",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "index 5555555..0000000",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1,1 +0,0 @@",
  "-bye",
].join("\n");

function stubBrief(chunks: BriefChunk[]): Brief {
  return {
    artifactKind: "brief",
    pr: {
      repo: "octo/hello",
      number: 7,
      title: "t",
      url: "https://github.com/octo/hello/pull/7",
      sha: "head",
      description: "",
    },
    summary: "s",
    changeGroups: [],
    chunks,
    concernView: [],
  };
}

describe("attachSlicedDiffs", () => {
  const stubCache = () =>
    createFileRowsCache(splitUnifiedDiffByFile(MULTI_FILE_DIFF));

  it("slices rows onto chunks whose file the diff carries, leaves the rest", () => {
    const brief = stubBrief([
      stubChunk({ addedRanges: [{ start: 1, end: 1 }] }),
      stubChunk({ id: "c2", file: "not/in/diff.ts" }),
    ]);
    const attached = attachSlicedDiffs(brief, stubCache());

    expect(
      attached.chunks[0]?.diff?.some((row) => row.content === "const a = 10;"),
    ).toBe(true);
    expect(attached.chunks[1]?.diff).toBeUndefined();
    expect(brief.chunks[0]?.diff).toBeUndefined();
  });

  it("slices the unattributed remainder the same way", () => {
    const brief = stubBrief([]);
    brief.unattributed = [
      {
        file: "docs/readme.md",
        addedRanges: [{ start: 6, end: 6 }],
        removedRanges: [],
      },
    ];
    const attached = attachSlicedDiffs(brief, stubCache());

    expect(attached.unattributed?.[0]?.diff?.map((row) => row.kind)).toEqual([
      "hunk",
      "ctx",
      "add",
    ]);
  });

  it("parses and slices a chunk's rows on first read and keeps them", () => {
    let parses = 0;
    const patches = new Map(splitUnifiedDiffByFile(MULTI_FILE_DIFF));
    const readPatch = patches.get.bind(patches);
    patches.get = (path: string) => {
      parses += 1;
      return readPatch(path);
    };
    const brief = attachSlicedDiffs(
      stubBrief([stubChunk({ addedRanges: [{ start: 1, end: 1 }] })]),
      createFileRowsCache(patches),
    );
    const chunk = brief.chunks[0];

    expect(parses).toBe(0);
    expect(Object.keys(chunk ?? {})).toContain("diff");
    const first = chunk?.diff;
    expect(first?.map((row) => row.content)).toEqual([
      "@@ -1,2 +1,2 @@",
      "const a = 1;",
      "const a = 10;",
      "const b = 2;",
    ]);
    expect(chunk?.diff).toBe(first);
    expect(parses).toBe(1);
  });

  it("lets a caller replace a sliced chunk's rows", () => {
    const cache = createFileRowsCache(splitUnifiedDiffByFile(MULTI_FILE_DIFF));
    const brief = attachSlicedDiffs(
      stubBrief([stubChunk({ addedRanges: [{ start: 1, end: 1 }] })]),
      cache,
    );
    const chunk = brief.chunks[0];
    if (chunk === undefined) {
      throw new Error("expected a chunk");
    }

    chunk.diff = [];

    expect(chunk.diff).toEqual([]);
  });

  it("returns the brief itself when the cache holds no file", () => {
    const brief = stubBrief([stubChunk({})]);

    expect(attachSlicedDiffs(brief, createFileRowsCache(new Map()))).toBe(
      brief,
    );
  });
});

/** A checkpoint to head span: the left side is the checkpoint file. */
const SPAN_DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -8,4 +8,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 20;",
  " const d = 4;",
  " const e = 5;",
].join("\n");

describe("attachSpanDiffs", () => {
  const stubSpanCache = () =>
    createFileRowsCache(splitUnifiedDiffByFile(SPAN_DIFF));

  it("gives a delta chunk its span rows as guest rows, del and add alike", () => {
    const delta = stubBrief([
      stubChunk({
        addedRanges: [{ start: 9, end: 9 }],
        removedRanges: [{ start: 9, end: 9 }],
      }),
    ]);
    const attached = attachSpanDiffs(delta, stubSpanCache());
    const rows = attached.chunks[0]?.diff ?? [];

    expect(rows.map((row) => [row.kind, row.content])).toEqual([
      ["hunk", "@@ -8,4 +8,4 @@"],
      ["ctx", "const a = 1;"],
      ["del", "const b = 2;"],
      ["add", "const b = 20;"],
      ["ctx", "const d = 4;"],
      ["ctx", "const e = 5;"],
    ]);
    expect(rows.every((row) => row.origin === "guest")).toBe(true);
    expect(delta.chunks[0]?.diff).toBeUndefined();
  });

  it("tags a remainder entry's rows as guest rows too", () => {
    const delta: Brief = {
      ...stubBrief([]),
      unattributed: [
        {
          file: "src/app.ts",
          addedRanges: [{ start: 9, end: 9 }],
          removedRanges: [],
        },
      ],
    };
    const attached = attachSpanDiffs(delta, stubSpanCache());
    const rows = attached.unattributed?.[0]?.diff ?? [];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.origin === "guest")).toBe(true);
  });

  it("leaves a chunk whose file the span does not carry without rows", () => {
    const delta = stubBrief([stubChunk({ id: "c2", file: "not/in/diff.ts" })]);

    expect(
      attachSpanDiffs(delta, stubSpanCache()).chunks[0]?.diff,
    ).toBeUndefined();
  });
});
