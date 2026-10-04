import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitPort, GitCommandError } from "../src/logic/git-port";
import { makeNotesFile, makeTempRoot } from "./helpers";

interface Repos {
  readonly root: string;
  readonly clone: string;
  readonly head: string;
}

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

const made: string[] = [];

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A bare remote with one tag, and a clone whose main holds a notes file. */
function makeRepos(): Repos {
  const root = makeTempRoot();
  const remote = join(root, "remote.git");
  const clone = join(root, "clone");
  runGit(root, ["init", "--bare", "--quiet", "--initial-branch=main", remote]);
  runGit(root, ["clone", "--quiet", remote, clone]);
  runGit(clone, ["config", "user.email", "release@test"]);
  runGit(clone, ["config", "user.name", "release test"]);
  runGit(clone, ["config", "commit.gpgsign", "false"]);
  runGit(clone, ["config", "tag.gpgsign", "false"]);
  mkdirSync(join(clone, "docs", "releases"), { recursive: true });
  writeFileSync(
    join(clone, "docs", "releases", "0.1.0.md"),
    makeNotesFile({}, "First.\n"),
  );
  runGit(clone, ["add", "."]);
  runGit(clone, ["commit", "--quiet", "-m", "notes"]);
  runGit(clone, ["push", "--quiet", "origin", "main"]);
  runGit(clone, ["tag", "v0.0.9"]);
  runGit(clone, ["push", "--quiet", "origin", "refs/tags/v0.0.9"]);
  runGit(clone, ["tag", "-d", "v0.0.9"]);
  const head = runGit(clone, ["rev-parse", "HEAD"]).trim();
  made.push(root);
  return { root, clone, head };
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
});
