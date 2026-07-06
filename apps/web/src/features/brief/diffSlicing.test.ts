// Unit tests for the pure diff-slicing module (BRIEF-19 PR 3.1). The behavior
// was previously private to brief.server.ts and covered only through the
// local-brief server functions; the DB-brief path slices the LIVE diff on the
// client, so the logic moves to this shared module. Expected values are worked
// examples from the unified-diff format, not recomputations.
import { describe, expect, it } from "vitest";
import { parseUnifiedDiffPatch, sliceChunkDiff } from "./diffSlicing";
import type { BriefChunk } from "./types";

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

function chunk(overrides: Partial<BriefChunk>): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/app.ts",
    concern: "implementation",
    role: "carrier",
    loc: { added: 2, deleted: 1 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    ...overrides,
  };
}

describe("parseUnifiedDiffPatch", () => {
  it("parses hunks, adds, dels, context, and no-newline notes with line numbers", () => {
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

  it("returns an empty list for an empty patch body", () => {
    expect(parseUnifiedDiffPatch("")).toEqual([
      { kind: "ctx", content: "", oldLine: 0, newLine: 0 },
    ]);
  });
});

describe("sliceChunkDiff", () => {
  const rows = parseUnifiedDiffPatch(PATCH);

  it("selects changed rows in the chunk's ranges plus ±2 context and the hunk header", () => {
    const sliced = sliceChunkDiff(
      rows,
      chunk({
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
      chunk({ addedRanges: [{ start: 999, end: 999 }], removedRanges: [] }),
    );
    expect(sliced).toEqual([]);
  });
});
