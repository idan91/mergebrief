import { describe, expect, it } from "vitest";
import {
  LINE_DIFF_TIMEOUT_MS,
  MAX_LINE_DIFF_BYTES,
} from "../../../src/diff/pr-span/consts";
import {
  formatBetweenHeadsPatch,
  formatLineDiffPatch,
  isPastByteBound,
} from "../../../src/diff/pr-span/logic/line-diff";
import { parsePatchPaths } from "../../../src/diff/chunk-layout/logic/header-paths";
import { splitDiffByFile } from "../../../src/diff/file-diff";
import { parsePatchRows } from "../../../src/diff/patch-rows";

describe("formatBetweenHeadsPatch", () => {
  it("round-trips through splitDiffByFile and parsePatchRows", () => {
    const patch = formatBetweenHeadsPatch({
      prevPath: "src/a.ts",
      path: "src/a.ts",
      prevContent: "one\ntwo\nthree\n",
      newContent: "one\n2\nthree\nfour",
    });

    const [file] = splitDiffByFile(patch ?? "");
    expect(file?.file).toBe("src/a.ts");
    expect(parsePatchRows(file?.patch ?? "")).toEqual([
      { content: "one", oldLine: 1, newLine: 1, hunk: 0, patchLine: 4 },
      { content: "two", oldLine: 2, hunk: 0, patchLine: 5 },
      { content: "2", newLine: 2, hunk: 0, patchLine: 6 },
      { content: "three", oldLine: 3, newLine: 3, hunk: 0, patchLine: 7 },
      { content: "four", newLine: 4, hunk: 0, patchLine: 8 },
    ]);
    expect(patch).toContain("\\ No newline at end of file");
  });

  it.each(["docs/café notes.md", 'quote"and\\slash.ts', "docs/my file.ts"])(
    "writes a header the path reader reads back for %j",
    (path) => {
      const patch = formatBetweenHeadsPatch({
        prevPath: path,
        path,
        prevContent: "a\n",
        newContent: "b\n",
      });

      expect(parsePatchPaths(patch ?? "")).toEqual({ pre: path, post: path });
    },
  );

  it("writes dev null for a side the file is absent on", () => {
    const patch = formatBetweenHeadsPatch({
      prevPath: "n.ts",
      path: "n.ts",
      newContent: "a\n",
    });

    expect(patch).toContain("--- /dev/null");
    expect(patch).toContain("@@ -0,0 +1,1 @@");
  });

  it("names the mode of a file created or deleted between heads", () => {
    const created = formatBetweenHeadsPatch({
      prevPath: "n.ts",
      path: "n.ts",
      newContent: "a\n",
      newMode: "100755",
    });
    const deleted = formatBetweenHeadsPatch({
      prevPath: "n.ts",
      path: "n.ts",
      prevContent: "a\n",
      prevMode: "100644",
    });

    expect(created).toContain("new file mode 100755");
    expect(deleted).toContain("deleted file mode 100644");
  });

  it("refuses a diff past the edit length bound", () => {
    const patch = formatBetweenHeadsPatch(
      {
        prevPath: "f",
        path: "f",
        prevContent: "a\nb\nc\n",
        newContent: "x\ny\nz\n",
      },
      { maxEditLength: 1, timeoutMs: LINE_DIFF_TIMEOUT_MS },
    );

    expect(patch).toBeUndefined();
  });
});

describe("isPastByteBound", () => {
  it("is past for a blob over the byte bound", () => {
    expect(isPastByteBound("x".repeat(MAX_LINE_DIFF_BYTES + 1))).toBe(true);
  });

  it("counts UTF-8 bytes, not UTF-16 units", () => {
    const twoByteChars = "é".repeat(MAX_LINE_DIFF_BYTES / 2 + 1);

    expect(isPastByteBound(twoByteChars)).toBe(true);
    expect(isPastByteBound("x".repeat(MAX_LINE_DIFF_BYTES))).toBe(false);
  });
});

describe("formatLineDiffPatch", () => {
  const contents = {
    prevPath: "f",
    path: "f",
    prevContent: "a\nb\nc\n",
    newContent: "a\nx\nc\n",
  };

  it("diffs under the afforded edit length and the per-file time limit", () => {
    const patch = formatLineDiffPatch({ contents, maxEditLength: 2 });

    expect(patch).toBe(
      formatBetweenHeadsPatch(contents, {
        maxEditLength: 2,
        timeoutMs: LINE_DIFF_TIMEOUT_MS,
      }),
    );
    expect(patch).toContain("+x");
  });

  it("answers no patch past the afforded edit length", () => {
    expect(formatLineDiffPatch({ contents, maxEditLength: 1 })).toBeUndefined();
  });
});
