import { describe, expect, it } from "vitest";
import { splitDiffByFile } from "../../src/diff/file-diff";
import {
  LOOKALIKE_QUOTED_FILES,
  MOVED_INTO_SPACED_PATH,
  QUOTED_PATCH,
  QUOTED_PATH,
  RENAME_LIKE_SPACED_EDIT,
  RENAMED_INTO_SPACED_PATH,
} from "./chunk-layout/helpers";

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

  it("reads a git-quoted header as the path it encodes", () => {
    const files = splitDiffByFile(`${sample}${QUOTED_PATCH}\n`);

    expect(files.map((d) => d.file)).toEqual([
      "src/a.ts",
      "src/b.ts",
      QUOTED_PATH,
    ]);
  });

  it("keeps two files apart when one decodes to the other's spelling", () => {
    const files = splitDiffByFile(LOOKALIKE_QUOTED_FILES).map((d) => d.file);

    expect(new Set(files).size).toBe(2);
  });

  it.each([
    ["an edit", RENAMED_INTO_SPACED_PATH],
    ["no edit", MOVED_INTO_SPACED_PATH],
  ])("keys a rename into a path holding b/ by its new path, %s", (_, patch) => {
    expect(splitDiffByFile(`${patch}\n`).map((d) => d.file)).toEqual([
      "dir b/new.ts",
    ]);
  });

  it("keeps a rename apart from an edit its header reads as", () => {
    const files = splitDiffByFile(`${RENAME_LIKE_SPACED_EDIT}\n`);

    expect(files.map((d) => d.file)).toEqual(["y", "x b/y"]);
  });

  it("returns an empty array for an empty diff", () => {
    expect(splitDiffByFile("")).toEqual([]);
  });
});
