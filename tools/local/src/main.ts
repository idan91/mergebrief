// The local tool's composition root: argv, the repo root, child processes and
// signals enter here, and the exit code is the verdict.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runE2eStop } from "./logic/e2e-stop";
import { runHandoff } from "./logic/handoff";
import type { CommandRunner, ProcessControl } from "./types";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const USAGE = `usage:
  handoff <branch>   switch the checkout, then install, rebuild web, and say what to restart
  e2e-stop           stop the api and postgres of an e2e run whose playwright died`;

function makeRunner(command: string): CommandRunner {
  return (args) => {
    const run = spawnSync(command, args, { cwd: REPO_ROOT, encoding: "utf8" });
    return {
      status: run.status ?? 1,
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? String(run.error ?? ""),
    };
  };
}

const processes: ProcessControl = {
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM: the process exists but belongs to another user.
      return (
        error instanceof Error && "code" in error && error.code === "EPERM"
      );
    }
  },
  terminate: (pid) => {
    process.kill(pid, "SIGTERM");
  },
};

const [command, ...rest] = process.argv.slice(2);
const branch = rest[0];

if (command === "handoff" && branch !== undefined && rest.length === 1) {
  const result = runHandoff(
    {
      git: makeRunner("git"),
      pnpm: makeRunner("pnpm"),
      nodeVersion: process.version,
      pinnedNodeVersion: readFileSync(join(REPO_ROOT, ".nvmrc"), "utf8"),
    },
    branch,
  );
  if (result.ok) {
    process.stdout.write(`${result.value}\n`);
  } else {
    process.stderr.write(`local: ${result.error.message}\n`);
    process.exitCode = 1;
  }
} else if (command === "e2e-stop" && rest.length === 0) {
  const report = runE2eStop({
    artifactsDir: join(REPO_ROOT, "apps/web/e2e/.artifacts"),
    docker: makeRunner("docker"),
    pgrep: makeRunner("pgrep"),
    processes,
  });
  process.stdout.write(`${report}\n`);
} else {
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 1;
}
