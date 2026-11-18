import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ExitCodes } from "../src/types";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const SECRET = "fake-secret";
const SECRET_URL = `https://user:${SECRET}@example.invalid/repo.git`;
const NODE_CRASH_EXIT = 1;

interface MainRun {
  readonly status: number | null;
  readonly output: string;
}

function runMain(argv: readonly string[]): MainRun {
  const ran = spawnSync(process.execPath, ["--import", "tsx", MAIN, ...argv], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
  });
  return { status: ran.status, output: `${ran.stdout}${ran.stderr}` };
}

describe("argument errors never echo URL credentials", () => {
  it("redacts an unknown assigned flag", () => {
    const run = runMain(["check", `--remote=${SECRET_URL}`]);

    expect(run.status).toBe(ExitCodes.USAGE);
    expect(run.output).toContain("unknown flag --remote=https://<redacted>@");
    expect(run.output).not.toContain(SECRET);
  });

  it("redacts an unexpected positional URL", () => {
    const run = runMain(["check", SECRET_URL]);

    expect(run.status).toBe(ExitCodes.USAGE);
    expect(run.output).toContain("unexpected argument https://<redacted>@");
    expect(run.output).not.toContain(SECRET);
  });

  it("redacts a crash whose error names the argument", () => {
    const out = `/nonexistent-release-dir/${SECRET_URL}`;

    const run = runMain(["release-body", "v0.1.0", "--out", out]);

    expect(run.status).toBe(NODE_CRASH_EXIT);
    expect(run.output).toContain("ENOENT");
    expect(run.output).not.toContain(SECRET);
  });
});
