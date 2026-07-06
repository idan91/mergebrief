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
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Locate the checked-in `drizzle/` folder at RUNTIME. Two cases:
 * (a) this module runs from package source (worker via tsx, tests) —
 *     `import.meta.url` sits in `src/`, so `../drizzle` is right;
 * (b) this module was BUNDLED into a consumer's server build (the web app's
 *     vite SSR bundle), where `import.meta.url` points into the consumer's
 *     dist — then resolve the package itself through node's resolver and
 *     take `drizzle/` beside its entry (`src/lib.ts`).
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
 * Idempotently apply the checked-in app-schema migrations to the target
 * database. Opens its own short-lived single connection and releases it before
 * resolving — it does NOT return a handle; open one with `createDb` after.
 */
export async function migrateApp(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: migrationsFolder() });
  } finally {
    await pool.end();
  }
}
