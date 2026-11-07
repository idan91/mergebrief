import { describe, expect, it } from "vitest";

import { splitPathSegments } from "./utils";

describe("splitPathSegments", () => {
  it("ends each directory at its slash and keys it by the path so far", () => {
    expect(splitPathSegments("src/app/app/file.ts")).toEqual([
      { key: "src/", text: "src/" },
      { key: "src/app/", text: "app/" },
      { key: "src/app/app/", text: "app/" },
      { key: "src/app/app/file.ts", text: "file.ts" },
    ]);
  });

  it("keeps a root file as one segment", () => {
    expect(splitPathSegments("README.md")).toEqual([
      { key: "README.md", text: "README.md" },
    ]);
  });
});
