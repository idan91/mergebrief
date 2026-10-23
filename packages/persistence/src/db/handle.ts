// `createDb` is the only way to a live handle and returns the opaque
// `AppDatabase`, so a caller outside the package can only hand it to
// `createTenantRepository`. `internal()` must never be re-exported from `index.ts`.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/** Driver-agnostic so the node-postgres and PGlite handles both satisfy it. */
export type AppDrizzle = PgDatabase<PgQueryResultHKT>;

/** Module-private brand key: not exported, so `AppDatabase` is opaque outside. */
const INTERNAL: unique symbol = Symbol("persistence.db.internal");

interface DbCore {
  readonly db: AppDrizzle;
  readonly pool: Pool | undefined;
}

export interface AppDatabase {
  readonly [INTERNAL]: DbCore;
}

/** A pool checkout waits this long, then fails, instead of queueing forever. */
const POOL_CONNECTION_TIMEOUT_MS = 10_000;

export interface CreateDbOptions {
  /**
   * pg's `Pool` emits `'error'` for IDLE clients, and with no listener the
   * process dies. Omitted, the error is dropped and the next query fails loudly.
   */
  readonly onError?: (error: Error) => void;
  /** Absent, node-postgres's own default of 10 applies. */
  readonly maxConnections?: number;
}

export function createDb(
  connectionString: string,
  options: CreateDbOptions = {},
): AppDatabase {
  const pool = new Pool({
    connectionString,
    max: options.maxConnections,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  });
  // Forward only the error: pg also passes the PoolClient, whose options carry the password.
  pool.on("error", (error) => {
    options.onError?.(error);
  });
  const db = drizzle(pool);
  return { [INTERNAL]: { db, pool } };
}

export function fromDrizzle(db: AppDrizzle): AppDatabase {
  return { [INTERNAL]: { db, pool: undefined } };
}

export function internal(handle: AppDatabase): AppDrizzle {
  return handle[INTERNAL].db;
}

/** Closes the owned pool; a `fromDrizzle` handle owns none. */
export async function closeDb(handle: AppDatabase): Promise<void> {
  await handle[INTERNAL].pool?.end();
}

/** Resolves `false`, never throws, when the database is unreachable. */
export async function pingDb(handle: AppDatabase): Promise<boolean> {
  try {
    await handle[INTERNAL].db.execute("select 1");
    return true;
  } catch {
    return false;
  }
}
