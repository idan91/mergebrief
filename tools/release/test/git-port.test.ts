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
import {
  createGitPort,
  GitCommandError,
  isRepositoryNotFound,
} from "../src/logic/git-port";
import {
  type GitRepos,
  makeGitRepos,
  makeNotesFile,
  makeTempRoot,
  runGit,
} from "./helpers";

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
  it("resolves a ref to its commit", () => {
    const repos = makeRepos();
    const port = createGitPort(repos.clone, { env: process.env });

    expect(port.resolveCommit("HEAD")).toBe(repos.head);
    expect(port.resolveCommit("no-such-ref")).toBeUndefined();
  });

  it("knows whether one commit contains another", () => {
    const repos = makeRepos();
    writeFileSync(join(repos.clone, "later.txt"), "x\n");
    runGit(repos.clone, ["add", "."]);
    runGit(repos.clone, ["commit", "--quiet", "-m", "later"]);
    const later = runGit(repos.clone, ["rev-parse", "HEAD"]).trim();
    const port = createGitPort(repos.clone, { env: process.env });

    expect(port.isAncestor(repos.head, later)).toBe(true);
    expect(port.isAncestor(repos.head, repos.head)).toBe(true);
    expect(port.isAncestor(later, repos.head)).toBe(false);
  });

  it("knows which commits the remote default branch holds", () => {
    const repos = makeRepos();
    runGit(repos.clone, ["switch", "--quiet", "-c", "side"]);
    writeFileSync(join(repos.clone, "side.txt"), "x\n");
    runGit(repos.clone, ["add", "."]);
    runGit(repos.clone, ["commit", "--quiet", "-m", "side"]);
    const side = runGit(repos.clone, ["rev-parse", "HEAD"]).trim();
    const port = createGitPort(repos.clone, { env: process.env });

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
    const port = createGitPort(repos.clone, { env: process.env });

    const failure = (): void => {
      port.fetchDefaultBranch();
    };

    expect(failure).toThrow(GitCommandError);
    expect(failure).toThrow(/^git fetch /);
    expect(failure).not.toThrow(/secret/);
  });

  it("lists the paths a commit tracks, never the untracked ones", () => {
    const repos = makeRepos();
    writeFileSync(join(repos.clone, "untracked.txt"), "x\n");
    const port = createGitPort(repos.clone, { env: process.env });

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
    const port = createGitPort(repos.clone, { env: process.env });

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
    const port = createGitPort(repos.clone, { env: process.env });

    expect(() => port.archiveTo(repos.head, out, [])).toThrow(
      /at least one path/,
    );
    expect(readdirSync(out)).toEqual([]);
  });

  it("lists a repository URL's tags and says when none answers there", () => {
    const repos = makeRepos();
    const empty = join(repos.root, "empty.git");
    runGit(repos.root, ["init", "--bare", "--quiet", empty]);
    const remote = join(repos.root, "remote.git");
    const missing = join(repos.root, "missing.git");
    const port = createGitPort(repos.clone, { env: process.env });

    expect(port.listPublicTags(remote)).toEqual(["v0.0.9"]);
    expect(port.listPublicTags(empty)).toEqual([]);
    expect(port.listPublicTags(missing)).toBeUndefined();
  });

  it("reads GitHub's missing-repository line as not found", () => {
    expect(
      isRepositoryNotFound(
        "fatal: repository 'https://github.com/Idan91/mergebrief.git/' not found",
      ),
    ).toBe(true);
    expect(isRepositoryNotFound("fatal: unable to access: timeout")).toBe(
      false,
    );
  });

  it("commits every file of a plain dir into a scratch repository", () => {
    const root = makeTempRoot();
    made.push(root);
    writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(root, "ignored.txt"), "tracked anyway\n");
    writeFileSync(join(root, "a.md"), "a\n");
    const port = createGitPort(root, { env: process.env });

    port.commitScratchRepo(root);

    const listed = runGit(root, ["ls-files"]).trim();
    expect(listed.split("\n")).toEqual([".gitignore", "a.md", "ignored.txt"]);
    expect(runGit(root, ["status", "--porcelain"])).toBe("");
  });
});
