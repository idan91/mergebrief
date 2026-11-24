import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAssets } from "../src/logic/assets";
import type { CommandOutcome, CommandRunner } from "../src/types";

const IDENTITY = ["-c", "user.email=pr@example.invalid", "-c", "user.name=pr"];

function makeGitRunner(cwd: string): CommandRunner {
  return (args, input) => {
    const run = spawnSync("git", [...IDENTITY, ...args], {
      cwd,
      encoding: "utf8",
      input,
    });
    return { status: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
  };
}

function makeGh(isPrivate: boolean): CommandRunner {
  return (): CommandOutcome => ({
    status: 0,
    stdout: `${String(isPrivate)}\n`,
    stderr: "",
  });
}

interface Sandbox {
  readonly git: CommandRunner;
  readonly remote: string;
  readonly work: string;
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "pr-assets-"));
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  spawnSync("git", ["init", "-q", "--bare", remote]);
  spawnSync("git", ["init", "-q", work]);
  const git = makeGitRunner(work);
  git(["remote", "add", "origin", "git@github.com:idan91/mergebrief.git"]);
  git(["remote", "set-url", "--push", "origin", remote]);
  git(["config", "remote.origin.url", remote]);
  return { git, remote, work };
}

function writeImage(dir: string, name: string, bytes: string): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

function readRemote(remote: string, args: readonly string[]): string {
  return spawnSync("git", ["--git-dir", remote, ...args], {
    encoding: "utf8",
  }).stdout.trim();
}

const SLUG = { owner: "idan91", name: "mergebrief" };

describe("runAssets", () => {
  it("creates the assets branch and links each file at its commit", () => {
    const box = makeSandbox();
    const before = writeImage(box.work, "before.png", "png-a");

    const result = runAssets(
      { git: box.git, gh: makeGh(false), slug: SLUG },
      "BRIEF-476",
      [before],
    );

    expect(result.ok).toBe(true);
    const commit = readRemote(box.remote, ["rev-parse", "assets/brief-476"]);
    expect(
      readRemote(box.remote, ["show", `${commit}:brief-476/before.png`]),
    ).toBe("png-a");
    expect(result.ok && result.value).toBe(
      `![before](https://raw.githubusercontent.com/idan91/mergebrief/${commit}/brief-476/before.png)`,
    );
  });

  it("adds to an existing branch without dropping earlier files", () => {
    const box = makeSandbox();
    const deps = { git: box.git, gh: makeGh(true), slug: SLUG };
    runAssets(deps, "BRIEF-476", [writeImage(box.work, "before.png", "png-a")]);

    const result = runAssets(deps, "BRIEF-476", [
      writeImage(box.work, "after.png", "png-b"),
    ]);

    const commit = readRemote(box.remote, ["rev-parse", "assets/brief-476"]);
    expect(
      readRemote(box.remote, ["ls-tree", "--name-only", `${commit}:brief-476`]),
    ).toBe("after.png\nbefore.png");
    expect(readRemote(box.remote, ["rev-list", "--count", commit])).toBe("2");
    expect(result.ok && result.value).toBe(
      `![after](https://github.com/idan91/mergebrief/blob/${commit}/brief-476/after.png?raw=true)`,
    );
  });

  it("refuses a file that is not an image or video", () => {
    const box = makeSandbox();

    const result = runAssets(
      { git: box.git, gh: makeGh(false), slug: SLUG },
      "BRIEF-476",
      [writeImage(box.work, "notes.md", "text")],
    );

    expect(result.ok).toBe(false);
    expect(readRemote(box.remote, ["branch", "--list", "assets/*"])).toBe("");
  });

  it("refuses a ticket id that is not KEY-number", () => {
    const box = makeSandbox();

    const result = runAssets(
      { git: box.git, gh: makeGh(false), slug: SLUG },
      "../main",
      [writeImage(box.work, "a.png", "png")],
    );

    expect(result).toEqual({
      ok: false,
      error: new Error('ticket "../main" is not KEY-number, e.g. BRIEF-476'),
    });
  });
});
