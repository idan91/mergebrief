// Vitest SIGKILLs a worker that overruns a timeout, and neither `afterEach`
// nor a `finally` runs when it does, so the API process that worker spawned is
// reparented to init. Its PGlite socket server died with the worker, so it
// spins on reconnect and starves the next test, which times out and leaks
// another. `globalTeardown` is the one hook that still runs in the main
// process afterwards: it sweeps what the workers could not.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync } from "node:fs";

const PID_FILE_ENV = "MERGEBRIEF_CLI_PIDFILE";

function getPidFile(): string | undefined {
  return process.env[PID_FILE_ENV];
}

/** Called by `globalSetup`, before any worker forks and inherits the env. */
export function setPidFile(path: string): void {
  process.env[PID_FILE_ENV] = path;
}

/** Append-only: workers write concurrently, one short line each. */
export function recordApiPid(pid: number): void {
  const file = getPidFile();
  if (file === undefined) {
    return;
  }
  appendFileSync(file, `${String(pid)}\n`);
}

/** A recycled pid belongs to somebody else, so match our spawn shape first. */
function isLeakedApiProcess(pid: number): boolean {
  try {
    const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
    });
    return command.includes("tsx") && command.includes("src/main.ts");
  } catch {
    return false;
  }
}

export function sweepLeakedApiProcesses(): number {
  const file = getPidFile();
  if (file === undefined) {
    return 0;
  }
  let contents = "";
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  let swept = 0;
  for (const line of contents.split("\n")) {
    const pid = Number.parseInt(line, 10);
    if (!Number.isInteger(pid) || pid <= 1) {
      continue;
    }
    if (!isLeakedApiProcess(pid)) {
      continue;
    }
    try {
      process.kill(pid, "SIGKILL");
      swept += 1;
    } catch {
      // Exited between the check and the signal.
    }
  }
  rmSync(file, { force: true });
  return swept;
}
