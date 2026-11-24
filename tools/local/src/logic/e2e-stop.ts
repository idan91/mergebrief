import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { E2eStopDeps } from "../types";

/** Shared with apps/web/e2e/harness/env.ts; a rename there must land here too. */
const E2E_PG_CONTAINER = "mergebrief-e2e-pg";
const API_PID_FILE = /^api-pid-(\d+)$/;
const CONTAINER_FILE_PREFIX = "pg-container-id-";

function readTrimmed(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
}

function listOwnerPids(artifactsDir: string): number[] {
  let names: string[];
  try {
    names = readdirSync(artifactsDir);
  } catch {
    return [];
  }
  const owners = new Set<number>();
  for (const name of names) {
    const owner =
      API_PID_FILE.exec(name)?.[1] ??
      (name.startsWith(CONTAINER_FILE_PREFIX)
        ? name.slice(CONTAINER_FILE_PREFIX.length)
        : undefined);
    const pid = Number(owner);
    if (Number.isInteger(pid) && pid > 1) {
      owners.add(pid);
    }
  }
  return [...owners].toSorted((left, right) => left - right);
}

function stopOrphanRun(deps: E2eStopDeps, owner: number): string {
  const apiFile = join(deps.artifactsDir, `api-pid-${owner}`);
  const containerFile = join(
    deps.artifactsDir,
    `${CONTAINER_FILE_PREFIX}${owner}`,
  );
  const parts: string[] = [];

  const apiPid = Number(readTrimmed(apiFile));
  if (
    Number.isInteger(apiPid) &&
    apiPid > 1 &&
    deps.processes.isAlive(apiPid)
  ) {
    deps.processes.terminate(apiPid);
    parts.push(`api ${apiPid} stopped`);
  }
  const containerId = readTrimmed(containerFile);
  if (containerId !== undefined && containerId !== "") {
    const stopped = deps.docker(["stop", containerId]).status === 0;
    parts.push(
      `container ${containerId} ${stopped ? "stopped" : "already gone"}`,
    );
  }
  rmSync(apiFile, { force: true });
  rmSync(containerFile, { force: true });
  return `run ${owner}: ${parts.length === 0 ? "nothing left running" : parts.join(", ")}`;
}

/**
 * Cleans up after an e2e run whose playwright process died before teardown.
 * A run whose owner is alive is never touched, and a container nobody claims
 * is stopped only while no playwright process exists at all. `docker stop`,
 * not `rm`: the harness reclaims a stopped container that carries its label.
 */
export function runE2eStop(deps: E2eStopDeps): string {
  const lines: string[] = [];
  for (const owner of listOwnerPids(deps.artifactsDir)) {
    if (deps.processes.isAlive(owner)) {
      lines.push(
        `run ${owner} is still running (playwright pid ${owner}), left alone`,
      );
    } else {
      lines.push(stopOrphanRun(deps, owner));
    }
  }

  const running = deps.docker([
    "ps",
    "--filter",
    `name=^${E2E_PG_CONTAINER}$`,
    "--format",
    "{{.Names}}",
  ]);
  const containerUp = running.stdout.trim() === E2E_PG_CONTAINER;
  const claimed = lines.length > 0;
  if (containerUp && !claimed) {
    const playwrightRunning =
      deps.pgrep(["-f", "playwright test"]).status === 0;
    if (playwrightRunning) {
      lines.push(
        `${E2E_PG_CONTAINER} is up with no owning run, but a playwright process is running: left alone`,
      );
    } else {
      deps.docker(["stop", E2E_PG_CONTAINER]);
      lines.push(`${E2E_PG_CONTAINER} had no owning run: stopped`);
    }
  }
  return lines.length === 0 ? "nothing to stop" : lines.join("\n");
}
