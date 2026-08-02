import { describe, expect, it } from "vitest";
import {
  buildRevisionChanges,
  parseChangedRanges,
} from "../../src/diff/revchanges";

// File a: a modification (del + 2 adds) in one hunk, plus a non-contiguous add
// in a second hunk. File b: a brand-new file (all additions).
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
@@ -50,2 +51,3 @@
 ctxC
+added line 3
 ctxD
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 000..333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+first
+second
`;

describe("parseChangedRanges", () => {
  const files = parseChangedRanges(sample);

  it("returns one entry per changed file", () => {
    expect(files.map((f) => f.file)).toEqual(["src/a.ts", "src/new.ts"]);
  });

  it("records added lines in head (new-side) coords, coalescing per run", () => {
    const a = files.find((f) => f.file === "src/a.ts");
    // adds at new-lines 31,32 (one run) and 52 (separate run after context)
    expect(a?.addedRanges).toEqual([
      { start: 31, end: 32 },
      { start: 52, end: 52 },
    ]);
  });

  it("records removed lines in prevHead (old-side) coords", () => {
    const a = files.find((f) => f.file === "src/a.ts");
    expect(a?.removedRanges).toEqual([{ start: 31, end: 31 }]);
  });

  it("does not count the ---/+++/diff --git header lines as changes", () => {
    // a new file's only adds are its content lines (1,2) — never a line 0 from
    // the `+++ b/...` header, which sits before the first hunk.
    const b = files.find((f) => f.file === "src/new.ts");
    expect(b?.addedRanges).toEqual([{ start: 1, end: 2 }]);
    expect(b?.removedRanges).toEqual([]);
  });

  it("returns an empty array for an empty diff", () => {
    expect(parseChangedRanges("")).toEqual([]);
  });
});

describe("buildRevisionChanges", () => {
  it("wraps the parsed files with head/prevHead/index metadata", () => {
    const rc = buildRevisionChanges("a01bcf1d", "35788079", 1, sample);
    expect(rc.headSha).toBe("a01bcf1d");
    expect(rc.prevHeadSha).toBe("35788079");
    expect(rc.prevIndex).toBe(1);
    expect(rc.files).toHaveLength(2);
  });
});
