import type { Result } from "types/utils";

import type { CommandRunner, HandoffDeps } from "../types";

const WEB_INPUTS = ["apps/web/", "packages/"];
const API_INPUTS = ["apps/api/", "packages/"];
const LOCKFILE = "pnpm-lock.yaml";
const COMMIT_SHA = /^[0-9a-f]{40,64}$/;
/** pnpm's copy of the lockfile it last installed from. */
const INSTALLED_LOCKFILE = "node_modules/.pnpm/lock.yaml";
/** The commit the web dist was last built from; gitignored with node_modules. */
export const WEB_BUILD_STAMP =
  "apps/web/node_modules/.cache/handoff/web-built-from";

function runOrFail(
  run: CommandRunner,
  args: readonly string[],
  label: string,
): Result<string, Error> {
  const outcome = run(args);
  if (outcome.status !== 0) {
    return {
      ok: false,
      error: new Error(`${label} failed: ${outcome.stderr.trim()}`),
    };
  }
  return { ok: true, value: outcome.stdout.trim() };
}

/** Changed paths, or undefined when git cannot diff the two commits. */
function listChanged(
  git: CommandRunner,
  from: string,
  to: string,
): string[] | undefined {
  const diff = runOrFail(
    git,
    ["diff", "--name-only", "--end-of-options", from, to],
    "git diff",
  );
  return diff.ok
    ? diff.value.split("\n").filter((path) => path !== "")
    : undefined;
}

function touches(
  changed: readonly string[],
  prefixes: readonly string[],
): boolean {
  return changed.some((path) =>
    prefixes.some((prefix) => path.startsWith(prefix)),
  );
}

function describeNode(nodeVersion: string, pinned: string): string {
  const wanted = pinned.trim().replace(/^v/, "");
  if (nodeVersion.trim() === `v${wanted}`) {
    return `node ${nodeVersion.trim()} matches .nvmrc`;
  }
  return `node ${nodeVersion.trim()} is not .nvmrc's ${wanted}: run nvm use before pnpm dev`;
}

function isWebStale(deps: HandoffDeps, head: string): boolean {
  const builtFrom = deps.files.read(WEB_BUILD_STAMP)?.trim();
  if (builtFrom === undefined || !COMMIT_SHA.test(builtFrom)) {
    return true;
  }
  const changed = listChanged(deps.git, builtFrom, head);
  return changed === undefined || touches(changed, WEB_INPUTS);
}

/**
 * Moves the maintainer's checkout to `branch` and catches up what is actually
 * stale, read from disk rather than from the switch, so a rerun after a failed
 * step finishes the job: dependencies, the built web dist, and the dev api,
 * which has no watch mode.
 */
export function runHandoff(
  deps: HandoffDeps,
  branch: string,
): Result<string, Error> {
  const { git, pnpm } = deps;
  const status = runOrFail(
    git,
    ["status", "--porcelain", "--untracked-files=no"],
    "git status",
  );
  if (!status.ok) {
    return status;
  }
  if (status.value !== "") {
    return {
      ok: false,
      error: new Error(
        "the checkout has uncommitted changes; commit or move them first",
      ),
    };
  }

  const before = runOrFail(git, ["rev-parse", "HEAD"], "git rev-parse");
  const switched = runOrFail(
    git,
    ["switch", "--end-of-options", branch],
    `git switch ${branch}`,
  );
  if (!switched.ok) {
    return switched;
  }
  const after = runOrFail(git, ["rev-parse", "HEAD"], "git rev-parse");
  const lines = [`switched to ${branch}`];
  function failAfterSwitch(error: Error): Result<string, Error> {
    return {
      ok: false,
      error: new Error(
        `now on ${branch}, but ${error.message}; rerun pnpm checkout:handoff ${branch} to finish`,
      ),
    };
  }

  const dependenciesStale =
    deps.files.read(LOCKFILE) !== deps.files.read(INSTALLED_LOCKFILE);
  if (dependenciesStale) {
    const installed = runOrFail(
      pnpm,
      ["install", "--frozen-lockfile"],
      "pnpm install",
    );
    if (!installed.ok) {
      return failAfterSwitch(installed.error);
    }
    lines.push("dependencies were stale: pnpm install --frozen-lockfile done");
  }
  if (after.ok && isWebStale(deps, after.value)) {
    const built = runOrFail(pnpm, ["-C", "apps/web", "build"], "web build");
    if (!built.ok) {
      return failAfterSwitch(built.error);
    }
    deps.files.write(WEB_BUILD_STAMP, `${after.value}\n`);
    lines.push("web dist was stale: apps/web rebuilt");
  }
  const apiChanged =
    before.ok && after.ok
      ? listChanged(git, before.value, after.value)
      : undefined;
  if (apiChanged === undefined || touches(apiChanged, API_INPUTS)) {
    lines.push("api inputs changed: restart pnpm dev, the api does not reload");
  }
  lines.push(describeNode(deps.nodeVersion, deps.pinnedNodeVersion));
  return { ok: true, value: lines.join("\n") };
}
