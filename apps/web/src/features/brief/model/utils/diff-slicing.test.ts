// Unit tests for the pure diff-slicing module. Expected values are worked
// examples from the unified-diff format, not recomputations.
import { describe, expect, it } from "vitest";
import {
  attachSlicedDiffs,
  attachSpanDiffs,
  parseUnifiedDiffPatch,
  sliceChunkDiff,
  splitUnifiedDiffByFile,
} from "./diff-slicing";
import { createFileRowsCache } from "../file-rows/cache";
import type { Brief, BriefChunk } from "../types";

const PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,5 +1,6 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 20;",
  "+const c = 3;",
  " const d = 4;",
  " const e = 5;",
  "@@ -20,3 +21,4 @@",
  " function tail() {",
  "+  return 42;",
  " }",
  "\\ No newline at end of file",
].join("\n");

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

describe("parseUnifiedDiffPatch", () => {
  it("parses hunks, adds, dels, context and no-newline notes with numbers", () => {
    const rows = parseUnifiedDiffPatch(PATCH);

    // File headers are dropped entirely.
    expect(rows.some((row) => row.content.startsWith("diff --git"))).toBe(
      false,
    );
    expect(rows.filter((row) => row.kind === "hunk")).toHaveLength(2);

    const del = rows.find((row) => row.kind === "del");
    expect(del).toMatchObject({ content: "const b = 2;", oldLine: 2 });

    const adds = rows.filter((row) => row.kind === "add");
    expect(adds[0]).toMatchObject({ content: "const b = 20;", newLine: 2 });
    expect(adds[1]).toMatchObject({ content: "const c = 3;", newLine: 3 });

    // Second hunk restarts numbering from its header (+21).
    expect(adds[2]).toMatchObject({ content: "  return 42;", newLine: 22 });

    const note = rows.find((row) => row.kind === "note");
    expect(note?.content).toBe("\\ No newline at end of file");
  });

  it("keeps a removed or added line that starts with two dashes or pluses", () => {
    const rows = parseUnifiedDiffPatch(
      ["@@ -1,2 +1,2 @@", "--- foo", "+++ bar", " keep"].join("\n"),
    );

    expect(rows).toEqual([
      { kind: "hunk", content: "@@ -1,2 +1,2 @@" },
      { kind: "del", content: "-- foo", oldLine: 1 },
      { kind: "add", content: "++ bar", newLine: 1 },
      { kind: "ctx", content: "keep", oldLine: 2, newLine: 2 },
    ]);
  });

  it("returns an empty list for an empty patch body", () => {
    expect(parseUnifiedDiffPatch("")).toEqual([]);
  });

  it("drops the empty line behind the final newline, never a phantom row", () => {
    const rows = parseUnifiedDiffPatch("@@ -0,0 +1,2 @@\n+a\n+b\n");

    expect(rows).toEqual([
      { kind: "hunk", content: "@@ -0,0 +1,2 @@" },
      { kind: "add", content: "a", newLine: 1 },
      { kind: "add", content: "b", newLine: 2 },
    ]);
  });
});

describe("parseUnifiedDiffPatch with git extended headers", () => {
  it("ignores every header line before a file's first hunk", () => {
    const rows = parseUnifiedDiffPatch(
      [
        "diff --git a/src/old.ts b/src/new.ts",
        "similarity index 92%",
        "rename from src/old.ts",
        "rename to src/new.ts",
        "old mode 100644",
        "new mode 100755",
        "--- a/src/old.ts",
        "+++ b/src/new.ts",
        "@@ -3,2 +3,2 @@",
        " keep",
        "-old",
        "+new",
      ].join("\n"),
    );

    expect(rows.map((row) => row.kind)).toEqual(["hunk", "ctx", "del", "add"]);
    expect(rows[1]).toMatchObject({ oldLine: 3, newLine: 3 });
  });

  it("yields no rows for a binary or mode-only file", () => {
    const rows = parseUnifiedDiffPatch(
      ["diff --git a/logo.png b/logo.png", "Binary files differ"].join("\n"),
    );

    expect(rows).toEqual([]);
  });
});

describe("sliceChunkDiff", () => {
  const rows = parseUnifiedDiffPatch(PATCH);

  it("keeps the changed rows, two context rows around each, and the hunk", () => {
    const sliced = sliceChunkDiff(
      rows,
      stubChunk({
        addedRanges: [{ start: 2, end: 3 }],
        removedRanges: [{ start: 2, end: 2 }],
      }),
    );
    // First hunk header included; second hunk untouched.
    expect(sliced.filter((row) => row.kind === "hunk")).toHaveLength(1);
    expect(sliced[0]?.kind).toBe("hunk");
    expect(sliced.some((row) => row.content === "const b = 20;")).toBe(true);
    expect(sliced.some((row) => row.content === "const b = 2;")).toBe(true);
    // Context within ±2 rides along.
    expect(sliced.some((row) => row.content === "const a = 1;")).toBe(true);
    // Rows only in the second hunk are excluded.
    expect(sliced.some((row) => row.content === "  return 42;")).toBe(false);
  });

  it("returns [] when no changed row falls in the chunk's ranges", () => {
    const sliced = sliceChunkDiff(
      rows,
      stubChunk({ addedRanges: [{ start: 999, end: 999 }], removedRanges: [] }),
    );
    expect(sliced).toEqual([]);
  });
});

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

describe("splitUnifiedDiffByFile", () => {
  it("splits per file, keyed by the post-change path", () => {
    const files = splitUnifiedDiffByFile(MULTI_FILE_DIFF);

    expect([...files.keys()]).toEqual([
      "src/app.ts",
      "docs/readme.md",
      "gone.txt",
    ]);
    expect(files.get("src/app.ts")).toContain("+const a = 10;");
    expect(files.get("src/app.ts")).not.toContain("readme");
    expect(files.get("docs/readme.md")).toContain("+added line");
  });

  it("keys a deleted file by its pre-change path", () => {
    const files = splitUnifiedDiffByFile(MULTI_FILE_DIFF);

    expect(files.get("gone.txt")).toContain("-bye");
  });

  it("returns an empty map for an empty body", () => {
    expect(splitUnifiedDiffByFile("").size).toBe(0);
  });
});

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
