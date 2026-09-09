import { spawnSync } from "node:child_process";
import type { Result } from "types";
import {
  BaseErrorCodes,
  ChangeKinds,
  type BaseError,
  type ChangedFile,
  type ChangeKind,
} from "../types";

interface GitRun {
  readonly status: number;
  readonly stdout: string;
}

/** One git invocation. Reads names and blobs only; never a working-tree file. */
function runGit(cwd: string, args: readonly string[]): GitRun {
  const run = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  if (run.error) throw run.error;
  return { status: run.status ?? -1, stdout: run.stdout };
}

/**
 * The repository root, so the gate reads the baseline files from the same
 * place whichever directory the script was invoked in.
 */
export function resolveRepoRoot(cwd: string): Result<string, BaseError> {
  const top = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const root = top.stdout.trim();
  if (top.status !== 0 || root.length === 0) {
    return {
      ok: false,
      error: {
        code: BaseErrorCodes.NOT_A_REPOSITORY,
        ref: "",
        message: `${cwd} is not a git work tree, so no baseline comparison is possible`,
      },
    };
  }
  return { ok: true, value: root };
}

/**
 * The commit the comparison runs against: the merge base of `ref` and HEAD,
 * mirroring CI's own two-dot selection. A ref this checkout does not carry is
 * an actionable failure, never a silent pass.
 */
export function resolveBaseCommit(
  cwd: string,
  ref: string,
): Result<string, BaseError> {
  const verified = runGit(cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
  ]);
  if (verified.status !== 0) {
    return {
      ok: false,
      error: {
        code: BaseErrorCodes.UNKNOWN_REF,
        ref,
        message: `base ref "${ref}" is not in this checkout; fetch it or pass another with --base`,
      },
    };
  }

  const merged = runGit(cwd, ["merge-base", ref, "HEAD"]);
  const base = merged.stdout.trim();
  if (merged.status !== 0 || base.length === 0) {
    return {
      ok: false,
      error: {
        code: BaseErrorCodes.NO_MERGE_BASE,
        ref,
        message: `no merge base between "${ref}" and HEAD; a shallow clone needs a deeper fetch`,
      },
    };
  }
  return { ok: true, value: base };
}

/** A tracked file's contents at `ref`, or `undefined` when the ref lacks it. */
export function readFileAtCommit(
  cwd: string,
  commit: string,
  path: string,
): string | undefined {
  const run = runGit(cwd, ["show", `${commit}:${path}`]);
  return run.status === 0 ? run.stdout : undefined;
}

// A copy lands at a new path, and a typechange is an edit like any other.
// Everything else, `U` unmerged included, means the tree is not in a state the
// gate can judge.
const KIND_BY_STATUS: Record<string, ChangeKind> = {
  A: ChangeKinds.ADDED,
  C: ChangeKinds.ADDED,
  M: ChangeKinds.MODIFIED,
  T: ChangeKinds.MODIFIED,
  D: ChangeKinds.DELETED,
  R: ChangeKinds.RENAMED,
};

/** Statuses git frames as `<status> <source> <destination>`. */
const TWO_PATH_STATUSES = new Set(["R", "C"]);

function unreadableTree(message: string): Result<never, BaseError> {
  return {
    ok: false,
    error: { code: BaseErrorCodes.UNREADABLE_TREE, ref: "", message },
  };
}

/**
 * `--name-status -z` records: one status token, then one path, or two for a
 * rename or copy. NUL framing keeps a path with a tab, a newline or non-ASCII
 * bytes matched against its baseline key instead of arriving quoted.
 */
export function readChangeRecords(
  tokens: readonly string[],
): Result<readonly ChangedFile[], BaseError> {
  const changed: ChangedFile[] = [];
  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index];
    index += 1;
    if (status === undefined || status.length === 0) continue;
    const kind = KIND_BY_STATUS[status.charAt(0)];
    if (kind === undefined) {
      return unreadableTree(
        `git reported status "${status}"; resolve the tree before linting`,
      );
    }
    const first = tokens[index];
    index += 1;
    if (first === undefined) {
      return unreadableTree(`git reported status "${status}" with no path`);
    }
    if (!TWO_PATH_STATUSES.has(status.charAt(0))) {
      changed.push({ path: first, kind });
      continue;
    }
    const second = tokens[index];
    index += 1;
    if (second === undefined) {
      return unreadableTree(
        `git reported status "${status}" from ${first} with no destination`,
      );
    }
    // The destination is the changed path either way. Only a rename carries
    // the source with it: a copy leaves the original in place with its debt.
    if (kind !== ChangeKinds.RENAMED) {
      changed.push({ path: second, kind });
      continue;
    }
    changed.push({ path: second, kind, previousPath: first });
  }
  return { ok: true, value: changed };
}

/**
 * What this branch changed against `baseCommit`, working tree included, so the
 * gate judges the tree lint actually reads. Rename detection is on: a rename
 * must carry its recorded debt rather than shed it. A git failure is an error,
 * never an empty change set, because an empty one silently disables the
 * cleanup-on-edit refusals while the run still reports clean.
 */
export function listChangedFiles(
  cwd: string,
  baseCommit: string,
): Result<readonly ChangedFile[], BaseError> {
  const run = runGit(cwd, [
    "diff",
    "--name-status",
    "-z",
    "--find-renames",
    baseCommit,
  ]);
  if (run.status !== 0) {
    return unreadableTree(
      `git diff against ${baseCommit} exited ${run.status}; the change set is unknown`,
    );
  }
  const tracked = readChangeRecords(run.stdout.split("\0"));
  if (!tracked.ok) return tracked;

  const untracked = listUntrackedFiles(cwd);
  if (!untracked.ok) return untracked;
  return { ok: true, value: [...tracked.value, ...untracked.value] };
}

/** Untracked files count as added: `pnpm lint` reads them too. */
function listUntrackedFiles(
  cwd: string,
): Result<readonly ChangedFile[], BaseError> {
  const run = runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (run.status !== 0) {
    return unreadableTree(
      `git could not list untracked files (exited ${run.status})`,
    );
  }
  return {
    ok: true,
    value: run.stdout
      .split("\0")
      .filter((path) => path.length > 0)
      .map((path) => ({ path, kind: ChangeKinds.ADDED })),
  };
}
