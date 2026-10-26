import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_BRANCH, DEFAULT_BRANCH_REF, GIT_REMOTE } from "../consts";
import type { GitPort } from "../types";

const TAG_REF_PREFIX = "refs/tags/";

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

const NUL = "\0";

const CREDENTIALS_IN_URL = /:\/\/[^/@\s]+@/g;

/** A git command that exited non-zero; `detail` is git's own last line, credentials stripped. */
export class GitCommandError extends Error {
  readonly detail: string;
  /** All of git's stderr, credentials stripped. */
  readonly stderr: string;

  constructor(args: readonly string[], stderr: string) {
    const redacted = stderr
      .trim()
      .replace(CREDENTIALS_IN_URL, "://<redacted>@");
    const detail = redacted.split("\n").at(-1) ?? "";
    super(`git ${args.join(" ")}: ${detail}`);
    this.name = "GitCommandError";
    this.detail = detail;
    this.stderr = redacted;
  }
}

// What git prints when nothing public answers at a URL: GitHub's missing or
// private repository, a path that is no repository, or an anonymous read
// asked for credentials it is not allowed to prompt for.
const REPOSITORY_NOT_FOUND = [
  /repository '[^']*' not found/i,
  /does not appear to be a git repository/,
  /could not read Username/,
  /unable to get password from user/,
] as const;

export function isRepositoryNotFound(stderr: string): boolean {
  return REPOSITORY_NOT_FOUND.some((pattern) => pattern.test(stderr));
}

function parseTagRefs(listed: string): readonly string[] {
  const lines = listed.split("\n");
  const refs = lines.map((line) => line.split("\t")[1] ?? "");
  const tags = refs
    .filter((ref) => ref.startsWith(TAG_REF_PREFIX))
    .map((ref) => ref.slice(TAG_REF_PREFIX.length));
  return tags;
}

function listUrlTags(cwd: string, url: string): readonly string[] | undefined {
  try {
    const listed = runGit(cwd, [
      "-c",
      "credential.interactive=false",
      "ls-remote",
      "--tags",
      "--refs",
      url,
    ]);
    return parseTagRefs(listed);
  } catch (cause) {
    const notFound =
      cause instanceof GitCommandError && isRepositoryNotFound(cause.stderr);
    if (notFound) {
      return undefined;
    }
    throw cause;
  }
}

const SCRATCH_IDENTITY = [
  "-c",
  "user.name=release scratch",
  "-c",
  "user.email=release@localhost",
  "-c",
  "commit.gpgsign=false",
] as const;

function commitEveryFile(dir: string): void {
  runGit(dir, ["init", "--quiet", "--initial-branch=main"]);
  runGit(dir, ["add", "--all", "--force"]);
  runGit(dir, [
    ...SCRATCH_IDENTITY,
    "commit",
    "--quiet",
    "--no-verify",
    "-m",
    "export tree",
  ]);
}

/** What execFileSync throws on a non-zero exit, as far as this port reads it. */
interface ExecError {
  readonly stderr?: string | Buffer;
}

function isExecError(cause: unknown): cause is ExecError {
  const execShaped =
    typeof cause === "object" && cause !== null && "stderr" in cause;
  return execShaped;
}

function runGit(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (cause) {
    const stderr = isExecError(cause) ? String(cause.stderr ?? "") : "";
    throw new GitCommandError(args, stderr);
  }
}

/** `git archive` of exactly `paths`, unpacked by tar; the tarball lives outside `dir`. */
function archivePaths(
  cwd: string,
  commit: string,
  dir: string,
  paths: readonly string[],
): void {
  if (paths.length === 0) {
    throw new Error(
      "archive needs at least one path; git archive with none writes the whole commit",
    );
  }
  const scratchPrefix = join(tmpdir(), "release-archive-");
  const scratch = mkdtempSync(scratchPrefix);
  const tarball = join(scratch, "tree.tar");
  try {
    runGit(cwd, [
      "--literal-pathspecs",
      "archive",
      "--format=tar",
      `--output=${tarball}`,
      commit,
      "--",
      ...paths,
    ]);
    execFileSync("tar", ["-xf", tarball], {
      cwd: dir,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** `undefined` where git says no (exit 1); any other failure still throws. */
function tryGit(cwd: string, args: readonly string[]): string | undefined {
  try {
    return runGit(cwd, args);
  } catch {
    return undefined;
  }
}

/** The real git under `cwd`; tags are read from the remote, never from local refs alone. */
export function createGitPort(cwd: string): GitPort {
  return {
    fetchDefaultBranch() {
      const refspec = `+refs/heads/${DEFAULT_BRANCH}:${DEFAULT_BRANCH_REF}`;
      runGit(cwd, ["fetch", "--quiet", "--no-tags", GIT_REMOTE, refspec]);
    },
    listRemoteTags() {
      const listed = runGit(cwd, ["ls-remote", "--tags", "--refs", GIT_REMOTE]);
      return parseTagRefs(listed);
    },
    listPublicTags(url) {
      return listUrlTags(cwd, url);
    },
    commitScratchRepo(dir) {
      commitEveryFile(dir);
    },
    resolveCommit(ref) {
      const resolved = tryGit(cwd, [
        "rev-parse",
        "--verify",
        "--quiet",
        `${ref}^{commit}`,
      ]);
      return resolved?.trim();
    },
    isOnDefaultBranch(commit) {
      const onBranch = tryGit(cwd, [
        "merge-base",
        "--is-ancestor",
        commit,
        DEFAULT_BRANCH_REF,
      ]);
      return onBranch !== undefined;
    },
    readFileAt(commit, path) {
      return tryGit(cwd, ["show", `${commit}:${path}`]);
    },
    hasLocalTag(tag) {
      const listed = tryGit(cwd, ["tag", "--list", tag]) ?? "";
      const found = listed.trim().length > 0;
      return found;
    },
    createTag(tag, commit) {
      runGit(cwd, ["tag", tag, commit]);
    },
    pushTag(tag) {
      runGit(cwd, [
        "push",
        "--no-follow-tags",
        GIT_REMOTE,
        `${TAG_REF_PREFIX}${tag}`,
      ]);
    },
    listTrackedPaths(commit) {
      const listed = runGit(cwd, [
        "ls-tree",
        "-r",
        "-z",
        "--name-only",
        commit,
      ]);
      const paths = listed.split(NUL).filter((path) => path.length > 0);
      return paths;
    },
    archiveTo(commit, dir, paths) {
      archivePaths(cwd, commit, dir, paths);
    },
  };
}
