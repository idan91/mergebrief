// The `migrate` entry (`docker compose run --rm api migrate`,
// `pnpm -C apps/api migrate`): the boot path's schema apply, forced on,
// followed by the queue schema, as one exit code.
import type { EnsureAppSchemaOptions } from "persistence";
import { describe, expect, it } from "vitest";
import { testLogging, type CapturedLine } from "../../test/logging";
import { runMigrate } from "./migrate";
import { ExitCodes, type RunMigrateDeps } from "./types";

const DATABASE_URL = "postgres://user:pass@localhost:5432/app";
const VERSION = "1.6.0";

interface Recorded {
  readonly steps: string[];
  readonly options: EnsureAppSchemaOptions[];
}

function makeDeps(overrides: Partial<RunMigrateDeps> = {}): {
  deps: RunMigrateDeps;
  recorded: Recorded;
  lines: () => CapturedLine[];
} {
  const recorded: Recorded = { steps: [], options: [] };
  const logging = testLogging();
  const deps: RunMigrateDeps = {
    databaseUrl: DATABASE_URL,
    runningVersion: VERSION,
    log: logging.logger,
    ensure: async (databaseUrl, options) => {
      recorded.steps.push("schema");
      recorded.options.push(options);
      await options.migrateQueue?.(databaseUrl);
      return { ok: true, value: undefined };
    },
    migrateQueue: async () => {
      recorded.steps.push("queue");
    },
    ...overrides,
  };
  return { deps, recorded, lines: logging.lines };
}

describe("migrate entry runMigrate", () => {
  it("applies the schema with auto-migrate forced on", async () => {
    const { deps, recorded } = makeDeps();
    await runMigrate(deps);
    expect(recorded.options[0]?.autoMigrate).toBe(true);
  });

  it("hands the version and the logger over so the row gets written", async () => {
    // ensureAppSchema records instance_version only when BOTH are present.
    const { deps, recorded } = makeDeps();
    await runMigrate(deps);
    expect(recorded.options[0]?.runningVersion).toBe(VERSION);
    expect(recorded.options[0]?.log).toBe(deps.log);
  });

  it("migrates the queue schema after the app schema", async () => {
    const { deps, recorded } = makeDeps();
    const code = await runMigrate(deps);
    expect(code).toBe(ExitCodes.SUCCESS);
    expect(recorded.steps).toEqual(["schema", "queue"]);
  });

  it("exits 1 and never touches the queue when the schema refuses", async () => {
    const { deps, recorded, lines } = makeDeps({
      ensure: async () => ({
        ok: false,
        error: {
          code: "pending-migrations",
          message: "behind",
          pendingCount: 2,
        },
      }),
    });
    const code = await runMigrate(deps);
    expect(code).toBe(ExitCodes.FAILURE);
    expect(recorded.steps).toEqual([]);
    expect(lines().some((line) => line["msg"] === "migrate: behind")).toBe(
      true,
    );
  });

  it("exits 1 and logs when the apply throws", async () => {
    const { deps, lines } = makeDeps({
      ensure: async () => {
        throw new Error("connection refused");
      },
    });
    const code = await runMigrate(deps);
    expect(code).toBe(ExitCodes.FAILURE);
    expect(lines().some((line) => line["level"] === "error")).toBe(true);
  });

  it("exits 1 and logs when the queue migration throws", async () => {
    const { deps, lines } = makeDeps({
      migrateQueue: async () => {
        throw new Error("permission denied for schema graphile_worker");
      },
    });
    const code = await runMigrate(deps);
    expect(code).toBe(ExitCodes.FAILURE);
    expect(lines().some((line) => line["msg"] === "migrate: failed")).toBe(
      true,
    );
  });

  it("says the version it brought the database to", async () => {
    const { deps, lines } = makeDeps();
    await runMigrate(deps);
    const done = lines().find(
      (line) => line["msg"] === "migrate: schema current",
    );
    expect(done?.["version"]).toBe(VERSION);
  });
});
