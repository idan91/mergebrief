import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { type AppDatabase, internal } from "../db/handle";

const POLL_INTERVAL_MS = 20;

const terminatedRowsSchema = z.object({
  rows: z.array(z.object({ terminated: z.boolean() })),
});

/** `url` with its pool tagged as `applicationName`, the tag the ender matches. */
export function buildNamedPostgresUrl(
  url: string,
  applicationName: string,
): string {
  const named = new URL(url);
  named.searchParams.set("application_name", applicationName);
  return named.toString();
}

/**
 * Ends every backend that connected as `applicationName` and now sits idle
 * inside a transaction, the way a failover or an operator's
 * `pg_terminate_backend` ends it. Runs on `observer`, a second handle, so the
 * caller's own pool is never the one asking. Returns how many it ended.
 */
export async function terminateIdleTransactions(
  observer: AppDatabase,
  applicationName: string,
): Promise<number> {
  const result = await internal(observer).execute(
    sql`select pg_terminate_backend(pid) as terminated
        from pg_stat_activity
        where application_name = ${applicationName}
          and state = 'idle in transaction'
          and datname = current_database()`,
  );
  const parsed = terminatedRowsSchema.parse(result);
  return parsed.rows.filter((row) => row.terminated).length;
}

/** Polls `check` until it holds or `boundMs` passes; the caller asserts after. */
export async function waitUntil(
  check: () => boolean,
  boundMs: number,
): Promise<void> {
  const deadline = Date.now() + boundMs;
  while (!check() && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
  }
}
