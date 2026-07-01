import { describe, expect, it } from "vitest";
import { buildComparisonMarks } from "../src/comparison.js";

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
});
