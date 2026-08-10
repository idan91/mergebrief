// Whole-PR live-diff handling: the diff proxy returns ONE unified diff across
// files; the client splits it per file and slices each chunk's rows with the
// shared diffSlicing module.
import { describe, expect, it } from "vitest";
import type { Brief, BriefChunk } from "../../brief/types";
import { attachLiveDiffs, splitUnifiedDiffByFile } from "./liveDiff";

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

  it("keys a deleted file by its pre-change path (post side is /dev/null)", () => {
    const files = splitUnifiedDiffByFile(MULTI_FILE_DIFF);
    expect(files.get("gone.txt")).toContain("-bye");
  });

  it("returns an empty map for an empty body", () => {
    expect(splitUnifiedDiffByFile("").size).toBe(0);
  });
});

function chunk(overrides: Partial<BriefChunk>): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/app.ts",
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 1 },
    addedRanges: [{ start: 1, end: 1 }],
    removedRanges: [{ start: 1, end: 1 }],
    riskSurface: [],
    ...overrides,
  };
}

function brief(chunks: BriefChunk[]): Brief {
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

describe("attachLiveDiffs", () => {
  it("attaches sliced rows to chunks whose file is in the diff; others untouched", () => {
    const briefValue = brief([
      chunk({}),
      chunk({ id: "c2", file: "not/in/diff.ts" }),
    ]);
    const attached = attachLiveDiffs(briefValue, MULTI_FILE_DIFF);

    const withDiff = attached.chunks[0];
    expect(withDiff?.diff?.some((row) => row.content === "const a = 10;")).toBe(
      true,
    );
    // Chunk without a matching file keeps the legal no-diff shape.
    expect(attached.chunks[1]?.diff).toBeUndefined();
    // Input is not mutated.
    expect(briefValue.chunks[0]?.diff).toBeUndefined();
  });

  it("returns the brief unchanged for an empty diff body", () => {
    const briefValue = brief([chunk({})]);
    expect(attachLiveDiffs(briefValue, "")).toBe(briefValue);
  });
});
