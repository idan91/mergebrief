// Internal database module — compile-time tenancy containment. `createDb` is
// the ONLY way to obtain a live handle, and it returns the OPAQUE `AppDatabase`
// wrapper, never the raw drizzle instance. The wrapper's sole public shape is
// a module-private symbol, so an external caller cannot reach the drizzle query
// methods; all they can do with an `AppDatabase` is hand it to `forTenant`.
// `internal()` (the unwrap) is for the package's own tenant-scoped surface and
// must NEVER be re-exported from `index.ts`.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../schema/index";

export type AppSchema = typeof schema;

/**
 * The internal drizzle handle type. Typed as the driver-agnostic `PgDatabase`
 * base so both the node-postgres handle (`createDb`, production) and the PGlite
 * handle (`fromDrizzle`, tests) satisfy it. Exported for in-package consumers
 * only — `index.ts` never re-exports it, so callers cannot name it.
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
 * externally it exposes no queryable surface.
 */
export interface AppDatabase {
  readonly [INTERNAL]: DbCore;
}

export interface CreateDbOptions {
  /**
   * Pool-level error observer. pg's `Pool` emits `'error'` for failures on
   * IDLE clients, and with no listener Node's unhandled-'error' default takes
   * the whole process down — the liveness contract requires the web tier to
   * survive a DB blip (/readyz reports unavailability). Omitted → the error is
   * dropped on purpose: the NEXT query fails loudly through its own path.
   */
  readonly onError?: (error: Error) => void;
}

/** Production factory: pg `Pool` + node-postgres drizzle, wrapped opaque. */
export function createDb(
  connectionString: string,
  options: CreateDbOptions = {},
): AppDatabase {
  const pool = new Pool({ connectionString });
  // The wrapper forwards ONLY the error: pg's listener also receives the
  // live PoolClient (whose connection options carry the password), and a
  // variadic consumer callback must never see it.
  pool.on("error", (error) => {
    options.onError?.(error);
  });
  const db = drizzle(pool, { schema });
  return { [INTERNAL]: { db, pool } };
}

/**
 * Wrap an already-constructed drizzle handle (e.g. the PGlite driver in tests,
 * or a future alternate driver) as an `AppDatabase`. In-package interface; not
 * re-exported from `index.ts`.
 */
export function fromDrizzle(db: AppDrizzle): AppDatabase {
  return { [INTERNAL]: { db, pool: undefined } };
}

/** Unwrap to the raw drizzle handle. In-package only (never via `index.ts`). */
export function internal(handle: AppDatabase): AppDrizzle {
  return handle[INTERNAL].db;
}

/** Close the owned pool, if any (a `fromDrizzle` handle owns none). */
export async function closeDb(handle: AppDatabase): Promise<void> {
  await handle[INTERNAL].pool?.end();
}

/**
 * Readiness probe: one `SELECT 1` round-trip through the handle. `false` —
 * never a throw — when the database is unreachable; that is an EXPECTED
 * failure a /readyz caller reports as 503, not a programmer error.
 */
export async function pingDb(handle: AppDatabase): Promise<boolean> {
  try {
    await handle[INTERNAL].db.execute("select 1");
    return true;
  } catch {
    return false;
  }
}
