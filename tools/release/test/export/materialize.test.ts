import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitPort } from "../../src/logic/git-port";
import {
  materializeTree,
  resolveExportSource,
} from "../../src/logic/export/materialize";
import { type GitRepos, makeGitRepos, runGit } from "../helpers";

const made: string[] = [];

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRepos(): GitRepos {
  const repos = makeGitRepos({
    "README.md": "public\n",
    "docs/internal/adr.md": "private\n",
  });
  made.push(repos.root);
  return repos;
}

describe("resolving the export source", () => {
  it("resolves a ref main holds to its commit", () => {
    const repos = makeRepos();

    const resolved = resolveExportSource(
      createGitPort(repos.clone, { env: process.env }),
      "main",
    );

    expect(resolved).toEqual({ ok: true, value: repos.head });
  });

  it("refuses a ref that is not a commit", () => {
    const repos = makeRepos();

    const resolved = resolveExportSource(
      createGitPort(repos.clone, { env: process.env }),
      "nope",
    );

    expect(resolved).toEqual({
      ok: false,
      error: { reason: "nope is not a commit" },
    });
  });

  it("refuses a commit the remote main does not hold", () => {
    const repos = makeRepos();
    runGit(repos.clone, ["switch", "--quiet", "-c", "side"]);
    writeFileSync(join(repos.clone, "side.md"), "x\n");
    runGit(repos.clone, ["add", "."]);
    runGit(repos.clone, ["commit", "--quiet", "-m", "side"]);
    const side = runGit(repos.clone, ["rev-parse", "HEAD"]).trim();

    const resolved = resolveExportSource(
      createGitPort(repos.clone, { env: process.env }),
      "side",
    );

    expect(resolved).toEqual({
      ok: false,
      error: {
        reason: `${side} is not on origin/main; export a commit main holds`,
      },
    });
  });
});

describe("materializing the tree", () => {
  it("writes the shipped paths and nothing untracked or excluded", () => {
    const repos = makeRepos();
    writeFileSync(join(repos.clone, "untracked.md"), "leak\n");
    const out = join(repos.root, "out");

    const done = materializeTree(
      createGitPort(repos.clone, { env: process.env }),
      {
        commit: repos.head,
        shipped: ["README.md"],
        out,
      },
    );

    expect(done.ok).toBe(true);
    const docsDir = join(out, "docs");
    expect(readdirSync(out)).toEqual(["README.md"]);
    expect(existsSync(docsDir)).toBe(false);
  });

  it("refuses an out dir that already holds files", () => {
    const repos = makeRepos();
    const out = join(repos.root, "out");
    mkdirSync(out);
    writeFileSync(join(out, "stale.md"), "x\n");

    const done = materializeTree(
      createGitPort(repos.clone, { env: process.env }),
      {
        commit: repos.head,
        shipped: ["README.md"],
        out,
      },
    );

    expect(done).toEqual({
      ok: false,
      error: { reason: `${out} is not empty; pass a new or empty --out dir` },
    });
  });

  it("refuses an out path that is a file", () => {
    const repos = makeRepos();
    const out = join(repos.root, "out.txt");
    writeFileSync(out, "x\n");

    const done = materializeTree(
      createGitPort(repos.clone, { env: process.env }),
      {
        commit: repos.head,
        shipped: ["README.md"],
        out,
      },
    );

    expect(!done.ok && done.error.reason).toBe(`${out} is not a dir`);
  });

  it("refuses an empty shipped list and writes nothing", () => {
    const repos = makeRepos();
    const out = join(repos.root, "out");

    const done = materializeTree(
      createGitPort(repos.clone, { env: process.env }),
      {
        commit: repos.head,
        shipped: [],
        out,
      },
    );

    expect(!done.ok && done.error.reason).toBe(
      `${repos.head} ships no path; nothing to export`,
    );
    expect(existsSync(out)).toBe(false);
  });
});
