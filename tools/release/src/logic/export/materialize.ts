import { mkdirSync, readdirSync, statSync } from "node:fs";
import type { Result } from "types/utils";

import { DEFAULT_BRANCH, GIT_REMOTE } from "../../consts";
import type { GitPort } from "../../types";
import type { ExportError, MaterializeInput } from "./types";

/**
 * The commit `ref` names, refused unless the freshly fetched remote main
 * holds it: the export reads one merged commit, never the checkout.
 */
export function resolveExportSource(
  git: GitPort,
  ref: string,
): Result<string, ExportError> {
  git.fetchDefaultBranch();

  const commit = git.resolveCommit(ref);
  if (commit === undefined) {
    return { ok: false, error: { reason: `${ref} is not a commit` } };
  }
  if (!git.isOnDefaultBranch(commit)) {
    const reason = `${commit} is not on ${GIT_REMOTE}/${DEFAULT_BRANCH}; export a commit main holds`;
    return { ok: false, error: { reason } };
  }
  return { ok: true, value: commit };
}

/** `dir` created when absent; refused when it is a file or holds anything. */
export function prepareEmptyDir(
  dir: string,
  flag: "--out" | "--emit",
): Result<void, ExportError> {
  const stats = statSync(dir, { throwIfNoEntry: false });
  if (stats === undefined) {
    mkdirSync(dir, { recursive: true });
    return { ok: true, value: undefined };
  }
  if (!stats.isDirectory()) {
    return { ok: false, error: { reason: `${dir} is not a dir` } };
  }
  if (readdirSync(dir).length > 0) {
    const reason = `${dir} is not empty; pass a new or empty ${flag} dir`;
    return { ok: false, error: { reason } };
  }
  return { ok: true, value: undefined };
}

/** The shipped paths as the commit holds them, written into an empty `out`. */
export function materializeTree(
  git: GitPort,
  input: MaterializeInput,
): Result<void, ExportError> {
  if (input.shipped.length === 0) {
    const reason = `${input.commit} ships no path; nothing to export`;
    return { ok: false, error: { reason } };
  }
  const ready = prepareEmptyDir(input.out, "--out");
  if (!ready.ok) {
    return ready;
  }

  git.archiveTo(input.commit, input.out, input.shipped);
  return { ok: true, value: undefined };
}
