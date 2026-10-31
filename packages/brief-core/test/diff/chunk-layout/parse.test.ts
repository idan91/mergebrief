import { describe, expect, it } from "vitest";
import {
  parseUnifiedDiffPatch,
  splitUnifiedDiffByFile,
} from "../../../src/diff/chunk-layout";
import { splitDiffByFile } from "../../../src/diff/file-diff";
import {
  DELETED_QUOTED_FILE,
  LOOKALIKE_QUOTED_FILES,
  MOVED_INTO_SPACED_PATH,
  PATCH,
  QUOTED_PATCH,
  QUOTED_PATH,
  RENAME_LIKE_SPACED_EDIT,
  RENAMED_INTO_SPACED_PATH,
} from "./helpers";

describe("parseUnifiedDiffPatch", () => {
  it("parses hunks, adds, dels, context and no-newline notes with numbers", () => {
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

  it("keeps a removed or added line that starts with two dashes or pluses", () => {
    const rows = parseUnifiedDiffPatch(
      ["@@ -1,2 +1,2 @@", "--- foo", "+++ bar", " keep"].join("\n"),
    );

    expect(rows).toEqual([
      { kind: "hunk", content: "@@ -1,2 +1,2 @@" },
      { kind: "del", content: "-- foo", oldLine: 1 },
      { kind: "add", content: "++ bar", newLine: 1 },
      { kind: "ctx", content: "keep", oldLine: 2, newLine: 2 },
    ]);
  });

  it("returns an empty list for an empty patch body", () => {
    expect(parseUnifiedDiffPatch("")).toEqual([]);
  });

  it("drops the empty line behind the final newline, never a phantom row", () => {
    const rows = parseUnifiedDiffPatch("@@ -0,0 +1,2 @@\n+a\n+b\n");

    expect(rows).toEqual([
      { kind: "hunk", content: "@@ -0,0 +1,2 @@" },
      { kind: "add", content: "a", newLine: 1 },
      { kind: "add", content: "b", newLine: 2 },
    ]);
  });
});

describe("parseUnifiedDiffPatch with git extended headers", () => {
  it("ignores every header line before a file's first hunk", () => {
    const rows = parseUnifiedDiffPatch(
      [
        "diff --git a/src/old.ts b/src/new.ts",
        "similarity index 92%",
        "rename from src/old.ts",
        "rename to src/new.ts",
        "old mode 100644",
        "new mode 100755",
        "--- a/src/old.ts",
        "+++ b/src/new.ts",
        "@@ -3,2 +3,2 @@",
        " keep",
        "-old",
        "+new",
      ].join("\n"),
    );

    expect(rows.map((row) => row.kind)).toEqual(["hunk", "ctx", "del", "add"]);
    expect(rows[1]).toMatchObject({ oldLine: 3, newLine: 3 });
  });

  it("yields no rows for a binary or mode-only file", () => {
    const rows = parseUnifiedDiffPatch(
      ["diff --git a/logo.png b/logo.png", "Binary files differ"].join("\n"),
    );

    expect(rows).toEqual([]);
  });
});

const MULTI_FILE_DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,2 @@",
  "-const a = 1;",
  "+const a = 10;",
  " const b = 2;",
  "diff --git a/docs/readme.md b/docs/readme.md",
  "index 3333333..4444444 100644",
  "--- a/docs/readme.md",
  "+++ b/docs/readme.md",
  "@@ -5,1 +5,2 @@",
  " intro",
  "+added line",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "index 5555555..0000000",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1,1 +0,0 @@",
  "-bye",
].join("\n");

describe("splitUnifiedDiffByFile", () => {
  it("splits per file, keyed by the post-change path", () => {
    const files = splitUnifiedDiffByFile(MULTI_FILE_DIFF);

    expect([...files.keys()]).toEqual([
      "src/app.ts",
      "docs/readme.md",
      "gone.txt",
    ]);
    expect(files.get("src/app.ts")).toContain("+const a = 10;");
    expect(files.get("src/app.ts")).not.toContain("readme");
    expect(files.get("docs/readme.md")).toContain("+added line");
  });

  it("keys a deleted file by its pre-change path", () => {
    const files = splitUnifiedDiffByFile(MULTI_FILE_DIFF);

    expect(files.get("gone.txt")).toContain("-bye");
  });

  it("keys a deleted quoted file by the path the brief's chunks name", () => {
    const files = splitUnifiedDiffByFile(DELETED_QUOTED_FILE);
    const [briefFile] = splitDiffByFile(DELETED_QUOTED_FILE);

    expect([...files.keys()]).toEqual(['"b/x\\ny"']);
    expect(briefFile?.file).toBe('"b/x\\ny"');
  });

  it("keys a git-quoted file by the path it encodes, apart from the last", () => {
    const files = splitUnifiedDiffByFile(`${PATCH}\n${QUOTED_PATCH}`);

    expect([...files.keys()]).toEqual(["src/app.ts", QUOTED_PATH]);
    expect(files.get("src/app.ts")).not.toContain("return 2;");
    expect(files.get(QUOTED_PATH)).toContain("+  return 2;");
  });

  it("keeps two files apart when one decodes to the other's spelling", () => {
    const files = splitUnifiedDiffByFile(LOOKALIKE_QUOTED_FILES);

    expect(files.size).toBe(2);
  });

  it.each([
    ["an edit", RENAMED_INTO_SPACED_PATH],
    ["no edit", MOVED_INTO_SPACED_PATH],
  ])("keys a rename into a path holding b/ by its new path, %s", (_, patch) => {
    const files = splitUnifiedDiffByFile(`${PATCH}\n${patch}`);

    expect([...files.keys()]).toEqual(["src/app.ts", "dir b/new.ts"]);
  });

  it("keeps a rename apart from an edit its header reads as", () => {
    const files = splitUnifiedDiffByFile(RENAME_LIKE_SPACED_EDIT);

    expect([...files.keys()]).toEqual(["y", "x b/y"]);
    expect(files.get("x b/y")).toContain("+edited new");
  });

  it("returns an empty map for an empty body", () => {
    expect(splitUnifiedDiffByFile("").size).toBe(0);
  });
});
