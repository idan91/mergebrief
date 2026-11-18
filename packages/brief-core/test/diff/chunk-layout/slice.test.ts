import { describe, expect, it } from "vitest";
import {
  parseUnifiedDiffPatch,
  sliceChunkDiff,
} from "../../../src/diff/chunk-layout";
import { PATCH } from "./helpers";

describe("sliceChunkDiff", () => {
  const rows = parseUnifiedDiffPatch(PATCH);

  it("keeps the changed rows, two context rows around each, and the hunk", () => {
    const sliced = sliceChunkDiff(rows, {
      addedRanges: [{ start: 2, end: 3 }],
      removedRanges: [{ start: 2, end: 2 }],
    });
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
    const sliced = sliceChunkDiff(rows, {
      addedRanges: [{ start: 999, end: 999 }],
      removedRanges: [],
    });
    expect(sliced).toEqual([]);
  });
});
