// Internal database module (D2b compile-time containment). `createDb` is the
// ONLY way to obtain a live handle, and it returns the OPAQUE `AppDatabase`
// wrapper — never the raw drizzle instance. The wrapper's sole public shape is
// a module-private symbol, so an external caller cannot reach the drizzle
// query methods (`.select`, `.insert`, `.transaction`); the only thing they can
// do with an `AppDatabase` is hand it to `forTenant`. `internal()` (the unwrap)
// is exported for the package's own tenant-scoped surface (`tenant.ts`, and the
// stage-4 `artifact-store.ts`) but is deliberately NOT re-exported from
// `lib.ts`, so it never reaches package consumers.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema/index";

/** The app's full schema (the 11 M1 tables). */
export type AppSchema = typeof schema;

/**
 * The internal drizzle handle type. Typed as the driver-agnostic `PgDatabase`
 * base so both the node-postgres handle (`createDb`, production) and the PGlite
 * handle (`fromDrizzle`, tests) satisfy it. Exported for in-package consumers
 * only — `lib.ts` never re-exports it, so callers cannot name it.
 */
export type AppDrizzle = PgDatabase<PgQueryResultHKT, AppSchema>;

/** Module-private brand key: not exported, so `AppDatabase` is opaque outside. */
const INTERNAL: unique symbol = Symbol("persistence.db.internal");

interface DbCore {
  readonly db: AppDrizzle;
  readonly pool: Pool | undefined;
}

/**
 * Opaque database handle. Its only property is a module-private symbol, so
 * externally it exposes no queryable surface — the compile-time half of D2b.
 */
export interface AppDatabase {
  readonly [INTERNAL]: DbCore;
}

/** Production factory: pg `Pool` + node-postgres drizzle, wrapped opaque. */
export function createDb(connectionString: string): AppDatabase {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { [INTERNAL]: { db, pool } };
}

/**
 * Wrap an already-constructed drizzle handle (e.g. the PGlite driver in tests,
 * or a future alternate driver) as an `AppDatabase`. In-package seam; not
 * re-exported from `lib.ts`.
 */
export function fromDrizzle(db: AppDrizzle): AppDatabase {
  return { [INTERNAL]: { db, pool: undefined } };
}

/** Unwrap to the raw drizzle handle. In-package only (never via `lib.ts`). */
export function internal(handle: AppDatabase): AppDrizzle {
  return handle[INTERNAL].db;
}

/** Close the owned pool, if any (a `fromDrizzle` handle owns none). */
export async function closeDb(handle: AppDatabase): Promise<void> {
  await handle[INTERNAL].pool?.end();
}
