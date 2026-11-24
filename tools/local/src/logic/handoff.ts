import type { Result } from "types/utils";

import type { CommandRunner, HandoffDeps } from "../types";

const WEB_INPUTS = ["apps/web/", "packages/"];
const API_INPUTS = ["apps/api/", "packages/"];

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

/**
 * Moves the maintainer's checkout to `branch` and catches up what a branch
 * switch leaves stale: dependencies, the built web dist, and the dev api,
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
  const lockBefore = runOrFail(
    git,
    ["rev-parse", "HEAD:pnpm-lock.yaml"],
    "git rev-parse",
  );
  const switched = runOrFail(
    git,
    ["switch", "--end-of-options", branch],
    `git switch ${branch}`,
  );
  if (!switched.ok) {
    return switched;
  }
  const after = runOrFail(git, ["rev-parse", "HEAD"], "git rev-parse");
  const lockAfter = runOrFail(
    git,
    ["rev-parse", "HEAD:pnpm-lock.yaml"],
    "git rev-parse",
  );
  if (!before.ok || !after.ok) {
    return {
      ok: false,
      error: new Error("could not read HEAD around the switch"),
    };
  }
  const diff = runOrFail(
    git,
    ["diff", "--name-only", before.value, after.value],
    "git diff",
  );
  if (!diff.ok) {
    return diff;
  }
  const changed = diff.value.split("\n").filter((path) => path !== "");

  const lines = [`switched to ${branch}`];
  const lockfileMoved =
    !lockBefore.ok || !lockAfter.ok || lockBefore.value !== lockAfter.value;
  if (lockfileMoved) {
    const installed = runOrFail(
      pnpm,
      ["install", "--frozen-lockfile"],
      "pnpm install",
    );
    if (!installed.ok) {
      return installed;
    }
    lines.push("lockfile changed: pnpm install --frozen-lockfile done");
  }
  if (touches(changed, WEB_INPUTS)) {
    const built = runOrFail(pnpm, ["-C", "apps/web", "build"], "web build");
    if (!built.ok) {
      return built;
    }
    lines.push("web inputs changed: apps/web rebuilt");
  }
  if (touches(changed, API_INPUTS)) {
    lines.push("api inputs changed: restart pnpm dev, the api does not reload");
  }
  lines.push(describeNode(deps.nodeVersion, deps.pinnedNodeVersion));
  return { ok: true, value: lines.join("\n") };
}
