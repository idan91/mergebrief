// The one lock every schema migrator shares across processes. Neither migrator
// is safe alone: drizzle's takes no lock, and graphile's schema install fails
// on a concurrent `create schema if not exists`.
import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "logging";
import { Client } from "pg";

const MIGRATION_LOCK_KEY = 0x62726965_66n; // "brief"
const LOCK_POLL_MS = 250;
const MS_PER_SECOND = 1_000;

/** A waiter blocks rather than exits: an api that exits fails `docker compose up`
 * and leaves `web` unstarted, even once the api turns healthy. A fresh-database
 * migrate over a slow link takes tens of seconds. */
export const MIGRATION_LOCK_WAIT_MS = 300_000;

const MIGRATION_LOCK_WARN_EVERY_MS = 30_000;

export interface MigrationLockOptions {
  readonly log?: Logger | undefined;
  readonly waitMs?: number;
  readonly warnEveryMs?: number;
}

interface MigrationLockWait {
  readonly waitMs: number;
  readonly warnEveryMs: number;
}

async function tryMigrationLock(client: Client): Promise<boolean> {
  const tried = await client.query<{ locked: boolean }>(
    "select pg_try_advisory_lock($1) as locked",
    [MIGRATION_LOCK_KEY],
  );
  return tried.rows[0]?.locked === true;
}

async function waitForMigrationLock(
  client: Client,
  { waitMs, warnEveryMs }: MigrationLockWait,
  log: Logger | undefined,
): Promise<void> {
  const deadline = Date.now() + waitMs;
  let nextWarnAt = Date.now() + warnEveryMs;
  if (await tryMigrationLock(client)) {
    return;
  }

  log?.info("migration lock: another process is migrating, waiting");
  while (Date.now() < deadline) {
    await sleep(LOCK_POLL_MS);
    if (await tryMigrationLock(client)) {
      return;
    }
    if (Date.now() >= nextWarnAt) {
      nextWarnAt += warnEveryMs;
      log?.warn(
        "migration lock: still waiting. A long migration finishes on its own. A " +
          "lock that never frees means DATABASE_URL reaches a transaction pooler: " +
          "use a direct or session-mode connection",
      );
    }
  }

  const waitSeconds = Math.round(waitMs / MS_PER_SECOND);
  throw new Error(
    `migration lock: still held after ${String(waitSeconds)}s. ` +
      "A long migration finishes on its own and a restart finds it done. A lock " +
      "that never frees means DATABASE_URL reaches a transaction pooler: use a " +
      "direct or session-mode connection",
  );
}

async function releaseMigrationLock(
  client: Client,
  log: Logger | undefined,
): Promise<void> {
  try {
    const released = await client.query<{ released: boolean }>(
      "select pg_advisory_unlock($1) as released",
      [MIGRATION_LOCK_KEY],
    );
    if (released.rows[0]?.released !== true) {
      log?.warn(
        "migration lock: this connection no longer holds it, so DATABASE_URL " +
          "likely reaches a transaction pooler: use a direct or session-mode " +
          "connection",
      );
    }
  } catch (error) {
    // Postgres releases a session's locks when the session ends.
    log?.warn("migration lock: connection lost before the release", {
      err: error,
    });
  }
}

/**
 * Run `work` while this process alone holds the migration lock, on a dedicated
 * connection held for the whole of `work`. A holder that dies frees the lock
 * with its session. A waiter past `waitMs` throws, so a stuck holder costs a
 * restart and a named log line, never a boot that hangs. Session-level, so it
 * needs a direct or session-mode connection.
 */
export async function runUnderMigrationLock<Outcome>(
  databaseUrl: string,
  work: (client: Client) => Promise<Outcome>,
  options: MigrationLockOptions = {},
): Promise<Outcome> {
  const {
    log,
    waitMs = MIGRATION_LOCK_WAIT_MS,
    warnEveryMs = MIGRATION_LOCK_WARN_EVERY_MS,
  } = options;
  const client = new Client({ connectionString: databaseUrl });
  // A checked-out connection's `error` event has no other listener, and an
  // unheard one would end the process.
  client.on("error", (error) => {
    log?.warn("migration lock: connection error", { err: error });
  });

  await client.connect();
  try {
    await waitForMigrationLock(client, { waitMs, warnEveryMs }, log);
    try {
      return await work(client);
    } finally {
      await releaseMigrationLock(client, log);
    }
  } finally {
    await client.end();
  }
}
