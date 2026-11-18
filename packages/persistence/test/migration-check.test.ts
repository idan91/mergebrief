// Check-only ledger comparison (`MERGEBRIEF_AUTO_MIGRATE=false`).
// The check reads `drizzle.__drizzle_migrations` and compares against the
// checked-in `drizzle/meta/_journal.json`, read-only, for deployments whose
// runtime role has no DDL. Matrix: current / behind / ahead-of-journal /
// virgin database (no ledger table at all).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_MIGRATE_COMMAND,
  checkAppSchemaWith,
  ensureAppSchema,
  IMAGE_MIGRATE_COMMAND,
  resolveMigrateCommand,
  SchemaCheckErrorCodes,
  type SchemaCheckError,
  type SchemaQueryExecutor,
} from "../src/db/migrate";
import { createLogger } from "logging";
import { Runtimes } from "types/runtime";
import { freshPglite, virginPglite } from "./helpers";

/** Journal entry count read straight from the checked-in file, the
 * independent source of truth the virgin-database case is judged against. */
function journalEntryCount(): number {
  const journalPath = join(
    fileURLToPath(new URL("../drizzle/meta", import.meta.url)),
    "_journal.json",
  );
  const parsed: unknown = JSON.parse(readFileSync(journalPath, "utf8"));
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("entries" in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error("unexpected journal shape");
  }
  return parsed.entries.length;
}

function executorFor(client: PGlite): SchemaQueryExecutor {
  return async (sql) => (await client.query<Record<string, unknown>>(sql)).rows;
}

describe("migration check checkAppSchemaWith", () => {
  it("passes on a fully migrated database", async () => {
    const client = await freshPglite();
    const result = await checkAppSchemaWith(executorFor(client));
    expect(result.ok).toBe(true);
  });

  it("refuses a behind database with the pending count and the command", async () => {
    const client = await freshPglite();
    // Move the ledger's newest row one millisecond below the baseline: a
    // database whose last applied migration is older than the baseline.
    await client.query(
      `update drizzle.__drizzle_migrations
       set created_at = created_at - 1
       where created_at = (
         select max(created_at) from drizzle.__drizzle_migrations
       )`,
    );
    const result = await checkAppSchemaWith(executorFor(client));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(SchemaCheckErrorCodes.PENDING_MIGRATIONS);
    expect(result.error.pendingCount).toBe(1);
    expect(result.error.message).toContain("1");
    expect(result.error.message).toContain("pnpm -C apps/api migrate");
    expect(result.error.message).toContain("MERGEBRIEF_AUTO_MIGRATE");
  });

  it("refuses naming the command the caller passes", async () => {
    const client = await virginPglite();
    const result = await checkAppSchemaWith(
      executorFor(client),
      IMAGE_MIGRATE_COMMAND,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain(
      "docker compose run --rm api migrate",
    );
    expect(result.error.message).not.toContain("pnpm -C apps/api migrate");
  });

  it("treats a virgin database with no ledger table as fully behind", async () => {
    const client = await virginPglite();
    const result = await checkAppSchemaWith(executorFor(client));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.pendingCount).toBe(journalEntryCount());
  });

  it("passes a database ahead of the checked-in journal", async () => {
    const client = await freshPglite();
    await client.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at)
       values ('test-future', 9999999999999)`,
    );
    const result = await checkAppSchemaWith(executorFor(client));
    expect(result.ok).toBe(true);
  });
});

describe("migration check resolveMigrateCommand", () => {
  it("names the image command under the compose runtime marker", () => {
    expect(resolveMigrateCommand(Runtimes.COMPOSE_WORKER)).toBe(
      IMAGE_MIGRATE_COMMAND,
    );
  });

  it("names the checkout command for a source run", () => {
    expect(resolveMigrateCommand(undefined)).toBe(CHECKOUT_MIGRATE_COMMAND);
  });
});

// The startup dispatch boundary itself: apply-vs-check selection and refusal
// propagation, pinned via the injectable deps.
describe("migration check ensureAppSchema dispatch", () => {
  const URL = "postgres://user:pass@localhost:5432/app";
  const REFUSAL: SchemaCheckError = {
    code: SchemaCheckErrorCodes.PENDING_MIGRATIONS,
    message: "behind",
    pendingCount: 3,
  };
  const stubNeverRecord = async (): Promise<void> => {
    throw new Error("must not record");
  };

  it("autoMigrate=true applies once and never checks", async () => {
    const applied: string[] = [];
    let checked = 0;
    const result = await ensureAppSchema(
      URL,
      { autoMigrate: true },
      {
        apply: async (databaseUrl) => {
          applied.push(databaseUrl);
        },
        check: async () => {
          checked += 1;
          return { ok: false, error: REFUSAL };
        },
        record: stubNeverRecord,
      },
    );
    expect(result.ok).toBe(true);
    expect(applied).toEqual([URL]);
    expect(checked).toBe(0);
  });

  it("autoMigrate=false checks, never applies, and propagates the refusal", async () => {
    let applied = 0;
    const result = await ensureAppSchema(
      URL,
      { autoMigrate: false },
      {
        apply: async () => {
          applied += 1;
        },
        check: async () => ({ ok: false, error: REFUSAL }),
        record: stubNeverRecord,
      },
    );
    expect(applied).toBe(0);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toEqual(REFUSAL);
  });

  it("autoMigrate=false hands the caller's migrate command to the check", async () => {
    const seen: string[] = [];
    await ensureAppSchema(
      URL,
      { autoMigrate: false, migrateCommand: IMAGE_MIGRATE_COMMAND },
      {
        apply: async () => {
          throw new Error("must not apply");
        },
        check: async (_databaseUrl, migrateCommand) => {
          seen.push(migrateCommand);
          return { ok: true, value: undefined };
        },
        record: stubNeverRecord,
      },
    );
    expect(seen).toEqual([IMAGE_MIGRATE_COMMAND]);
  });

  it("autoMigrate=false passes a current database through", async () => {
    const result = await ensureAppSchema(
      URL,
      { autoMigrate: false },
      {
        apply: async () => {
          throw new Error("must not apply");
        },
        check: async () => ({ ok: true, value: undefined }),
        record: stubNeverRecord,
      },
    );
    expect(result.ok).toBe(true);
  });

  it("autoMigrate=true hands the queue step to the apply", async () => {
    const migrateQueue = async (): Promise<void> => {
      throw new Error("the apply owns when this runs");
    };
    const handed: unknown[] = [];

    await ensureAppSchema(
      URL,
      { autoMigrate: true, migrateQueue },
      {
        apply: async (_databaseUrl, options) => {
          handed.push(options.migrateQueue);
        },
        check: async () => ({ ok: true, value: undefined }),
        record: stubNeverRecord,
      },
    );

    expect(handed).toEqual([migrateQueue]);
  });

  it("autoMigrate=false runs the queue step only after a passing check", async () => {
    const steps: string[] = [];
    const migrateQueue = async (): Promise<void> => {
      steps.push("queue");
    };
    const stubNeverApply = async (): Promise<void> => {
      throw new Error("must not apply");
    };

    await ensureAppSchema(
      URL,
      { autoMigrate: false, migrateQueue },
      {
        apply: stubNeverApply,
        check: async () => ({ ok: false, error: REFUSAL }),
        record: stubNeverRecord,
      },
    );
    expect(steps).toEqual([]);

    await ensureAppSchema(
      URL,
      { autoMigrate: false, migrateQueue },
      {
        apply: stubNeverApply,
        check: async () => ({ ok: true, value: undefined }),
        record: stubNeverRecord,
      },
    );
    expect(steps).toEqual(["queue"]);
  });

  it("records the running version after the apply, never on a check", async () => {
    const recorded: string[] = [];
    const log = createLogger({ env: {}, destination: { write: () => {} } });
    const deps = {
      apply: async () => {},
      check: async (): Promise<{ ok: true; value: undefined }> => ({
        ok: true,
        value: undefined,
      }),
      record: async (_databaseUrl: string, running: string): Promise<void> => {
        recorded.push(running);
      },
    };

    await ensureAppSchema(
      URL,
      { autoMigrate: true, runningVersion: "1.4.0", log },
      deps,
    );
    const checked = await ensureAppSchema(
      URL,
      { autoMigrate: false, runningVersion: "1.5.0", log },
      deps,
    );

    expect(checked.ok).toBe(true);
    expect(recorded).toEqual(["1.4.0"]);
  });
});
