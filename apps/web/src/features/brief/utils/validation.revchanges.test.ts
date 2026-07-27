import { describe, expect, it } from "vitest";

import { parseRevisionChanges } from "./validation";

const valid = {
  headSha: "a01bcf1d",
  prevHeadSha: "35788079",
  prevIndex: 1,
  files: [
    {
      file: "src/a.ts",
      addedRanges: [{ start: 31, end: 32 }],
      removedRanges: [],
    },
    {
      file: "src/b.scss",
      addedRanges: [],
      removedRanges: [{ start: 45, end: 45 }],
    },
  ],
};

describe("parseRevisionChanges", () => {
  it("accepts a well-formed sidecar", () => {
    const result = parseRevisionChanges(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.prevIndex).toBe(1);
    expect(result.value.files).toHaveLength(2);
    expect(result.value.files[1]?.removedRanges).toEqual([
      { start: 45, end: 45 },
    ]);
  });

  it("rejects a missing prevIndex", () => {
    const { prevIndex: _drop, ...rest } = valid;
    expect(parseRevisionChanges(rest).ok).toBe(false);
  });

  it("rejects a malformed line range", () => {
    const bad = {
      ...valid,
      files: [
        {
          file: "src/a.ts",
          addedRanges: [{ start: "x", end: 2 }],
          removedRanges: [],
        },
      ],
    };
    expect(parseRevisionChanges(bad).ok).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(parseRevisionChanges(null).ok).toBe(false);
    expect(parseRevisionChanges("nope").ok).toBe(false);
  });
});
