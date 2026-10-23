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
   * Postgres ending a client, idle in the pool or checked out by a
   * transaction. Omitted, the error is dropped and the client's next query
   * fails loudly.
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
  function forwardError(error: Error): void {
    options.onError?.(error);
  }
  pool.on("error", forwardError);
  // pg-pool listens on a client only while it is idle. A checked-out client
  // with no `'error'` listener crashes the process when Postgres ends it; the
  // transaction's next statement fails instead, and release discards it.
  pool.on("acquire", (client) => {
    client.on("error", forwardError);
  });
  pool.on("release", (_error, client) => {
    client.removeListener("error", forwardError);
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
