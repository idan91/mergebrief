import { describe, expect, it } from "vitest";

import { deriveChunkRowPath } from "./utils";

describe("deriveChunkRowPath", () => {
  it("keeps the parent folder, cut from the start, and the file name", () => {
    expect(deriveChunkRowPath("apps/web/src/Header/index.tsx")).toEqual({
      folder: "…/Header/",
      fileName: "index.tsx",
    });
  });

  it("keeps a top-level folder whole", () => {
    expect(deriveChunkRowPath("src/index.ts")).toEqual({
      folder: "src/",
      fileName: "index.ts",
    });
  });

  it("returns a root file with no folder", () => {
    expect(deriveChunkRowPath("README.md")).toEqual({ fileName: "README.md" });
  });
});
