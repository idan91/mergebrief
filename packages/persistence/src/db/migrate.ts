// Programmatic app-schema migration at BOOT, without shelling out to
// drizzle-kit, over the package-owned migrations folder.
//
// Idempotent by construction: drizzle records applied migrations in
// `drizzle.__drizzle_migrations` and no-ops when current, so every process may
// call it at startup. Drizzle's scope is the app schema only; the
// `graphile_worker` schema is graphile-owned, and its migrate step reaches this
// module as the caller's `migrateQueue`, which runs under the same lock.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Logger } from "logging";
import { Pool } from "pg";
import { Runtimes } from "types/runtime";
import { z } from "zod/v4";
import type { Result, ValueOf } from "types/utils";
import { recordInstanceVersion } from "./instance-version";
import { runUnderMigrationLock } from "./migration-lock";

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

export interface MigrateAppOptions {
  /** The caller's queue-schema step; runs after the app schema, inside the same
   * lock hold. This package takes no `graphile-worker` dependency. */
  readonly migrateQueue?: ((databaseUrl: string) => Promise<void>) | undefined;
  readonly log?: Logger | undefined;
}

/**
 * Idempotently apply the checked-in app-schema migrations to the target
 * database, then the caller's queue-schema step, serialized across processes
 * by the migration lock: concurrent callers wait and then find nothing left to
 * do. Opens its own short-lived connection and releases it before resolving.
 * It does NOT return a handle; open one with `createDb` after.
 */
export async function migrateApp(
  databaseUrl: string,
  options: MigrateAppOptions = {},
): Promise<void> {
  await runUnderMigrationLock(
    databaseUrl,
    async (client) => {
      await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
      await options.migrateQueue?.(databaseUrl);
    },
    { log: options.log },
  );
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
  /** The caller's queue-schema step. Applying runs it inside the migration
   * lock. A check-only boot writes nothing, so it runs it with no lock, after
   * a passing check. */
  readonly migrateQueue?: (databaseUrl: string) => Promise<void>;
}

/** Injectable apply/check implementations, a TEST interface (the real ones need
 * a live pg). Not re-exported from `index.ts`; production callers omit it. */
export interface EnsureAppSchemaDeps {
  readonly apply: (
    databaseUrl: string,
    options: MigrateAppOptions,
  ) => Promise<void>;
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
 * app-schema migrations and the queue step, or, under
 * `MERGEBRIEF_AUTO_MIGRATE=false`, verify read-only that nothing is pending.
 * The returned error is the operator refusal; infra failures still throw.
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
    const checked = await deps.check(
      databaseUrl,
      options.migrateCommand ?? CHECKOUT_MIGRATE_COMMAND,
    );
    if (checked.ok) {
      await options.migrateQueue?.(databaseUrl);
    }
    return checked;
  }

  await deps.apply(databaseUrl, {
    migrateQueue: options.migrateQueue,
    log: options.log,
  });
  if (options.runningVersion !== undefined && options.log !== undefined) {
    await deps.record(databaseUrl, options.runningVersion, options.log);
  }
  return { ok: true, value: undefined };
}
