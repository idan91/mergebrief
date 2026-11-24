import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  deriveSrcExclude,
  listSitePages,
  readPageTitle,
  readReleaseVersion,
  readSitePages,
} from "../../src/pages";
import { makeTree } from "../helpers";

const DOCS = {
  "README.md": "# MergeBrief documentation\n",
  "use/cli.md": "# The mergebrief CLI\n",
  "self-host/README.md": "# Self-hosting MergeBrief\n",
  "self-host/compose.md": "# Self-hosting with docker compose\n",
  "self-host/nested/deep.md": "# Nested\n",
  "repo-config/authoring.md": "# Authoring `.mergebrief/`\n",
  "architecture.md": "# Architecture\n",
  "api-changelog.md": "# API changelog\n",
  "releases/0.1.0.md": "---\ndate: 2026-10-31\n---\n\n## Highlights\n",
  "vocabulary/labeling-schema.md": "# Labeling schema\n",
  "vocabulary/risk-surface.md": "# Risk surface\n",
  "secret/notes.md": "# Notes\n",
  "secret/[draft] (v2).md": "# Draft\n",
  "self-host/image.png": "",
};

describe("listSitePages", () => {
  it("lists only allow-listed markdown, sorted", () => {
    expect(listSitePages(makeTree(DOCS))).toEqual([
      "README.md",
      "api-changelog.md",
      "architecture.md",
      "releases/0.1.0.md",
      "repo-config/authoring.md",
      "self-host/README.md",
      "self-host/compose.md",
      "use/cli.md",
    ]);
  });
});

describe("deriveSrcExclude", () => {
  it("excludes every other markdown file under the docs root", () => {
    expect(deriveSrcExclude(makeTree(DOCS))).toEqual([
      "secret/\\[draft\\] \\(v2\\).md",
      "secret/notes.md",
      "self-host/nested/deep.md",
      "vocabulary/labeling-schema.md",
      "vocabulary/risk-surface.md",
    ]);
  });

  it("excludes a linked folder whole, which the page glob never enters", () => {
    const srcDir = makeTree(DOCS);
    const scratchPrefix = path.join(tmpdir(), "docs-site-linked-");
    const linkedTarget = mkdtempSync(scratchPrefix);
    mkdirSync(path.join(linkedTarget, "nested"));
    writeFileSync(path.join(linkedTarget, "nested", "plan.md"), "# Plan\n");
    symlinkSync(linkedTarget, path.join(srcDir, "plans"));

    expect(deriveSrcExclude(srcDir)).toEqual([
      "secret/\\[draft\\] \\(v2\\).md",
      "secret/notes.md",
      "self-host/nested/deep.md",
      "vocabulary/labeling-schema.md",
      "vocabulary/risk-surface.md",
      "plans/**",
    ]);
  });
});

describe("readPageTitle", () => {
  it("reads the first level-one heading as plain text", () => {
    expect(
      readPageTitle(
        "intro\n\n## Sub\n\n# Authoring `.mergebrief/`\n# Second\n",
      ),
    ).toBe("Authoring .mergebrief/");
  });

  it("returns undefined for a page with no level-one heading", () => {
    expect(
      readPageTitle("---\ndate: 2026-10-31\n---\n\n## Highlights\n"),
    ).toBeUndefined();
  });
});

describe("readReleaseVersion", () => {
  it.each([
    ["releases/0.1.0.md", "0.1.0"],
    ["releases/0.1.0-rc.1.md", "0.1.0-rc.1"],
    ["self-host/compose.md", undefined],
  ])("reads %s as %s", (relativePath, version) => {
    expect(readReleaseVersion(relativePath)).toBe(version);
  });
});

describe("readSitePages", () => {
  it("maps each page to its site link and title", () => {
    const pages = readSitePages(makeTree(DOCS));

    expect(pages.find((page) => page.source === "README.md")).toEqual({
      source: "README.md",
      link: "/",
      title: "MergeBrief documentation",
    });
    expect(pages.find((page) => page.source === "self-host/README.md")).toEqual(
      {
        source: "self-host/README.md",
        link: "/self-host/README",
        title: "Self-hosting MergeBrief",
      },
    );
    expect(pages.find((page) => page.source === "releases/0.1.0.md")).toEqual({
      source: "releases/0.1.0.md",
      link: "/releases/0.1.0",
      title: "0.1.0",
    });
  });
});
