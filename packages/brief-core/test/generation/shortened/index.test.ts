import { describe, expect, it } from "vitest";
import { indexDiff } from "../../../src/diff/hunk-index";
import type { IndexedFile } from "../../../src/diff/hunk-index/types";
import { splitDiffByFile } from "../../../src/diff/file-diff";
import { flagAddedSecrets } from "../../../src/generation/added-secrets";
import {
  buildShortenedChunk,
  detectLockfile,
  renderLockfileSummary,
  renderShortenedFile,
  shortenFile,
  summarizeLockfile,
} from "../../../src/generation/shortened";
import { LOCKFILE_MAX_BYTES } from "../../../src/generation/shortened/consts";
import { readLinguistAttributesByPath } from "../../../src/generation/shortened/gitattributes";
import { SecretKinds } from "../../../src/generation/redaction/types";
import { FAKE_SECRETS } from "../../secret-fixtures";
import { makeSides, readGitAttributeRules, summarizeTexts } from "./helpers";

const PNPM = (packages: string) =>
  `lockfileVersion: '9.0'\npackages:\n${packages}`;

function indexOne(diff: string) {
  const [file] = indexDiff(diff);
  if (file === undefined) {
    throw new Error("fixture has no file");
  }
  return file;
}

const LOCKFILE_DIFF = indexOne(
  "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n@@ -1,2 +1,3 @@\n-a\n+b\n+c\n",
);

describe("detectLockfile", () => {
  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["packages/api/package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"],
    ["yarn.lock", "yarn"],
    ["Cargo.lock", "other"],
    ["bun.lockb", "other"],
  ])("reads %s as %s", (path, format) => {
    expect(detectLockfile(path)).toBe(format);
  });

  it("does not read a file that only resembles a lockfile", () => {
    expect(detectLockfile("docs/pnpm-lock.yaml.md")).toBeUndefined();
    expect(detectLockfile("src/index.ts")).toBeUndefined();
  });
});

describe("summarizeLockfile", () => {
  it("returns nothing for a file that is not a lockfile", () => {
    expect(summarizeTexts("src/a.ts", "a", "b")).toBeUndefined();
  });

  it("reads other lockfiles without package changes", () => {
    expect(summarizeTexts("Cargo.lock", "a", "b")).toEqual({ format: "other" });
  });

  it("reads every package of an added lockfile as added", () => {
    const added = summarizeTexts(
      "pnpm-lock.yaml",
      undefined,
      PNPM("  zod@3.23.8:\n    resolution: {integrity: sha512-a}\n"),
    );

    expect(added).toMatchObject({
      changes: { added: [{ name: "zod", version: "3.23.8" }] },
    });
  });

  it("leaves a lockfile unread when a side is unavailable or too large", () => {
    const text = PNPM("");
    const unavailable = summarizeLockfile("pnpm-lock.yaml", {
      before: { kind: "unavailable" },
      after: { kind: "text", text },
    });
    const tooLarge = summarizeTexts(
      "pnpm-lock.yaml",
      text,
      " ".repeat(LOCKFILE_MAX_BYTES + 1),
    );

    expect([unavailable, tooLarge]).toEqual([
      { format: "pnpm", unread: "unavailable" },
      { format: "pnpm", unread: "too-large" },
    ]);
  });

  it("pairs versions of one package when both sides list as many", () => {
    const summary = summarizeTexts(
      "pnpm-lock.yaml",
      PNPM(
        "  semver@6.3.0:\n    resolution: {integrity: a}\n  semver@7.5.0:\n    resolution: {integrity: b}\n",
      ),
      PNPM(
        "  semver@6.3.1:\n    resolution: {integrity: c}\n  semver@7.6.0:\n    resolution: {integrity: d}\n",
      ),
    );

    expect(summary).toMatchObject({
      changes: {
        updated: [
          { name: "semver", from: "6.3.0", to: "6.3.1" },
          { name: "semver", from: "7.5.0", to: "7.6.0" },
        ],
      },
    });
  });

  it.each([
    [
      "an alias target holding a line break",
      {
        "node_modules/foo": {
          name: "bar)\n  added x@1.0.0 (y",
          version: "1.0.0",
        },
      },
    ],
    [
      "a version holding a line break",
      { "node_modules/foo": { version: "1.0.0\n  added x@1.0.0" } },
    ],
  ])(
    "reads a field that would render as %s as unparseable",
    (_label, packages) => {
      const npm = JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, ...packages },
      });

      expect(summarizeTexts("package-lock.json", undefined, npm)).toEqual({
        format: "npm",
        unread: "unparseable",
      });
    },
  );

  it("leaves out the base hosts of a lockfile with no base side", () => {
    const summary = summarizeTexts(
      "pnpm-lock.yaml",
      undefined,
      PNPM("  zod@3.23.8:\n    resolution: {integrity: a}\n"),
    );

    expect(summary).toEqual({
      format: "pnpm",
      changes: {
        added: [{ name: "zod", version: "3.23.8", hosts: ["registry"] }],
        removed: [],
        updated: [],
        sourceChanged: [],
      },
    });
  });

  it("lists versions apart when the two sides list different counts", () => {
    const summary = summarizeTexts(
      "pnpm-lock.yaml",
      PNPM(
        "  semver@6.3.0:\n    resolution: {integrity: a}\n  semver@7.5.0:\n    resolution: {integrity: b}\n",
      ),
      PNPM("  semver@7.6.0:\n    resolution: {integrity: c}\n"),
    );

    expect(summary).toMatchObject({
      changes: {
        added: [{ name: "semver", version: "7.6.0" }],
        removed: [
          { name: "semver", version: "6.3.0" },
          { name: "semver", version: "7.5.0" },
        ],
        updated: [],
      },
    });
  });
});

describe("renderLockfileSummary", () => {
  it("renders one titled line per package change", () => {
    const summary = summarizeLockfile(
      "pnpm-lock.yaml",
      makeSides(
        PNPM(
          "  gone@1.0.0:\n    resolution: {integrity: a}\n  lodash@4.17.21:\n    resolution: {integrity: b}\n  react@18.2.0:\n    resolution: {integrity: c}\n",
        ),
        PNPM(
          "  left-pad@1.3.0:\n    resolution: {integrity: d}\n  lodash@4.17.21:\n    resolution: {integrity: e}\n  react@18.3.1:\n    resolution: {integrity: f}\n",
        ),
      ),
    );

    expect(summary && renderLockfileSummary(LOCKFILE_DIFF, summary)).toEqual([
      "pnpm-lock.yaml (modified, +2 -1, lockfile)",
      "  added left-pad@1.3.0 (registry)",
      "  removed gone@1.0.0 (registry)",
      "  updated react 18.2.0 -> 18.3.1",
      "  source changed lodash@4.17.21 (registry)",
    ]);
  });

  it("names each changed version's host, unknown included", () => {
    const summary = summarizeTexts(
      "pnpm-lock.yaml",
      PNPM("  lodash@4.17.21:\n    resolution: {integrity: b}\n"),
      PNPM(
        "  lodash@4.17.21:\n    resolution: {tarball: https://evil.example/l.tgz}\n  odd@1.0.0:\n    resolution: {type: other}\n",
      ),
    );

    expect(summary && renderLockfileSummary(LOCKFILE_DIFF, summary)).toEqual([
      "pnpm-lock.yaml (modified, +2 -1, lockfile)",
      "  added odd@1.0.0 (unknown host)",
      "  source changed lodash@4.17.21 (registry -> https://evil.example/l.tgz)",
    ]);
  });

  it("renders an added alias with the package it aliases", () => {
    const npm = (packages: object) =>
      JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } });
    const summary = summarizeTexts(
      "package-lock.json",
      npm({}),
      npm({
        "node_modules/lodash-es": {
          name: "evil-pkg",
          version: "1.0.0",
          resolved: "https://evil.example/e.tgz",
        },
      }),
    );
    const lines =
      summary === undefined
        ? []
        : renderLockfileSummary(LOCKFILE_DIFF, summary);

    expect(lines.slice(1)).toEqual([
      "  added lodash-es@1.0.0 (alias of evil-pkg) (https://evil.example/e.tgz)",
    ]);
  });

  it("keeps an update's alias note when its hosts match", () => {
    const npm = (version: string, name?: string) =>
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/lodash": {
            name,
            version,
            resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
          },
        },
      });
    const summary = summarizeTexts(
      "package-lock.json",
      npm("4.17.20"),
      npm("4.17.21", "evil-lodash"),
    );
    const lines =
      summary === undefined
        ? []
        : renderLockfileSummary(LOCKFILE_DIFF, summary);

    expect(lines.slice(1)).toEqual([
      "  updated lodash 4.17.20 -> 4.17.21 (now alias of evil-lodash)",
    ]);
  });

  it("renders both aliases of a source change when they differ", () => {
    const npm = (name: string) =>
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/lodash": {
            name,
            version: "4.17.21",
            resolved: "https://registry.npmjs.org/x/-/x-4.17.21.tgz",
          },
        },
      });
    const summary = summarizeTexts(
      "package-lock.json",
      npm("lodash-es"),
      npm("evil-lodash"),
    );
    const lines =
      summary === undefined
        ? []
        : renderLockfileSummary(LOCKFILE_DIFF, summary);

    expect(lines.slice(1)).toEqual([
      "  source changed lodash@4.17.21 (alias of lodash-es -> evil-lodash) (https://registry.npmjs.org/x/-/x-{version}.tgz)",
    ]);
  });

  it("says so when a lockfile changes no package", () => {
    const text = PNPM("  zod@3.23.8:\n    resolution: {integrity: a}\n");

    expect(
      renderLockfileSummary(LOCKFILE_DIFF, {
        format: "pnpm",
        changes: { added: [], removed: [], updated: [], sourceChanged: [] },
      }),
    ).toEqual([
      "pnpm-lock.yaml (modified, +2 -1, lockfile)",
      "  no package changes",
    ]);
    expect(summarizeTexts("pnpm-lock.yaml", text, text)).toMatchObject({
      changes: { sourceChanged: [] },
    });
  });

  it("names both hosts on an update that moves host", () => {
    const summary = {
      format: "npm" as const,
      changes: {
        added: [],
        removed: [],
        updated: [
          {
            name: "a",
            from: "1.0.0",
            to: "1.0.1",
            fromHosts: ["registry.npmjs.org"],
            toHosts: ["mirror.example"],
          },
        ],
        sourceChanged: [],
      },
    };

    expect(renderLockfileSummary(LOCKFILE_DIFF, summary)).toContain(
      "  updated a 1.0.0 -> 1.0.1 (registry.npmjs.org -> mirror.example)",
    );
  });

  it("names why a lockfile went unread", () => {
    expect(
      renderLockfileSummary(LOCKFILE_DIFF, {
        format: "npm",
        unread: "ambiguous",
      }),
    ).toEqual([
      "pnpm-lock.yaml (modified, +2 -1, lockfile)",
      "  package changes not read: ambiguous",
    ]);
  });

  it("renders an other lockfile as one line", () => {
    const file = indexOne(
      "diff --git a/go.sum b/go.sum\n@@ -1 +1,2 @@\n a\n+b\n+c\n",
    );

    expect(renderLockfileSummary(file, { format: "other" })).toEqual([
      "go.sum (modified, +2 -0, lockfile)",
    ]);
  });
});

const RULES = readGitAttributeRules(
  ["dist/** linguist-generated", "third_party/** linguist-vendored"].join("\n"),
);

const generatedDiff = [
  "diff --git a/dist/app.js b/dist/app.js",
  "index 111..222 100644",
  "--- a/dist/app.js",
  "+++ b/dist/app.js",
  "@@ -1,3 +1,4 @@ (function () {",
  " var a = 1;",
  "-var b = 2;",
  "+var b = 3;",
  `+var token = "${FAKE_SECRETS[SecretKinds.GITHUB_TOKEN]}";`,
  " var c = 4;",
  "@@ -40,2 +41,2 @@ function tail() {",
  "-  return a;",
  "+  return b;",
  "",
].join("\n");

const lockfileDiff = [
  "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
  "--- a/pnpm-lock.yaml",
  "+++ b/pnpm-lock.yaml",
  "@@ -1,2 +1,2 @@ packages:",
  "-  react@18.2.0:",
  "+  react@18.3.1:",
  "",
].join("\n");

function makePnpmLockfile(reactVersion: string): string {
  return [
    "lockfileVersion: '9.0'",
    "packages:",
    `  react@${reactVersion}:`,
    "    resolution: {integrity: sha512-react}",
    "snapshots:",
    `  react@${reactVersion}: {}`,
    "",
  ].join("\n");
}

const LOCKFILE_SUMMARY = summarizeTexts(
  "pnpm-lock.yaml",
  makePnpmLockfile("18.2.0"),
  makePnpmLockfile("18.3.1"),
);

function shortenWithRules(file: IndexedFile) {
  const attributes = readLinguistAttributesByPath([file.path], RULES);
  return shortenFile(file, attributes.byPath.get(file.path), undefined);
}

describe("shortenFile", () => {
  it("reads a parsed lockfile as a package summary", () => {
    const file = indexOne(lockfileDiff);
    const shortened = shortenFile(file, undefined, LOCKFILE_SUMMARY);

    expect(shortened).toMatchObject({
      kind: "lockfile",
      readAs: "package-summary",
    });
  });

  it("reads a lockfile of another ecosystem as counts only", () => {
    const file = indexOne(
      "diff --git a/Cargo.lock b/Cargo.lock\n@@ -1 +1 @@\n-a\n+b\n",
    );

    const summary = summarizeTexts("Cargo.lock", "a", "b");

    expect(shortenFile(file, undefined, summary)).toMatchObject({
      kind: "lockfile",
      readAs: "counts-only",
    });
  });

  it("reads a lockfile whose contents were not read as counts only", () => {
    const file = indexOne(lockfileDiff);
    const summary = summarizeTexts("pnpm-lock.yaml", "packages: [", "");
    const shortened = shortenFile(file, undefined, summary);

    expect(shortened).toMatchObject({
      kind: "lockfile",
      readAs: "counts-only",
    });
    expect(shortened && renderShortenedFile(shortened)).toEqual([
      "pnpm-lock.yaml (modified, +1 -1, lockfile)",
      "  package changes not read: unparseable",
    ]);
  });

  it("reads generated and vendored files as counts only", () => {
    const vendored = indexOne(
      "diff --git a/third_party/x.c b/third_party/x.c\n@@ -1 +1 @@\n-a\n+b\n",
    );

    expect(shortenWithRules(indexOne(generatedDiff))).toMatchObject({
      kind: "generated",
      readAs: "counts-only",
    });
    expect(shortenWithRules(vendored)).toMatchObject({
      kind: "vendored",
      readAs: "counts-only",
    });
  });

  it("leaves any other file to be read in full", () => {
    const file = indexOne(
      "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
    );

    expect(shortenWithRules(file)).toBeUndefined();
  });
});

describe("renderShortenedFile", () => {
  it("renders a generated file as its counts and hunk headers", () => {
    const shortened = shortenWithRules(indexOne(generatedDiff));

    expect(shortened && renderShortenedFile(shortened)).toEqual([
      "dist/app.js (modified, +3 -2, generated)",
      "  @@ -1,3 +1,4 @@ (function () {",
      "  @@ -40,2 +41,2 @@ function tail() {",
    ]);
  });

  it("renders a parsed lockfile as its package changes", () => {
    const file = indexOne(lockfileDiff);
    const shortened = shortenFile(file, undefined, LOCKFILE_SUMMARY);

    expect(shortened && renderShortenedFile(shortened)).toEqual([
      "pnpm-lock.yaml (modified, +1 -1, lockfile)",
      "  updated react 18.2.0 -> 18.3.1",
    ]);
  });
});

describe("buildShortenedChunk", () => {
  it("writes a supporting generated chunk over every changed line", () => {
    const shortened = shortenWithRules(indexOne(generatedDiff));
    if (shortened === undefined) {
      throw new Error("fixture is not shortened");
    }

    expect(
      buildShortenedChunk(shortened, { id: "c9", changeGroupId: "g2" }),
    ).toEqual({
      id: "c9",
      changeGroupId: "g2",
      file: "dist/app.js",
      concern: "generated",
      role: "supporting",
      addedRanges: [
        { start: 2, end: 3 },
        { start: 41, end: 41 },
      ],
      removedRanges: [
        { start: 2, end: 2 },
        { start: 40, end: 40 },
      ],
      riskSurface: [],
      loc: { added: 3, deleted: 2 },
      readAs: "counts-only",
    });
  });

  it("still flags a secret the shortened rendering never shows", () => {
    const shortened = shortenWithRules(indexOne(generatedDiff));
    if (shortened === undefined) {
      throw new Error("fixture is not shortened");
    }
    const chunk = buildShortenedChunk(shortened, {
      id: "c1",
      changeGroupId: "g1",
    });

    const flagged = flagAddedSecrets(
      [chunk],
      [],
      splitDiffByFile(generatedDiff),
    );

    expect(renderShortenedFile(shortened).join("\n")).not.toContain("token");
    expect(flagged.chunks[0]?.riskSurface).toEqual(["adds-secret"]);
  });
});
