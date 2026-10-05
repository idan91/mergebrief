// Programmatic app-schema migration at BOOT, without shelling out to
// drizzle-kit, over the package-owned migrations folder.
//
// Idempotent by construction: drizzle records applied migrations in
// `drizzle.__drizzle_migrations` and no-ops when current, so every process may
// call it at startup. Scope is the app schema only; the `graphile_worker`
// schema is graphile-owned, migrated by graphile's own `runMigrations`, and
// drizzle must not manage it.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Logger } from "logging";
import { Pool } from "pg";
import { Runtimes } from "types/runtime";
import { z } from "zod";
import type { Result, ValueOf } from "types/utils";
import { recordInstanceVersion } from "./instance-version";

/**
 * Locate the checked-in `drizzle/` folder at RUNTIME. Two cases:
 * (a) this module runs from package source (worker via tsx, tests), so
 *     `import.meta.url` sits in `src/` and `../drizzle` is right;
 * (b) this module was BUNDLED into a consumer's server build (the web app's
 *     vite SSR bundle), where `import.meta.url` points into the consumer's
 *     dist, so resolve the package itself through node's resolver and take
 *     `drizzle/` beside its entry (`src/index.ts`).
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
 * graphile's `runMigrations`), so two composition roots booting together (the
 * compose `worker` at startup and `web` on its first webhook) would race
 * CREATE TABLEs and one would die on "already exists". Arbitrary but
 * stable int64; only this function uses it.
 */
const MIGRATE_LOCK_KEY = 0x62726965_66n; // "brief"

/**
 * Idempotently apply the checked-in app-schema migrations to the target
 * database, serialized across processes by a Postgres advisory lock. Opens
 * its own short-lived single connection and releases it before resolving. It
 * does NOT return a handle; open one with `createDb` after.
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
// Check-only mode: `MERGEBRIEF_AUTO_MIGRATE=false`.
//
// A RUNTIME role without DDL cannot apply migrations at boot, so this path
// compares the drizzle ledger against `drizzle/meta/_journal.json` READ-ONLY
// and refuses boot when behind. An entry is pending when its journal `when` is
// newer than the latest ledger `created_at`, the drizzle migrator's own rule;
// a database AHEAD of the journal passes. App schema only.
// ---------------------------------------------------------------------------

/** The journal shape the check consumes; `when` (ms) is the ordering key
 * drizzle's own migrator applies by. */
const JournalSchema = z.object({
  entries: z.array(z.object({ when: z.number(), tag: z.string() })),
});

export const SchemaCheckErrorCodes = {
  PENDING_MIGRATIONS: "pending-migrations",
} as const;
export type SchemaCheckErrorCode = ValueOf<typeof SchemaCheckErrorCodes>;

/** The manual migrate command a refusal names: the api's migrate entry, in
 * its checkout form for a source run and its image form inside the shipped
 * container. Both take the same lock and write the same version row as
 * boot, which `drizzle-kit migrate` alone would not. The caller knows which
 * runtime it is; this package never reads env. */
export const CHECKOUT_MIGRATE_COMMAND = "pnpm -C apps/api migrate";
export const IMAGE_MIGRATE_COMMAND = "docker compose run --rm api migrate";
export type MigrateCommand =
  | typeof CHECKOUT_MIGRATE_COMMAND
  | typeof IMAGE_MIGRATE_COMMAND;

/** The command for the runtime the caller read from `MERGEBRIEF_RUNTIME`. */
export function resolveMigrateCommand(
  runtime: string | undefined,
): MigrateCommand {
  if (runtime === Runtimes.COMPOSE_WORKER) {
    return IMAGE_MIGRATE_COMMAND;
  }
  return CHECKOUT_MIGRATE_COMMAND;
}

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
  const ledger = presence[0]?.["ledger"];
  if (ledger === null || ledger === undefined) {
    return undefined;
  }
  const rows = await executor(
    "select max(created_at) as latest from drizzle.__drizzle_migrations",
  );
  const latest = rows[0]?.["latest"];
  if (latest === null || latest === undefined) {
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
 * Infra failures (unreachable database, bad permissions on the READ) throw;
 * they are not a "behind" verdict.
 */
export async function checkAppSchemaWith(
  executor: SchemaQueryExecutor,
  migrateCommand: MigrateCommand = CHECKOUT_MIGRATE_COMMAND,
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
      code: SchemaCheckErrorCodes.PENDING_MIGRATIONS,
      pendingCount: pending,
      message:
        `database schema is ${pending} migration(s) behind the checked-in set ` +
        "and MERGEBRIEF_AUTO_MIGRATE=false forbids applying at boot. Run " +
        `\`${migrateCommand}\` with a DDL-capable DATABASE_URL, then ` +
        "restart the api and the worker (the web tier recovers on its next " +
        "request)",
    },
  };
}

/** `checkAppSchemaWith` over a short-lived single-connection pool. */
export async function checkAppSchema(
  databaseUrl: string,
  migrateCommand: MigrateCommand = CHECKOUT_MIGRATE_COMMAND,
): Promise<Result<undefined, SchemaCheckError>> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    return await checkAppSchemaWith(
      async (sql) => (await pool.query(sql)).rows,
      migrateCommand,
    );
  } finally {
    await pool.end();
  }
}

export interface EnsureAppSchemaOptions {
  /** `true` (the default posture) applies via `migrateApp`; `false` runs the
   * read-only check and refuses when behind. */
  readonly autoMigrate: boolean;
  /** The process's own version; recorded in `instance_version` after the
   * apply. A check-only boot stays read-only and leaves the row alone. */
  readonly runningVersion?: string;
  readonly log?: Logger;
  /** Named in the refusal; defaults to the checkout form. */
  readonly migrateCommand?: MigrateCommand;
}

/** Injectable apply/check implementations, a TEST interface (the real ones need
 * a live pg). Not re-exported from `index.ts`; production callers omit it. */
export interface EnsureAppSchemaDeps {
  readonly apply: (databaseUrl: string) => Promise<void>;
  readonly check: (
    databaseUrl: string,
    migrateCommand: MigrateCommand,
  ) => Promise<Result<undefined, SchemaCheckError>>;
  readonly record: (
    databaseUrl: string,
    running: string,
    log: Logger,
  ) => Promise<void>;
}

/**
 * The one boot-time boundary both startup-wiring paths call: apply the
 * app-schema migrations, or, under `MERGEBRIEF_AUTO_MIGRATE=false`, verify
 * read-only that nothing is pending. The returned error is the operator
 * refusal; infra failures still throw.
 */
export async function ensureAppSchema(
  databaseUrl: string,
  options: EnsureAppSchemaOptions,
  deps: EnsureAppSchemaDeps = {
    apply: migrateApp,
    check: checkAppSchema,
    record: recordInstanceVersion,
  },
): Promise<Result<undefined, SchemaCheckError>> {
  if (!options.autoMigrate) {
    return deps.check(
      databaseUrl,
      options.migrateCommand ?? CHECKOUT_MIGRATE_COMMAND,
    );
  }

  await deps.apply(databaseUrl);
  if (options.runningVersion !== undefined && options.log !== undefined) {
    await deps.record(databaseUrl, options.runningVersion, options.log);
  }
  return { ok: true, value: undefined };
}
