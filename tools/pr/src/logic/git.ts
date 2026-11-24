import type { Result } from "types/utils";

import type { Checkout, CommandRunner } from "../types";

const NOT_ANCESTOR_STATUS = 1;

export function readOriginUrl(git: CommandRunner): Result<string, Error> {
  const run = git(["remote", "get-url", "origin"]);
  if (run.status !== 0) {
    return {
      ok: false,
      error: new Error(`no origin remote: ${run.stderr.trim()}`),
    };
  }
  return { ok: true, value: run.stdout.trim() };
}

/** One fetch for every branch the check reads; a failure leaves alignment unknown. */
export function fetchBranches(
  git: CommandRunner,
  branches: readonly string[],
): boolean {
  if (branches.length === 0) {
    return true;
  }
  return (
    git(["fetch", "-q", "--end-of-options", "origin", ...branches]).status === 0
  );
}

/** `undefined` when git could not answer, never a guess. */
export function isBaseAncestor(
  git: CommandRunner,
  base: string,
  head: string,
): boolean | undefined {
  const run = git([
    "merge-base",
    "--is-ancestor",
    `origin/${base}`,
    `origin/${head}`,
  ]);
  if (run.status === 0) {
    return true;
  }
  if (run.status === NOT_ANCESTOR_STATUS) {
    return false;
  }
  return undefined;
}

export function readCheckout(git: CommandRunner): Checkout {
  const branch = git(["branch", "--show-current"]).stdout.trim();
  const status = git(["status", "--porcelain", "--untracked-files=no"]);
  return {
    branch: branch === "" ? undefined : branch,
    headSha: git(["rev-parse", "HEAD"]).stdout.trim(),
    isDirty: status.stdout.trim() !== "",
  };
}
