import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runExport } from "../../src/logic/export";
import { createGitPort } from "../../src/logic/git-port";
import { GateNames } from "../../src/logic/export/types";
import {
  makeGitRepos,
  makeNotesFile,
  stubCommandRunner,
  type Tree,
} from "../helpers";

const made: string[] = [];

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const CLEAN: Tree = {
  "README.md": "Read [the guide](docs/guide.md).\n",
  "docs/guide.md": "Plain.\n",
  "docs/releases/0.1.0.md": makeNotesFile({}, "First.\n"),
  "docs/internal/adr.md": "private\n",
  ".claude/settings.json": "{}\n",
};

function exportTree(tree: Tree, version = "0.1.0") {
  const repos = makeGitRepos(tree);
  made.push(repos.root);
  const out = join(repos.root, "out");
  const printed: string[] = [];
  const git = createGitPort(repos.clone, process.env);
  const result = runExport(
    {
      git: { ...git, listPublicTags: () => [] },
      runner: stubCommandRunner().runner,
      print: (text) => printed.push(text),
    },
    {
      version,
      source: "main",
      out,
      dryRun: true,
      publicRepository: { slug: "Idan91/mergebrief", url: "unused" },
    },
  );
  return { repos, out, result, printed };
}

describe("running the export", () => {
  it("writes the shipped tree and passes every gate over it", () => {
    const { repos, out, result, printed } = exportTree(CLEAN);

    const entries = readdirSync(out).toSorted();
    const internalDir = join(out, "docs", "internal");
    expect(entries).toEqual(["README.md", "docs"]);
    expect(existsSync(internalDir)).toBe(false);
    expect(result.ok && result.value.header).toMatchObject({
      version: "0.1.0",
      commit: repos.head,
      fileCount: 3,
    });
    expect(result.ok && result.value.gates.passed).toBe(true);
    expect(printed[0]).toMatch(/^export 0\.1\.0 \(dry run\)\n/);
    const verdictLines = printed.slice(1, -1);
    const verdictLabels = verdictLines.map((text) => text.split(":")[0]);
    expect(verdictLabels).toEqual([
      "gate paths",
      "gate gitleaks",
      "gate notes",
      "gate build",
    ]);
    expect(printed.at(-1)).toMatch(/^publish 0\.1\.0 \(dry run\)\n/);
    expect(printed.at(-1)).toContain("  actions  push commit ");
  });

  it("stops at the paths gate when shipped markdown links inward", () => {
    const { result } = exportTree({
      ...CLEAN,
      "docs/guide.md": "See [the ADR](internal/adr.md).\n",
    });

    const verdicts = result.ok ? result.value.gates.verdicts : [];
    expect(verdicts.map((verdict) => verdict.name)).toEqual([GateNames.PATHS]);
    expect(result.ok && result.value.gates.passed).toBe(false);
  });

  it("refuses an unclassified top-level path before writing", () => {
    const { out, result } = exportTree({ ...CLEAN, "notes/todo.md": "x\n" });

    expect(result).toEqual({
      ok: false,
      error: { reason: "unclassified top-level path: notes/" },
    });
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a version outside the release grammar", () => {
    const { result } = exportTree(CLEAN, "0.1");

    expect(!result.ok && result.error.reason).toBe(
      "--version 0.1 is not X.Y.Z or X.Y.Z-rc.N",
    );
  });
});
