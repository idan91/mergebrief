import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeText } from "./helpers";

const GIT_CONFIG = [
  "-c",
  "user.name=fixture",
  "-c",
  "user.email=fixture@example.com",
  "-c",
  "init.defaultBranch=main",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.autocrlf=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
];

/** One file's lines at each of a revision's four commits. */
export interface RevisionHeads {
  readonly prevBase: readonly string[];
  readonly prevHead: readonly string[];
  readonly newBase: readonly string[];
  readonly newHead: readonly string[];
}

export interface GitRevisionDiffs {
  readonly prevPrDiff: string;
  readonly newPrDiff: string;
  readonly betweenHeadsPatch: string;
}

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...GIT_CONFIG, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commitLines(
  root: string,
  path: string,
  lines: readonly string[],
): string {
  writeFileSync(join(root, path), makeText(lines));
  runGit(root, ["add", path]);
  runGit(root, ["commit", "-q", "--no-verify", "--allow-empty", "-m", "rev"]);
  const sha = runGit(root, ["rev-parse", "HEAD"]);
  return sha.trim();
}

function readGitDiff(
  root: string,
  path: string,
  from: string,
  to: string,
): string {
  return runGit(root, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "-U3",
    from,
    to,
    "--",
    path,
  ]);
}

/**
 * The diffs a real git computes for one file across a revision: both
 * heads' PR diffs and the between-heads patch, each from its own commits.
 */
export function readGitRevisionDiffs(
  path: string,
  heads: RevisionHeads,
): GitRevisionDiffs {
  const root = mkdtempSync(join(tmpdir(), "pr-span-git-"));
  try {
    runGit(root, ["init", "-q"]);
    mkdirSync(join(root, dirname(path)), { recursive: true });
    const prevBase = commitLines(root, path, heads.prevBase);
    const prevHead = commitLines(root, path, heads.prevHead);
    const newBase = commitLines(root, path, heads.newBase);
    const newHead = commitLines(root, path, heads.newHead);

    const betweenHeads = readGitDiff(root, path, prevHead, newHead);
    return {
      prevPrDiff: readGitDiff(root, path, prevBase, prevHead),
      newPrDiff: readGitDiff(root, path, newBase, newHead),
      betweenHeadsPatch: betweenHeads.replace(/\n$/, ""),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
