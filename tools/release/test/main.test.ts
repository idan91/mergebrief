import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ExitCodes } from "../src/types";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const SECRET = "fake-secret";
const SECRET_URL = `https://user:${SECRET}@example.invalid/repo.git`;
const NODE_CRASH_EXIT = 1;
const EXPORT_ARGS = ["export", "--version", "0.1.0", "--source", "main"];

interface MainRun {
  readonly status: number | null;
  readonly output: string;
}

/** Runs the CLI as the root script does; every case here stops before any git call. */
function runMain(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): MainRun {
  const ran = spawnSync(process.execPath, ["--import", "tsx", MAIN, ...argv], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
    env,
  });
  return { status: ran.status, output: `${ran.stdout}${ran.stderr}` };
}

describe("argument errors never echo URL credentials", () => {
  it("redacts an unknown assigned remote flag", () => {
    const run = runMain([...EXPORT_ARGS, `--public-remote=${SECRET_URL}`]);

    expect(run.status).toBe(ExitCodes.USAGE);
    expect(run.output).toContain(
      "unknown flag --public-remote=https://<redacted>@",
    );
    expect(run.output).not.toContain(SECRET);
  });

  it("redacts an unknown assigned private remote flag", () => {
    const run = runMain([...EXPORT_ARGS, `--private-remote=${SECRET_URL}`]);

    expect(run.status).toBe(ExitCodes.USAGE);
    expect(run.output).toContain(
      "unknown flag --private-remote=https://<redacted>@",
    );
    expect(run.output).not.toContain(SECRET);
  });

  it("redacts an unexpected positional URL", () => {
    const run = runMain([...EXPORT_ARGS, SECRET_URL]);

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

describe("the publish token an export needs", () => {
  const tokenless = { ...process.env, MERGEBRIEF_PUBLISH_TOKEN: "" };

  it("refuses authenticated reads in a dry run without the token", () => {
    const argv = [...EXPORT_ARGS, "--dry-run", "--authenticated-reads"];

    const run = runMain(argv, tokenless);

    expect(run.status).toBe(ExitCodes.REFUSED);
    expect(run.output).toContain(
      "--authenticated-reads reads the target repository with MERGEBRIEF_PUBLISH_TOKEN",
    );
  });

  it("refuses a publish without the token, as it did before the flag", () => {
    const run = runMain(EXPORT_ARGS, tokenless);

    expect(run.status).toBe(ExitCodes.REFUSED);
    expect(run.output).toContain(
      "release: export without --dry-run publishes and needs MERGEBRIEF_PUBLISH_TOKEN in the environment",
    );
  });

  it("rejects a value given to the authenticated reads flag", () => {
    const argv = [...EXPORT_ARGS, "--authenticated-reads=true"];

    const run = runMain(argv, tokenless);

    expect(run.status).toBe(ExitCodes.USAGE);
    expect(run.output).toContain("unknown flag --authenticated-reads=true");
  });
});
