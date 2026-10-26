import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runExport } from "../../src/logic/export";
import { createGitPort } from "../../src/logic/git-port";
import { LinkHitKinds } from "../../src/logic/export/types";
import { makeGitRepos, type Tree } from "../helpers";

const made: string[] = [];

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const SHIPPABLE: Tree = {
  "README.md": "Read [the guide](docs/guide.md).\n",
  "docs/guide.md": "See [the ADR](internal/adr.md).\n",
  "docs/internal/adr.md": "private\n",
  ".claude/settings.json": "{}\n",
};

function exportTree(tree: Tree, version = "0.1.0") {
  const repos = makeGitRepos(tree);
  made.push(repos.root);
  const out = join(repos.root, "out");
  const result = runExport(createGitPort(repos.clone), {
    version,
    source: "main",
    out,
  });
  return { repos, out, result };
}

describe("running the export", () => {
  it("writes the shipped tree and reports counts and link hits", () => {
    const { repos, out, result } = exportTree(SHIPPABLE);

    const entries = readdirSync(out).toSorted();
    const internalDir = join(out, "docs", "internal");
    expect(entries).toEqual(["README.md", "docs"]);
    expect(existsSync(internalDir)).toBe(false);
    expect(result.ok && result.value).toMatchObject({
      version: "0.1.0",
      commit: repos.head,
      out,
      fileCount: 2,
      linkHits: [{ path: "docs/guide.md", line: 1, kind: LinkHitKinds.LINK }],
    });
    expect(result.ok && result.value.excluded).toContainEqual({
      prefix: "docs/internal/",
      count: 1,
    });
  });

  it("refuses an unclassified top-level path before writing", () => {
    const { out, result } = exportTree({
      ...SHIPPABLE,
      "notes/todo.md": "x\n",
    });

    expect(result).toEqual({
      ok: false,
      error: { reason: "unclassified top-level path: notes/" },
    });
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a version outside the release grammar", () => {
    const { result } = exportTree(SHIPPABLE, "0.1");

    expect(!result.ok && result.error.reason).toBe(
      "--version 0.1 is not X.Y.Z or X.Y.Z-rc.N",
    );
  });
});
