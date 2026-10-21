import { describe, expect, it } from "vitest";

import { createFileRowsCache } from "./cache";

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
  it("parses each file once and hands back the same rows on a second read", () => {
    const cache = createFileRowsCache(stubPatches());

    expect(cache.getFileRows("src/app.ts")).toBe(
      cache.getFileRows("src/app.ts"),
    );
  });
});
