import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitPort, GitCommandError } from "../src/logic/git-port";
import { type GitRepos, makeGitRepos, makeNotesFile, runGit } from "./helpers";

const made: string[] = [];

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A bare remote with one tag, and a clone whose main holds a notes file. */
function makeRepos(): GitRepos {
  const repos = makeGitRepos({
    "docs/releases/0.1.0.md": makeNotesFile({}, "First.\n"),
  });
  made.push(repos.root);
  runGit(repos.clone, ["tag", "v0.0.9"]);
  runGit(repos.clone, ["push", "--quiet", "origin", "refs/tags/v0.0.9"]);
  runGit(repos.clone, ["tag", "-d", "v0.0.9"]);
  return repos;
}

describe("the git port against a real repository", () => {
  it("lists the remote's tags, not the local ones", () => {
    const repos = makeRepos();
    runGit(repos.clone, ["tag", "v9.9.9"]);

    const port = createGitPort(repos.clone);

    expect(port.listRemoteTags()).toEqual(["v0.0.9"]);
    expect(port.hasLocalTag("v9.9.9")).toBe(true);
    expect(port.hasLocalTag("v0.0.9")).toBe(false);
  });

  it("resolves a ref to its commit and reads a file at it", () => {
    const repos = makeRepos();
    const port = createGitPort(repos.clone);

    expect(port.resolveCommit("HEAD")).toBe(repos.head);
    expect(port.resolveCommit("no-such-ref")).toBeUndefined();
    expect(port.readFileAt(repos.head, "docs/releases/0.1.0.md")).toContain(
      "First.",
    );
    expect(
      port.readFileAt(repos.head, "docs/releases/0.2.0.md"),
    ).toBeUndefined();
  });

  it("knows which commits the remote default branch holds", () => {
    const repos = makeRepos();
    runGit(repos.clone, ["switch", "--quiet", "-c", "side"]);
    writeFileSync(join(repos.clone, "side.txt"), "x\n");
    runGit(repos.clone, ["add", "."]);
    runGit(repos.clone, ["commit", "--quiet", "-m", "side"]);
    const side = runGit(repos.clone, ["rev-parse", "HEAD"]).trim();
    const port = createGitPort(repos.clone);

    port.fetchDefaultBranch();

    expect(port.isOnDefaultBranch(repos.head)).toBe(true);
    expect(port.isOnDefaultBranch(side)).toBe(false);
  });

  it("names the failed git command without its credentials", () => {
    const repos = makeRepos();
    runGit(repos.clone, [
      "remote",
      "set-url",
      "origin",
      "https://user:secret@example.invalid/repo.git",
    ]);
    const port = createGitPort(repos.clone);

    const failure = (): void => {
      port.fetchDefaultBranch();
    };

    expect(failure).toThrow(GitCommandError);
    expect(failure).toThrow(/^git fetch /);
    expect(failure).not.toThrow(/secret/);
  });

  it("creates a tag at the commit and pushes it to the remote", () => {
    const repos = makeRepos();
    const port = createGitPort(repos.clone);

    port.createTag("v0.1.0", repos.head);
    port.pushTag("v0.1.0");

    expect(port.hasLocalTag("v0.1.0")).toBe(true);
    expect(port.listRemoteTags()).toEqual(["v0.0.9", "v0.1.0"]);
  });

  it("lists the paths a commit tracks, never the untracked ones", () => {
    const repos = makeRepos();
    writeFileSync(join(repos.clone, "untracked.txt"), "x\n");
    const port = createGitPort(repos.clone);

    expect(port.listTrackedPaths(repos.head)).toEqual([
      "docs/releases/0.1.0.md",
    ]);
  });

  it("archives only the named paths at the commit into a dir", () => {
    const repos = makeRepos();
    mkdirSync(join(repos.clone, "docs", "internal"), { recursive: true });
    writeFileSync(join(repos.clone, "docs", "internal", "x.md"), "private\n");
    writeFileSync(join(repos.clone, "[odd] name.md"), "odd\n");
    runGit(repos.clone, ["add", "."]);
    runGit(repos.clone, ["commit", "--quiet", "-m", "more"]);
    const commit = runGit(repos.clone, ["rev-parse", "HEAD"]).trim();
    writeFileSync(join(repos.clone, "[odd] name.md"), "edited after\n");
    const out = join(repos.root, "out");
    mkdirSync(out);
    const port = createGitPort(repos.clone);

    port.archiveTo(commit, out, ["docs/releases/0.1.0.md", "[odd] name.md"]);

    const oddFile = join(out, "[odd] name.md");
    const notesFile = join(out, "docs", "releases", "0.1.0.md");
    const internalDir = join(out, "docs", "internal");
    expect(readFileSync(oddFile, "utf8")).toBe("odd\n");
    expect(existsSync(notesFile)).toBe(true);
    expect(existsSync(internalDir)).toBe(false);
  });

  it("refuses to archive an empty path list and writes nothing", () => {
    const repos = makeRepos();
    const out = join(repos.root, "out");
    mkdirSync(out);
    const port = createGitPort(repos.clone);

    expect(() => port.archiveTo(repos.head, out, [])).toThrow(
      /at least one path/,
    );
    expect(readdirSync(out)).toEqual([]);
  });
});
