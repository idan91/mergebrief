// The exit code a config error takes is the entry's choice: a service stays
// down on 0 under restart: on-failure, the one-shot migrate run answers 1.
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
