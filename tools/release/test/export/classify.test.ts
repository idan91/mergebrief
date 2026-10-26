import { describe, expect, it } from "vitest";
import { classifyTrackedPaths } from "../../src/logic/export/classify";
import type { ExportPaths } from "../../src/logic/export/types";

const MANIFEST: ExportPaths = {
  include: ["apps/", "docs/", "README.md"],
  exclude: ["docs/internal/", ".claude/", "docs/plans/", "apps/secret.md"],
};

describe("classifying tracked paths", () => {
  it("splits shipped from excluded and counts each prefix", () => {
    const result = classifyTrackedPaths(
      [
        "README.md",
        "apps/api/main.ts",
        "apps/secret.md",
        "docs/guide.md",
        "docs/internal/adr/0001.md",
        "docs/internal/README.md",
        ".claude/settings.json",
      ],
      MANIFEST,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        shipped: ["README.md", "apps/api/main.ts", "docs/guide.md"],
        excluded: [
          { prefix: "docs/internal/", count: 2 },
          { prefix: ".claude/", count: 1 },
          { prefix: "docs/plans/", count: 0 },
          { prefix: "apps/secret.md", count: 1 },
        ],
      },
    });
  });

  it("fails on a top-level dir in neither list", () => {
    const result = classifyTrackedPaths(
      ["README.md", "notes/todo.md", "notes/more.md", "zeta/x"],
      MANIFEST,
    );

    expect(result).toEqual({
      ok: false,
      error: { unclassified: ["notes/", "zeta/"] },
    });
  });

  it("names an unlisted root file without a slash", () => {
    const result = classifyTrackedPaths(["README.md", "TODO.txt"], MANIFEST);

    expect(!result.ok && result.error.unclassified).toEqual(["TODO.txt"]);
  });

  it("never matches a root file against a dir entry of the same name", () => {
    const result = classifyTrackedPaths(["apps"], MANIFEST);

    expect(!result.ok && result.error.unclassified).toEqual(["apps"]);
  });
});
