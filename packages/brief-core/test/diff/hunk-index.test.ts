import { describe, expect, it } from "vitest";
import { indexDiff } from "../../src/diff/hunk-index";
import { parsePatchRows } from "../../src/diff/patch-rows";
import { splitDiffByFile } from "../../src/diff/file-diff";

const twoHunks = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 export { a };

@@ -20,2 +21,2 @@ function tail() {
-  return 1;
+  return 2;
 }
`;

const binary = `diff --git a/img/logo.png b/img/logo.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/img/logo.png differ
`;

const pureRename = `diff --git a/src/old.ts b/src/new.ts
similarity index 100%
rename from src/old.ts
rename to src/new.ts
`;

const renameWithEdit = `diff --git a/src/before.ts b/src/after.ts
similarity index 90%
rename from src/before.ts
rename to src/after.ts
index 333..444 100644
--- a/src/before.ts
+++ b/src/after.ts
@@ -1 +1 @@
-old
+new
`;

const deleted = `diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 555..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two
`;

const noNewline = `diff --git a/README.md b/README.md
index 666..777 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;

describe("indexDiff", () => {
  it("numbers files in diff order and hunks within each file", () => {
    const files = indexDiff(twoHunks + binary);

    expect(files.map((file) => file.id)).toEqual(["f1", "f2"]);
    expect(files[0]?.hunks.map((hunk) => hunk.id)).toEqual(["f1h1", "f1h2"]);
  });

  it("keeps each hunk's header, body and line counts", () => {
    const [file] = indexDiff(twoHunks);
    const second = file?.hunks[1];

    expect(second?.header).toBe("@@ -20,2 +21,2 @@ function tail() {");
    expect(second?.lines).toEqual(["-  return 1;", "+  return 2;", " }"]);
    expect(file?.hunks.map((hunk) => [hunk.added, hunk.removed])).toEqual([
      [1, 0],
      [1, 1],
    ]);
    expect([file?.added, file?.removed]).toEqual([2, 1]);
  });

  it("keeps the lines before the first hunk as the file header", () => {
    const [file] = indexDiff(twoHunks);

    expect(file?.headerLines).toEqual([
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
    ]);
  });

  it("gives a binary file one placeholder hunk with no header", () => {
    const [file] = indexDiff(binary);

    expect(file?.binary).toBe(true);
    expect(file?.status).toBe("added");
    expect(file?.hunks).toEqual([
      { id: "f1h1", lines: [], added: 0, removed: 0 },
    ]);
  });

  it("gives a pure rename one placeholder hunk and its previous path", () => {
    const [file] = indexDiff(pureRename);

    expect(file?.status).toBe("renamed");
    expect(file?.path).toBe("src/new.ts");
    expect(file?.previousPath).toBe("src/old.ts");
    expect(file?.binary).toBe(false);
    expect(file?.hunks.map((hunk) => hunk.header)).toEqual([undefined]);
  });

  it("keeps the text hunks of a rename that also edits the file", () => {
    const [file] = indexDiff(renameWithEdit);

    expect(file?.status).toBe("renamed");
    expect(file?.previousPath).toBe("src/before.ts");
    expect(file?.hunks.map((hunk) => hunk.header)).toEqual(["@@ -1 +1 @@"]);
  });

  it("reads a deleted file's status and removed lines", () => {
    const [file] = indexDiff(deleted);

    expect(file?.status).toBe("deleted");
    expect([file?.added, file?.removed]).toEqual([0, 2]);
  });

  it("reads a plain edit as modified", () => {
    expect(indexDiff(twoHunks)[0]?.status).toBe("modified");
  });

  it("keeps no-newline markers out of the line counts", () => {
    const [hunk] = indexDiff(noNewline)[0]?.hunks ?? [];

    expect(hunk?.lines).toContain("\\ No newline at end of file");
    expect([hunk?.added, hunk?.removed]).toEqual([1, 1]);
  });

  it("splits hunks where the patch row walk does", () => {
    const [fileDiff] = splitDiffByFile(twoHunks);
    const rows = parsePatchRows(fileDiff?.patch ?? "");
    const rowHunks = new Set(rows.map((row) => row.hunk));

    expect(indexDiff(twoHunks)[0]?.hunks).toHaveLength(rowHunks.size);
  });

  it("returns no files for an empty diff", () => {
    expect(indexDiff("")).toEqual([]);
  });
});
