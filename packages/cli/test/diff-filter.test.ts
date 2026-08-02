// Table-driven hunk-filter units (BRIEF-17 PR 6, test-first): the `--group`
// filter keeps WHOLE hunks only (a trimmed hunk would not `git apply`),
// joins brief chunk ranges — `addedRanges` against the hunk's NEW side,
// `removedRanges` against its OLD side — and reports chunk files missing
// from the diff so the command can fail loud.
import { describe, expect, it } from "vitest";
import {
  filterDiffByChunks,
  type ChunkSpan,
} from "../src/commands/diff-filter";

function diffOf(...sections: string[]): string {
  return sections.join("");
}

function fileSection(path: string, hunks: string[]): string {
  return (
    `diff --git a/${path} b/${path}\n` +
    `index 1111111..2222222 100644\n` +
    `--- a/${path}\n` +
    `+++ b/${path}\n` +
    hunks.join("")
  );
}

/** A hunk with `count` context/add lines starting at old/new line numbers. */
function hunk(
  oldStart: number,
  oldCount: number,
  newStart: number,
  newCount: number,
  lines: string[],
): string {
  return (
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n` +
    lines.map((l) => `${l}\n`).join("")
  );
}

const CHUNK_A: ChunkSpan = {
  file: "src/a.ts",
  addedRanges: [{ start: 10, end: 12 }],
  removedRanges: [],
};

describe("filterDiffByChunks", () => {
  it("keeps a whole hunk whose new side intersects an addedRange", () => {
    const input = diffOf(
      fileSection("src/a.ts", [
        hunk(8, 3, 8, 5, [" ctx", "+added one", "+added two", " ctx", " ctx"]),
        hunk(40, 2, 42, 2, [" ctx", " ctx"]),
      ]),
    );
    const { diff, missingFiles } = filterDiffByChunks(input, [CHUNK_A]);
    expect(missingFiles).toEqual([]);
    // First hunk (new side 8..12) intersects 10..12 → kept whole.
    expect(diff).toContain("@@ -8,3 +8,5 @@");
    expect(diff).toContain("+added two");
    // Second hunk (42..43) does not → dropped.
    expect(diff).not.toContain("@@ -40,2 +42,2 @@");
    // File headers survive for the kept file.
    expect(diff).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(diff).toContain("+++ b/src/a.ts");
  });

  it("matches removedRanges against the OLD side (pure deletions)", () => {
    const chunk: ChunkSpan = {
      file: "src/b.ts",
      addedRanges: [],
      removedRanges: [{ start: 5, end: 6 }],
    };
    const input = fileSection("src/b.ts", [
      // Pure deletion hunk: old 5..6 removed, new side empty (count 0).
      hunk(5, 2, 4, 0, ["-gone one", "-gone two"]),
      hunk(30, 2, 28, 2, [" ctx", " ctx"]),
    ]);
    const { diff } = filterDiffByChunks(input, [chunk]);
    expect(diff).toContain("@@ -5,2 +4,0 @@");
    expect(diff).not.toContain("@@ -30,2 +28,2 @@");
  });

  it("drops whole files with no intersecting hunk and never trims a kept hunk", () => {
    const input = diffOf(
      fileSection("src/a.ts", [
        hunk(9, 4, 9, 4, [" ctx", "-old", "+new", " ctx"]),
      ]),
      fileSection("src/unrelated.ts", [
        hunk(1, 2, 1, 3, [" ctx", "+x", " ctx"]),
      ]),
    );
    const { diff } = filterDiffByChunks(input, [CHUNK_A]);
    expect(diff).not.toContain("unrelated");
    // The kept hunk arrives byte-identical (whole — every line, both sides).
    expect(diff).toContain(" ctx\n-old\n+new\n ctx\n");
  });

  it("handles multiple chunks and files (multi-hunk joins)", () => {
    const chunks: ChunkSpan[] = [
      CHUNK_A,
      {
        file: "src/c.ts",
        addedRanges: [{ start: 1, end: 2 }],
        removedRanges: [],
      },
    ];
    const input = diffOf(
      fileSection("src/a.ts", [hunk(10, 1, 10, 2, [" ctx", "+in-range"])]),
      fileSection("src/c.ts", [hunk(1, 1, 1, 2, [" ctx", "+also"])]),
    );
    const { diff, missingFiles } = filterDiffByChunks(input, chunks);
    expect(missingFiles).toEqual([]);
    expect(diff).toContain("b/src/a.ts");
    expect(diff).toContain("b/src/c.ts");
  });

  it("boundary lines count: touching exactly the range edge keeps the hunk", () => {
    // Hunk new side 12..14; chunk addedRange ends at 12 — single-line overlap.
    const input = fileSection("src/a.ts", [
      hunk(12, 3, 12, 3, [" ctx", " ctx", " ctx"]),
    ]);
    const { diff } = filterDiffByChunks(input, [CHUNK_A]);
    expect(diff).toContain("@@ -12,3 +12,3 @@");
  });

  it("reports chunk files entirely absent from the diff", () => {
    const chunks: ChunkSpan[] = [
      CHUNK_A,
      {
        file: "src/gone.ts",
        addedRanges: [{ start: 1, end: 1 }],
        removedRanges: [],
      },
    ];
    const input = fileSection("src/a.ts", [hunk(10, 1, 10, 1, [" ctx"])]);
    const { missingFiles } = filterDiffByChunks(input, chunks);
    expect(missingFiles).toEqual(["src/gone.ts"]);
  });

  it("handles renames (new-side path is the chunk's file)", () => {
    const input =
      "diff --git a/src/old-name.ts b/src/a.ts\n" +
      "similarity index 90%\n" +
      "rename from src/old-name.ts\n" +
      "rename to src/a.ts\n" +
      "--- a/src/old-name.ts\n" +
      "+++ b/src/a.ts\n" +
      hunk(10, 2, 10, 3, [" ctx", "+added", " ctx"]);
    const { diff, missingFiles } = filterDiffByChunks(input, [CHUNK_A]);
    expect(missingFiles).toEqual([]);
    expect(diff).toContain("rename to src/a.ts");
  });

  it("single-line hunks with omitted counts (@@ -5 +7 @@) parse correctly", () => {
    const chunk: ChunkSpan = {
      file: "src/d.ts",
      addedRanges: [{ start: 7, end: 7 }],
      removedRanges: [],
    };
    const input =
      "diff --git a/src/d.ts b/src/d.ts\n" +
      "--- a/src/d.ts\n" +
      "+++ b/src/d.ts\n" +
      "@@ -5 +7 @@\n" +
      "+one\n";
    const { diff } = filterDiffByChunks(input, [chunk]);
    expect(diff).toContain("@@ -5 +7 @@");
  });
});
