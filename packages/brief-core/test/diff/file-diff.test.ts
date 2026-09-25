import { describe, expect, it } from "vitest";
import { splitDiffByFile } from "../../src/diff/file-diff";

const sample = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 export { a };
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-old
+new
`;

describe("splitDiffByFile", () => {
  const diffs = splitDiffByFile(sample);

  it("splits into one entry per file", () => {
    expect(diffs.map((d) => d.file)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("keeps each file's patch self-contained", () => {
    const a = diffs.find((d) => d.file === "src/a.ts");
    expect(a?.patch).toContain("+const b = 2;");
    expect(a?.patch).not.toContain("src/b.ts");
  });

  it("returns an empty array for an empty diff", () => {
    expect(splitDiffByFile("")).toEqual([]);
  });
});
