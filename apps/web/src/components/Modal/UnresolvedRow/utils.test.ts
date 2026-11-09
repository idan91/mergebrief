import { describe, expect, it } from "vitest";

import { splitDirectoryAndFileName } from "./utils";

describe("splitDirectoryAndFileName", () => {
  it("keeps the trailing slash on the directory", () => {
    expect(splitDirectoryAndFileName("apps/web/src/a.ts")).toEqual({
      directory: "apps/web/src/",
      fileName: "a.ts",
    });
  });

  it("reads a bare file name as having no directory", () => {
    expect(splitDirectoryAndFileName("README.md")).toEqual({
      directory: "",
      fileName: "README.md",
    });
  });

  it("keeps a comment's line suffix with its file name", () => {
    expect(splitDirectoryAndFileName("src/a.ts:+3")).toEqual({
      directory: "src/",
      fileName: "a.ts:+3",
    });
  });
});
