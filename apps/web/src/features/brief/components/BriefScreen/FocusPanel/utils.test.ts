import { describe, expect, it } from "vitest";

import { splitFilePath } from "./utils";

describe("splitFilePath", () => {
  it("splits the directory into slash-ended parts and the basename", () => {
    expect(splitFilePath("apps/web/Header.tsx")).toEqual({
      directories: [
        { key: "apps/", text: "apps/" },
        { key: "apps/web/", text: "web/" },
      ],
      basename: "Header.tsx",
    });
  });

  it("has no directory parts for a root file", () => {
    expect(splitFilePath("README.md")).toEqual({
      directories: [],
      basename: "README.md",
    });
  });
});
