// Programmatic app-schema migration (BRIEF-3 Part 1). The checked-in
// `drizzle/` SQL has so far been applied via the `drizzle-kit migrate` CLI
// (dev) or the PGlite migrator (tests); the long-lived worker and the compose
// composition roots need the same thing at BOOT, idempotently, without
// shelling out to drizzle-kit. This wraps drizzle-orm's node-postgres migrator
// over the package-owned migrations folder — the folder stays owned by THIS
// package, so a consumer never needs to know where the SQL lives.
//
// Idempotent by construction: drizzle records applied migrations in
// `drizzle.__drizzle_migrations` and no-ops when current — safe for every
// process to call at startup (mirrors `migrateQueue`'s contract in
// `packages/api/src/queue.ts`). Scoped to the app schema only: the
// `graphile_worker` schema is graphile-owned and migrated by graphile's own
// `runMigrations`, never here (see AGENTS.md — drizzle must not manage it).
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { z } from "zod";
import type { Result, ValueOf } from "../types";

/**
 * Locate the checked-in `drizzle/` folder at RUNTIME. Two cases:
 * (a) this module runs from package source (worker via tsx, tests) —
 *     `import.meta.url` sits in `src/`, so `../drizzle` is right;
 * (b) this module was BUNDLED into a consumer's server build (the web app's
 *     vite SSR bundle), where `import.meta.url` points into the consumer's
 *     dist — then resolve the package itself through node's resolver and
 *     take `drizzle/` beside its entry (`src/index.ts`).
 */
function migrationsFolder(): string {
  const fromModule = fileURLToPath(new URL("../drizzle", import.meta.url));
  if (existsSync(join(fromModule, "meta"))) {
    return fromModule;
  }
  const require = createRequire(import.meta.url);
  const entry = require.resolve("persistence");
  return join(dirname(entry), "..", "drizzle");
}

/**
 * Session-scoped advisory-lock key serializing concurrent `migrateApp` runs.
 * Drizzle's node-postgres migrator takes NO lock of its own (unlike
 * graphile's `runMigrations`), so two composition roots booting together —
 * the compose `worker` at startup and `web` on its first webhook — would
 * race CREATE TABLEs and one would die on "already exists". Arbitrary but
 * stable int64; only this function uses it.
 */
const MIGRATE_LOCK_KEY = 0x62726965_66n; // "brief"

/**
 * Idempotently apply the checked-in app-schema migrations to the target
 * database, serialized across processes by a Postgres advisory lock. Opens
 * its own short-lived single connection and releases it before resolving —
 * it does NOT return a handle; open one with `createDb` after.
 */
export async function migrateApp(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      // Session-level lock on this dedicated connection: concurrent callers
      // queue here and then no-op on the recorded-migrations check.
      await client.query("select pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);
      try {
        await migrate(drizzle(client), {
          migrationsFolder: migrationsFolder(),
        });
      } finally {
        await client.query("select pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Check-only mode (BRIEF-131): `MERGEBRIEF_AUTO_MIGRATE=false`.
//
// Deployments whose RUNTIME role has no DDL (managed Postgres, least
// privilege) cannot let the boot path apply migrations. Check-only compares
// the drizzle ledger (`drizzle.__drizzle_migrations`) against the checked-in
// `drizzle/meta/_journal.json` READ-ONLY and refuses boot when behind —
// never limping into a half-migrated schema, never attempting DDL. The
// comparison mirrors the drizzle migrator's own rule: an entry is pending
// when its journal `when` is newer than the latest ledger `created_at`. A
// database AHEAD of the journal (newer code already migrated it) passes —
// exactly what `migrateApp` would no-op on. Scope: the app schema only; the
// `graphile_worker` schema stays graphile-owned (its migrator no-ops
// read-only when current).
// ---------------------------------------------------------------------------

/** The journal shape the check consumes — `when` (ms) is the ordering key
 * drizzle's own migrator applies by. */
const JournalSchema = z.object({
  entries: z.array(z.object({ when: z.number(), tag: z.string() })),
});

export const SchemaCheckErrorCode = {
  PENDING_MIGRATIONS: "pending-migrations",
} as const;
export type SchemaCheckErrorCode = ValueOf<typeof SchemaCheckErrorCode>;

export interface SchemaCheckError {
  readonly code: SchemaCheckErrorCode;
  /** Operator-facing refusal: pending count + the manual command. Never
   * carries the connection string. */
  readonly message: string;
  readonly pendingCount: number;
}

/** One read-only query round-trip: rows out, driver-agnostic (pg in
 * production, PGlite in tests). */
export type SchemaQueryExecutor = (
  sql: string,
) => Promise<readonly Record<string, unknown>[]>;

/** The latest applied `created_at` from the ledger, or `undefined` when the
 * ledger table does not exist / is empty (virgin database). `to_regclass`
 * avoids driver-specific missing-table error handling. */
async function latestAppliedMillis(
  executor: SchemaQueryExecutor,
): Promise<number | undefined> {
  const presence = await executor(
    "select to_regclass('drizzle.__drizzle_migrations') as ledger",
  );
  if (presence[0]?.["ledger"] == null) {
    return undefined;
  }
  const rows = await executor(
    "select max(created_at) as latest from drizzle.__drizzle_migrations",
  );
  const latest = rows[0]?.["latest"];
  if (latest == null) {
    return undefined;
  }
  // bigint columns arrive as string (pg) or number/bigint (PGlite).
  const millis = Number(latest);
  return Number.isFinite(millis) ? millis : undefined;
}

/**
 * Read-only schema check over an injected executor. `ok` when every
 * checked-in migration is recorded as applied (or the ledger is ahead);
 * `PENDING_MIGRATIONS` with the count and the manual command when behind.
 * Infra failures (unreachable database, bad permissions on the READ) throw —
 * they are not a "behind" verdict.
 */
export async function checkAppSchemaWith(
  executor: SchemaQueryExecutor,
): Promise<Result<undefined, SchemaCheckError>> {
  const journal = JournalSchema.parse(
    JSON.parse(
      readFileSync(join(migrationsFolder(), "meta", "_journal.json"), "utf8"),
    ),
  );
  const applied = await latestAppliedMillis(executor);
  const pending = journal.entries.filter(
    (entry) => applied === undefined || entry.when > applied,
  ).length;
  if (pending === 0) {
    return { ok: true, value: undefined };
  }
  return {
    ok: false,
    error: {
      code: SchemaCheckErrorCode.PENDING_MIGRATIONS,
      pendingCount: pending,
      message:
        `database schema is ${pending} migration(s) behind the checked-in set ` +
        "and MERGEBRIEF_AUTO_MIGRATE=false forbids applying at boot — run " +
        "`pnpm -C packages/persistence migrate` with a DDL-capable " +
        "DATABASE_URL, then restart the worker (the web tier recovers on " +
        "its next request)",
    },
  };
}

/** `checkAppSchemaWith` over a short-lived single-connection pool. */
export async function checkAppSchema(
  databaseUrl: string,
): Promise<Result<undefined, SchemaCheckError>> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    return await checkAppSchemaWith(
      async (sql) => (await pool.query(sql)).rows,
    );
  } finally {
    await pool.end();
  }
}

export interface EnsureAppSchemaOptions {
  /** `true` (the default posture) applies via `migrateApp`; `false` runs the
   * read-only check and refuses when behind. */
  readonly autoMigrate: boolean;
}

/** Injectable apply/check implementations — a TEST interface (the real ones need
 * a live pg). Not re-exported from `index.ts`; production callers omit it. */
export interface EnsureAppSchemaDeps {
  readonly apply: (databaseUrl: string) => Promise<void>;
  readonly check: (
    databaseUrl: string,
  ) => Promise<Result<undefined, SchemaCheckError>>;
}

/**
 * The one boot-time boundary both startup-wiring paths call (BRIEF-131): apply the
 * app-schema migrations, or — under `MERGEBRIEF_AUTO_MIGRATE=false` — verify
 * read-only that nothing is pending. The returned error is the operator
 * refusal; infra failures still throw.
 */
export async function ensureAppSchema(
  databaseUrl: string,
  options: EnsureAppSchemaOptions,
  deps: EnsureAppSchemaDeps = { apply: migrateApp, check: checkAppSchema },
): Promise<Result<undefined, SchemaCheckError>> {
  if (options.autoMigrate) {
    await deps.apply(databaseUrl);
    return { ok: true, value: undefined };
  }
  return deps.check(databaseUrl);
}
