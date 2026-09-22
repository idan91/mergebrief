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
  checkAppSchemaWith,
  ensureAppSchema,
  SchemaCheckErrorCodes,
  type SchemaCheckError,
  type SchemaQueryExecutor,
} from "../src/db/migrate";
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
    // Rewind the ledger by two: the two newest checked-in migrations become
    // pending from the checker's point of view.
    await client.query(
      `delete from drizzle.__drizzle_migrations
       where created_at in (
         select created_at from drizzle.__drizzle_migrations
         order by created_at desc limit 2
       )`,
    );
    const result = await checkAppSchemaWith(executorFor(client));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(SchemaCheckErrorCodes.PENDING_MIGRATIONS);
    expect(result.error.pendingCount).toBe(2);
    expect(result.error.message).toContain("2");
    expect(result.error.message).toContain(
      "pnpm -C packages/persistence migrate",
    );
    expect(result.error.message).toContain("MERGEBRIEF_AUTO_MIGRATE");
  });

  it("treats a virgin database with no ledger table as fully behind", async () => {
    const client = await virginPglite();
    const result = await checkAppSchemaWith(executorFor(client));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.pendingCount).toBe(journalEntryCount());
  });

  it("passes a database ahead of the checked-in journal", async () => {
    const client = await freshPglite();
    await client.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at)
       values ('brief-131-test-future', 9999999999999)`,
    );
    const result = await checkAppSchemaWith(executorFor(client));
    expect(result.ok).toBe(true);
  });

  it("never echoes a connection string in the refusal", async () => {
    const client = await virginPglite();
    const result = await checkAppSchemaWith(executorFor(client));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toContain("postgres://");
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
      },
    );
    expect(applied).toBe(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(REFUSAL);
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
      },
    );
    expect(result.ok).toBe(true);
  });
});
