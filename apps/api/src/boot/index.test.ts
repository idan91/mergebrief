// The exit code a config error takes is the entry's choice: a service stays
// down on 0 under restart: on-failure, the one-shot migrate run answers 1.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { testLogging } from "../../test/logging";
import { createBootLogger, loadBootConfig, loadMigrateConfig } from "./index";
import { ExitCodes } from "./types";

class ExitCalled extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`exit ${String(code)}`);
  }
}

function stubExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ExitCalled(code);
  });
}

async function exitCodeOf(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ExitCalled) {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

const SERVICE_ENV = {
  PUBLIC_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://app:secret@127.0.0.1:5432/app",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "test-private-key",
  GITHUB_WEBHOOK_SECRET: "x".repeat(64),
  GITHUB_OAUTH_CLIENT_ID: "test-client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "test-client-secret",
  GITHUB_APP_SLUG: "test-app",
};

function writeConfig(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "boot-config-")), "c.yaml");
  writeFileSync(path, body);
  return path;
}

describe("boot createBootLogger on a bad LOG_LEVEL", () => {
  it("exits 0 by default and with the code the entry asks for", async () => {
    stubExit();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { LOG_LEVEL: "bogus" };
    expect(await exitCodeOf(() => createBootLogger(env))).toBe(
      ExitCodes.SUCCESS,
    );
    expect(
      await exitCodeOf(() => createBootLogger(env, ExitCodes.FAILURE)),
    ).toBe(ExitCodes.FAILURE);
  });
});

describe("boot loadBootConfig on an empty env", () => {
  it("exits 0 by default, the service's stay-down code", async () => {
    stubExit();
    const { logger } = testLogging();
    const code = await exitCodeOf(() => loadBootConfig({}, logger));
    expect(code).toBe(ExitCodes.SUCCESS);
  });

  it("exits with the code the entry asks for", async () => {
    stubExit();
    const { logger, lines } = testLogging();
    const code = await exitCodeOf(() =>
      loadBootConfig({}, logger, ExitCodes.FAILURE),
    );
    expect(code).toBe(ExitCodes.FAILURE);
    expect(lines().some((line) => line["level"] === "error")).toBe(true);
  });
});

describe("boot loadBootConfig on an instance's named people", () => {
  function readNobodyNamedErrors(
    lines: ReturnType<typeof testLogging>["lines"],
  ): unknown[] {
    return lines().filter(
      (line) =>
        line["level"] === "error" &&
        String(line["msg"]).includes("names nobody"),
    );
  }

  it("logs an error when no config file names anyone", () => {
    const { logger, lines } = testLogging();
    loadBootConfig(SERVICE_ENV, logger);
    expect(readNobodyNamedErrors(lines)).toHaveLength(1);
  });

  it("logs nothing once the config names an operator", () => {
    const { logger, lines } = testLogging();
    const path = writeConfig("operators:\n  - 583231\n");
    loadBootConfig({ ...SERVICE_ENV, MERGEBRIEF_CONFIG: path }, logger);
    expect(readNobodyNamedErrors(lines)).toHaveLength(0);
  });

  it("logs nothing when only an allowed account is named", () => {
    const { logger, lines } = testLogging();
    const path = writeConfig("allowed:\n  accounts:\n    - 583231\n");
    loadBootConfig({ ...SERVICE_ENV, MERGEBRIEF_CONFIG: path }, logger);
    expect(readNobodyNamedErrors(lines)).toHaveLength(0);
  });
});

describe("boot loadBootConfig on the update check", () => {
  it("leaves the check on without a config file", () => {
    const { logger } = testLogging();
    const boot = loadBootConfig(SERVICE_ENV, logger);
    expect(boot.updateCheck.enabled).toBe(true);
  });

  it("turns the check off when the config says so", () => {
    const { logger } = testLogging();
    const path = writeConfig("updateCheck:\n  enabled: false\n");
    const boot = loadBootConfig(
      { ...SERVICE_ENV, MERGEBRIEF_CONFIG: path },
      logger,
    );
    expect(boot.updateCheck.enabled).toBe(false);
  });

  it("exits on a mirror that is not an http URL", async () => {
    stubExit();
    const { logger, lines } = testLogging();
    const path = writeConfig("updateCheck:\n  url: mirror/version.json\n");
    const code = await exitCodeOf(() =>
      loadBootConfig({ ...SERVICE_ENV, MERGEBRIEF_CONFIG: path }, logger),
    );
    expect(code).toBe(ExitCodes.SUCCESS);
    const messages = lines().map((line) => String(line["msg"]));
    expect(messages.join("; ")).toContain("updateCheck.url: must be");
  });

  it("exits on MERGEBRIEF_UPDATE_CHECK left in the environment", async () => {
    stubExit();
    const { logger, lines } = testLogging();
    const code = await exitCodeOf(() =>
      loadBootConfig(
        { ...SERVICE_ENV, MERGEBRIEF_UPDATE_CHECK: "false" },
        logger,
      ),
    );
    expect(code).toBe(ExitCodes.SUCCESS);
    const messages = lines().map((line) => String(line["msg"]));
    expect(messages.join("; ")).toContain(
      "MERGEBRIEF_UPDATE_CHECK: moved to updateCheck.enabled",
    );
  });
});

describe("boot loadMigrateConfig", () => {
  it("needs only the database url and reads the version as dev", async () => {
    stubExit();
    const { logger } = testLogging();
    const config = loadMigrateConfig(
      { DATABASE_URL: "postgres://app:secret@127.0.0.1:5432/app" },
      logger,
      ExitCodes.FAILURE,
    );
    expect(config).toEqual({
      databaseUrl: "postgres://app:secret@127.0.0.1:5432/app",
      runningVersion: "dev",
    });
  });

  it("exits with the entry's code without a database url", async () => {
    stubExit();
    const { logger, lines } = testLogging();
    const code = await exitCodeOf(() =>
      loadMigrateConfig({ SERVER_VERSION: "1.6.0" }, logger, ExitCodes.FAILURE),
    );
    expect(code).toBe(ExitCodes.FAILURE);
    expect(
      lines().some((line) => String(line["msg"]).includes("DATABASE_URL")),
    ).toBe(true);
  });
});
