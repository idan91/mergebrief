import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkProvenance, findProvenanceHits } from "../src/provenance";
import { ProvenanceKinds } from "../src/provenance/types";
import { runGit, writeTree } from "./helpers";

function findHitsIn(path: string, text: string) {
  return findProvenanceHits([{ path, text }]);
}

describe("findProvenanceHits", () => {
  it("reports a ticket id with its line", () => {
    const hits = findHitsIn("src/a.ts", "const a = 1;\n// see BRIEF-476\n");

    expect(hits).toEqual([
      {
        path: "src/a.ts",
        line: 2,
        kind: ProvenanceKinds.TICKET,
        match: "BRIEF-476",
      },
    ]);
  });

  it("reports the maintainer handle in any case", () => {
    const text = "// asked by @Idan91\n// per IDAN91 and idan91.\n";

    const lines = findHitsIn("docs/a.md", text).map((hit) => hit.line);

    expect(lines).toEqual([1, 2, 2]);
  });

  it("passes the handle as the owner in a repo slug or URL", () => {
    const text = [
      "npx skills add idan91/mergebrief --skill mergebrief",
      "image: ghcr.io/idan91/mergebrief:latest",
      "see https://github.com/idan91/mergebrief/releases",
    ].join("\n");

    expect(findHitsIn("README.md", text)).toEqual([]);
  });

  it("reports a reference to this repository's own pull requests", () => {
    const text = [
      "fixed in idan91/mergebrief#57",
      "https://github.com/idan91/mergebrief/pull/58",
      "https://github.com/Idan91/code-review/issues/3",
    ].join("\n");

    const hits = findHitsIn("docs/a.md", text);

    expect(hits.map((hit) => hit.kind)).toEqual([
      ProvenanceKinds.PULL_REQUEST,
      ProvenanceKinds.PULL_REQUEST,
      ProvenanceKinds.PULL_REQUEST,
    ]);
  });

  it("passes bare issue and pull request numbers in product text", () => {
    const text = "PR 7 · brief available\nCloses #12 in acme/widget#4\n";

    expect(findHitsIn("docs/use/cli.md", text)).toEqual([]);
  });

  it("skips captured data, lockfiles and its own patterns", () => {
    const files = [
      "tools/categorizer/eval/cases/a/fixture.json",
      "tools/categorizer/eval/pair-cases/a/pair.json",
      "tools/categorizer/test/__snapshots__/a.snap",
      "apps/web/src/demo/api/consts.ts",
      "pnpm-lock.yaml",
      "tools/repo-checks/src/provenance/consts.ts",
    ].map((path) => ({ path, text: '"title": "[BRIEF-240] feat"' }));

    expect(findProvenanceHits(files)).toEqual([]);
  });
});

describe("checkProvenance", () => {
  let root = "";

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeRepo(
    tracked: Readonly<Record<string, string>>,
    untracked: Readonly<Record<string, string>> = {},
  ): string {
    root = mkdtempSync(join(tmpdir(), "provenance-"));
    runGit(root, ["init", "-q"]);
    writeTree(root, tracked);
    runGit(root, ["add", "-A"]);
    runGit(root, ["commit", "-q", "-m", "seed"]);
    writeTree(root, untracked);
    return root;
  }

  it("reports a hit in a tracked file and ignores an untracked one", () => {
    const repo = makeRepo(
      { "src/a.ts": "// BRIEF-1\n" },
      { "src/b.ts": "// BRIEF-2\n" },
    );

    const result = checkProvenance(repo);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          path: "src/a.ts",
          line: 1,
          kind: ProvenanceKinds.TICKET,
          match: "BRIEF-1",
        },
      ],
    });
  });

  it("never reads an env file, even a tracked one", () => {
    const repo = makeRepo({
      ".env": "TOKEN=BRIEF-9\n",
      "apps/api/.env.local": "TOKEN=BRIEF-9\n",
      ".env.example": "# KEY=<your-value>\n",
    });

    expect(checkProvenance(repo)).toEqual({ ok: true, value: [] });
  });

  it("never follows a tracked link to an env file", () => {
    const repo = makeRepo({ ".ENV.production": "TOKEN=BRIEF-8\n" });
    symlinkSync(".ENV.production", join(repo, "notes.md"));
    runGit(repo, ["add", "notes.md"]);
    runGit(repo, ["commit", "-q", "-m", "link"]);

    expect(checkProvenance(repo)).toEqual({ ok: true, value: [] });
  });

  it("skips a binary file", () => {
    const repo = makeRepo({ "logo.png": "\u0000BRIEF-3" });

    expect(checkProvenance(repo)).toEqual({ ok: true, value: [] });
  });

  it("fails outside a git work tree rather than passing empty", () => {
    root = mkdtempSync(join(tmpdir(), "provenance-"));

    expect(checkProvenance(root)).toMatchObject({ ok: false });
  });
});
