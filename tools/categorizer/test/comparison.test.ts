import { describe, expect, it } from "vitest";
import { buildComparisonMarks, comparisonMarksName } from "../src/comparison.js";
import { splitDiffByFile } from "../src/diff.js";

const sample = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -30,3 +30,4 @@
 ctxA
-removed line
+added line 1
+added line 2
 ctxB
`;

describe("buildComparisonMarks", () => {
  it("keys the artifact by (baselineSha, headSha) and carries the baseline label/index", () => {
    const marks = buildComparisonMarks("head123", "base123", "previous-brief", 1, sample);
    expect(marks).toEqual({
      baselineSha: "base123",
      headSha: "head123",
      baselineLabel: "previous-brief",
      baselineIndex: 1,
      files: [
        {
          file: "src/a.ts",
          addedRanges: [{ start: 31, end: 32 }],
          removedRanges: [{ start: 31, end: 31 }],
        },
      ],
    });
  });

  it("supports the checkpoint baseline label with a null baseline index (unbriefed checkpoint)", () => {
    const marks = buildComparisonMarks("head123", "checkpoint000", "checkpoint", null, sample);
    expect(marks.baselineLabel).toBe("checkpoint");
    expect(marks.baselineIndex).toBeNull();
  });

  it("accepts already-split per-file patches, yielding the same marks as the raw diff", () => {
    const fromString = buildComparisonMarks("head123", "base123", "checkpoint", null, sample);
    const fromFiles = buildComparisonMarks(
      "head123",
      "base123",
      "checkpoint",
      null,
      splitDiffByFile(sample),
    );
    expect(fromFiles).toEqual(fromString);
  });
});

describe("comparisonMarksName", () => {
  const span = { baselineSha: "aaaa11110000", headSha: "bbbb22220000" };

  it("keys by baseline label + span, so checkpoint marks never clobber previous-brief marks when a checkpoint equals prevHead", () => {
    expect(comparisonMarksName("o-r-1", { ...span, baselineLabel: "previous-brief" })).toBe(
      "o-r-1_previous-brief_aaaa1111-bbbb2222.comparison.json",
    );
    expect(comparisonMarksName("o-r-1", { ...span, baselineLabel: "checkpoint" })).toBe(
      "o-r-1_checkpoint_aaaa1111-bbbb2222.comparison.json",
    );
  });
});
