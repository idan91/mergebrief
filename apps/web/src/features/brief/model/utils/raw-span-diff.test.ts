import { describe, expect, it } from "vitest";

import { buildRawSpanDiffChunks } from "./raw-span-diff";
import { createI18n } from "i18n";

const t = createI18n().t;

const TWO_FILE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "+validate(a);",
  " export { a };",
  "diff --git a/src/b.ts b/src/b.ts",
  "index 333..444 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1,2 +1,1 @@",
  " const b = 2;",
  "-legacy(b);",
].join("\n");

describe("buildRawSpanDiffChunks", () => {
  it("emits one guest chunk per file with parsed display rows", () => {
    const chunks = buildRawSpanDiffChunks(t, TWO_FILE_DIFF);
    expect(chunks.map((chunk) => chunk.file)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(chunks.map((chunk) => chunk.id)).toEqual([
      "raw:src/a.ts",
      "raw:src/b.ts",
    ]);

    const [first, second] = chunks;
    expect(first?.diff).toContainEqual({
      kind: "add",
      origin: "guest",
      content: "validate(a);",
      newLine: 2,
    });
    expect(first?.loc).toEqual({ added: 1, deleted: 0 });
    expect(second?.loc).toEqual({ added: 0, deleted: 1 });
    expect(second?.diff).toContainEqual({
      kind: "del",
      origin: "guest",
      content: "legacy(b);",
      oldLine: 2,
    });
  });

  it("claims no comment ranges, every row anchors to its owner", () => {
    const chunks = buildRawSpanDiffChunks(t, TWO_FILE_DIFF);
    for (const chunk of chunks) {
      expect(chunk.addedRanges).toEqual([]);
      expect(chunk.removedRanges).toEqual([]);
    }
  });

  it("renders a mode-only change as metadata notes, not garbled context rows", () => {
    const diff = [
      "diff --git a/bin/run.sh b/bin/run.sh",
      "old mode 100644",
      "new mode 100755",
    ].join("\n");
    const [chunk] = buildRawSpanDiffChunks(t, diff);
    expect(chunk?.file).toBe("bin/run.sh");
    expect(chunk?.diff).toEqual([
      { kind: "note", origin: "guest", content: "old mode 100644" },
      { kind: "note", origin: "guest", content: "new mode 100755" },
    ]);
  });

  it("renders a binary diff as a metadata note", () => {
    const diff = [
      "diff --git a/img.png b/img.png",
      "index 1111111..2222222 100644",
      "Binary files a/img.png and b/img.png differ",
    ].join("\n");
    const [chunk] = buildRawSpanDiffChunks(t, diff);
    expect(chunk?.diff).toEqual([
      {
        kind: "note",
        origin: "guest",
        content: "Binary files a/img.png and b/img.png differ",
      },
    ]);
  });

  it("renders an empty-file creation header-only patch as a metadata note", () => {
    const diff = [
      "diff --git a/new.txt b/new.txt",
      "new file mode 100644",
      "index 0000000..e69de29",
      "--- /dev/null",
      "+++ b/new.txt",
    ].join("\n");
    const [chunk] = buildRawSpanDiffChunks(t, diff);
    // Never an empty panel: the parser returns zero rows here, so without the
    // fallback DiffTable would show its (wrong-context) unavailable copy.
    expect(chunk?.diff).toEqual([
      { kind: "note", origin: "guest", content: "new file mode 100644" },
    ]);
  });

  it("renders a rename-with-edits patch as notes then hunks, never code", () => {
    // The mixed shape: rename metadata followed by real hunks. The metadata
    // must come out as note rows ahead of the parsed hunk, never as context
    // rows wearing 0-based line numbers.
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
      "index 1111111..2222222 100644",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1,2 +1,2 @@",
      " const a = 1;",
      "-legacy(a);",
      "+validate(a);",
    ].join("\n");
    const [chunk] = buildRawSpanDiffChunks(t, diff);
    expect(chunk?.file).toBe("new.ts");
    expect(chunk?.diff?.slice(0, 4)).toEqual([
      { kind: "note", origin: "guest", content: "similarity index 90%" },
      { kind: "note", origin: "guest", content: "rename from old.ts" },
      { kind: "note", origin: "guest", content: "rename to new.ts" },
      { kind: "hunk", origin: "guest", content: "@@ -1,2 +1,2 @@" },
    ]);
    expect(chunk?.diff).toContainEqual({
      kind: "add",
      origin: "guest",
      content: "validate(a);",
      newLine: 2,
    });
    expect(chunk?.diff).toContainEqual({
      kind: "del",
      origin: "guest",
      content: "legacy(a);",
      oldLine: 2,
    });
    expect(
      chunk?.diff?.some(
        (row) => row.kind === "ctx" && row.content.startsWith("rename"),
      ),
    ).toBe(false);
    expect(chunk?.loc).toEqual({ added: 1, deleted: 1 });
  });

  it("keeps parsed hunks untouched, the fallback only fires without hunks", () => {
    const chunks = buildRawSpanDiffChunks(t, TWO_FILE_DIFF);
    for (const chunk of chunks) {
      expect(chunk.diff?.some((row) => row.kind === "hunk")).toBe(true);
      expect(chunk.diff?.some((row) => row.kind === "note")).toBe(false);
    }
  });
});
