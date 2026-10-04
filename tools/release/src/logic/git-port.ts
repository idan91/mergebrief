import { execFileSync } from "node:child_process";

import { DEFAULT_BRANCH, DEFAULT_BRANCH_REF, GIT_REMOTE } from "../consts";
import type { GitPort } from "../types";

const TAG_REF_PREFIX = "refs/tags/";

const CREDENTIALS_IN_URL = /:\/\/[^/@\s]+@/g;

/** A git command that exited non-zero; `detail` is git's own last line, credentials stripped. */
export class GitCommandError extends Error {
  readonly detail: string;

  constructor(args: readonly string[], stderr: string) {
    const lastLine = stderr.trim().split("\n").at(-1) ?? "";
    const detail = lastLine.replace(CREDENTIALS_IN_URL, "://<redacted>@");
    super(`git ${args.join(" ")}: ${detail}`);
    this.name = "GitCommandError";
    this.detail = detail;
  }
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
    });
  } catch (cause) {
    const stderr = isExecError(cause) ? String(cause.stderr ?? "") : "";
    throw new GitCommandError(args, stderr);
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
      const tags = listed
        .split("\n")
        .map((line) => line.split("\t")[1] ?? "")
        .filter((ref) => ref.startsWith(TAG_REF_PREFIX))
        .map((ref) => ref.slice(TAG_REF_PREFIX.length));
      return tags;
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
  };
}
