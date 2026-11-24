import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PLAYWRIGHT_RUN, runE2eStop } from "../src/logic/e2e-stop";
import type { CommandOutcome, CommandRunner, E2eStopDeps } from "../src/types";

const OK = (stdout = ""): CommandOutcome => ({ status: 0, stdout, stderr: "" });

interface World {
  readonly alive: ReadonlySet<number>;
  readonly commands?: ReadonlyMap<number, string>;
  readonly otherDirs?: readonly string[];
  readonly containerRunning?: boolean;
  readonly playwrightRunning?: boolean;
}

function makeDeps(artifactsDir: string, world: World) {
  const terminated: number[] = [];
  const dockerCalls: string[] = [];
  const docker: CommandRunner = (args) => {
    const line = args.join(" ");
    dockerCalls.push(line);
    if (line.startsWith("ps")) {
      return OK(world.containerRunning === true ? "mergebrief-e2e-pg\n" : "");
    }
    return OK();
  };
  function pgrep(args: readonly string[]): CommandOutcome {
    // A pattern that misses real runs reads as "playwright running" here, so the
    // unowned-container test fails if the matched process shape regresses.
    if (args.at(-1) !== PLAYWRIGHT_RUN) {
      return OK();
    }
    if (world.playwrightRunning === true) {
      return OK("123\n");
    }
    return { status: 1, stdout: "", stderr: "" };
  }
  const deps: E2eStopDeps = {
    artifactsDir,
    allArtifactsDirs: [artifactsDir, ...(world.otherDirs ?? [])],
    docker,
    pgrep,
    processes: {
      isAlive: (pid) => world.alive.has(pid),
      readCommandLine: (pid) =>
        world.commands?.get(pid) ??
        "node --import /r/node_modules/tsx/dist/loader.mjs /r/apps/api/src/main.ts",
      terminate: (pid) => {
        terminated.push(pid);
        return true;
      },
    },
  };
  return { deps, terminated, dockerCalls };
}

function makeArtifacts(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "e2e-artifacts-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe("PLAYWRIGHT_RUN", () => {
  it("matches the command lines a live suite actually has", () => {
    const pattern = new RegExp(PLAYWRIGHT_RUN);
    const live = [
      "node /r/apps/web/node_modules/.bin/../@playwright/test/cli.js test",
      "node /r/node_modules/@playwright/test/cli.js test --config playwright.perf.config.ts",
      "/bin/sh /r/apps/web/node_modules/.bin/playwright test",
    ];

    expect(live.filter((line) => !pattern.test(line))).toEqual([]);
    expect(pattern.test("node /r/apps/api/src/main.ts")).toBe(false);
  });
});

describe("runE2eStop", () => {
  it("stops the api and container of a run whose playwright died", () => {
    const dir = makeArtifacts({
      "api-pid-500": "600",
      "pg-container-id-500": "abc123def456\n",
    });
    const { deps, terminated, dockerCalls } = makeDeps(dir, {
      alive: new Set([600]),
    });

    const result = runE2eStop(deps);

    expect(terminated).toEqual([600]);
    expect(dockerCalls).toContain("stop abc123def456");
    expect(readdirSync(dir)).toEqual([]);
    expect(result).toBe(
      "run 500: api 600 stopped, container abc123def456 stopped",
    );
  });

  it("never signals a reused pid that no longer runs node", () => {
    const dir = makeArtifacts({
      "api-pid-500": "600",
      "pg-container-id-500": "abc123def456",
    });
    const { deps, terminated } = makeDeps(dir, {
      alive: new Set([600]),
      commands: new Map([[600, "/Applications/Editor.app/editor"]]),
    });

    const result = runE2eStop(deps);

    expect(terminated).toEqual([]);
    expect(result).toContain("pid 600 now runs something else, not signalled");
  });

  it("ignores a container id file that does not hold an id", () => {
    const dir = makeArtifacts({ "pg-container-id-500": "--time=0" });
    const { deps, dockerCalls } = makeDeps(dir, { alive: new Set() });

    runE2eStop(deps);

    expect(dockerCalls.filter((call) => call.startsWith("stop"))).toEqual([]);
  });

  it("leaves a run whose playwright is still alive", () => {
    const dir = makeArtifacts({
      "api-pid-500": "600",
      "pg-container-id-500": "abc123",
    });
    const { deps, terminated, dockerCalls } = makeDeps(dir, {
      alive: new Set([500, 600]),
    });

    const result = runE2eStop(deps);

    expect(terminated).toEqual([]);
    expect(dockerCalls.filter((call) => call.startsWith("stop"))).toEqual([]);
    expect(result).toBe(
      "run 500 is still running (playwright pid 500), left alone",
    );
  });

  it("stops an unowned container only when no playwright is running", () => {
    const dir = makeArtifacts({});
    const { deps, dockerCalls } = makeDeps(dir, {
      alive: new Set(),
      containerRunning: true,
    });

    const result = runE2eStop(deps);

    expect(dockerCalls).toContain("stop mergebrief-e2e-pg");
    expect(result).toBe("mergebrief-e2e-pg had no owning run: stopped");
  });

  it("leaves the shared container to a live run in another worktree", () => {
    const other = makeArtifacts({ "api-pid-700": "701" });
    const { deps, dockerCalls } = makeDeps(makeArtifacts({}), {
      alive: new Set([700]),
      containerRunning: true,
      otherDirs: [other],
    });

    runE2eStop(deps);

    expect(dockerCalls.filter((call) => call.startsWith("stop"))).toEqual([]);
  });

  it("keeps an unowned container while some playwright runs", () => {
    const dir = makeArtifacts({});
    const { deps, dockerCalls } = makeDeps(dir, {
      alive: new Set(),
      containerRunning: true,
      playwrightRunning: true,
    });

    const result = runE2eStop(deps);

    expect(dockerCalls.filter((call) => call.startsWith("stop"))).toEqual([]);
    expect(result).toContain("a playwright process is running");
  });

  it("says so when there is nothing to stop", () => {
    const { deps } = makeDeps(makeArtifacts({}), { alive: new Set() });

    expect(runE2eStop(deps)).toBe("nothing to stop");
  });
});
