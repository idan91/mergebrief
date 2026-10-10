import { describe, expect, it } from "vitest";

import { createFileRowsCache } from "./fileRows";

const APP_PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,2 @@",
  "-const a = 1;",
  "+const a = 10;",
  " const b = 2;",
].join("\n");

function stubPatches(): ReadonlyMap<string, string> {
  return new Map([["src/app.ts", APP_PATCH]]);
}

describe("createFileRowsCache", () => {
  it("parses a file's patch into rows with the diff's line numbers", () => {
    const cache = createFileRowsCache(stubPatches());

    expect(cache.getFileRows("src/app.ts")).toEqual([
      { kind: "hunk", content: "@@ -1,2 +1,2 @@" },
      { kind: "del", content: "const a = 1;", oldLine: 1 },
      { kind: "add", content: "const a = 10;", newLine: 1 },
      { kind: "ctx", content: "const b = 2;", oldLine: 2, newLine: 2 },
    ]);
  });

  it("parses each file once and hands back the same rows on a second read", () => {
    const cache = createFileRowsCache(stubPatches());

    expect(cache.getFileRows("src/app.ts")).toBe(
      cache.getFileRows("src/app.ts"),
    );
  });

  it("answers undefined for a file the diff does not carry", () => {
    const cache = createFileRowsCache(stubPatches());

    expect(cache.getFileRows("not/in/diff.ts")).toBeUndefined();
  });

  it("reports whether it holds any file at all", () => {
    expect(createFileRowsCache(new Map()).isEmpty).toBe(true);
    expect(createFileRowsCache(stubPatches()).isEmpty).toBe(false);
  });
});
