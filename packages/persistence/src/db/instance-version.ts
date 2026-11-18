// The boot-time write of `instance_version`: the process that applied the
// schema records the version it runs, logs the upgrade when the row moves
// forward, and warns, never refuses, when the database is ahead. A refusal
// would kill rollback by compose file.
import type { Logger } from "logging";
import { Pool } from "pg";
import type { Semver } from "../version";
import { compareSemver, isDevVersion, parseSemver } from "../version";

/** One parameterized query round-trip; pg in production, PGlite in tests. */
export type VersionQueryExecutor = (
  sql: string,
  params: readonly unknown[],
) => Promise<readonly Record<string, unknown>[]>;

function readStoredVersion(
  rows: readonly Record<string, unknown>[],
): string | undefined {
  const stored = rows[0]?.["version"];
  return typeof stored === "string" ? stored : undefined;
}

/** A release's version, or absent for a dev build and for text that is not a version. */
function resolveReleaseVersion(value: string): Semver | undefined {
  if (isDevVersion(value)) {
    return undefined;
  }
  const parsed = parseSemver(value);
  return parsed.ok ? parsed.value : undefined;
}

function reportChange(stored: string, running: string, log: Logger): void {
  const storedVersion = resolveReleaseVersion(stored);
  const runningVersion = resolveReleaseVersion(running);
  if (storedVersion === undefined || runningVersion === undefined) {
    return;
  }

  const order = compareSemver(runningVersion, storedVersion);
  if (order > 0) {
    log.info("database schema version moved forward", {
      evt: "db.version.upgrade",
      from: stored,
      to: running,
    });
  }
  if (order < 0) {
    log.warn("database was last recorded by a newer version", {
      evt: "db.version.ahead",
      db: stored,
      running,
    });
  }
}

/** A dev build never replaces a real version: the next real boot must still see it. */
function shouldWrite(stored: string | undefined, running: string): boolean {
  if (stored === undefined) {
    return true;
  }
  if (stored === running) {
    return false;
  }
  const storedIsReal = resolveReleaseVersion(stored) !== undefined;
  const runningIsReal = resolveReleaseVersion(running) !== undefined;
  const keepsEveryRealRow = runningIsReal || !storedIsReal;
  return keepsEveryRealRow;
}

async function writeRunningVersion(
  executor: VersionQueryExecutor,
  running: string,
  log: Logger,
): Promise<void> {
  const rows = await executor(
    "select version from instance_version where id",
    [],
  );
  const stored = readStoredVersion(rows);

  if (stored !== undefined && stored !== running) {
    reportChange(stored, running, log);
  }
  const recordsRunning = shouldWrite(stored, running);
  if (recordsRunning) {
    await executor(
      "insert into instance_version (id, version, updated_at) values (true, $1, now()) " +
        "on conflict (id) do update set version = excluded.version, updated_at = now()",
      [running],
    );
  }
}

/**
 * Record `running` in the one row, logging the move. Never throws: a role
 * that cannot write the row gets a `warn`, not a dead boot.
 */
export async function recordInstanceVersionWith(
  executor: VersionQueryExecutor,
  running: string,
  log: Logger,
): Promise<void> {
  try {
    await writeRunningVersion(executor, running, log);
  } catch (error) {
    log.warn("instance version was not recorded", { running, err: error });
  }
}

/** `recordInstanceVersionWith` over a short-lived single-connection pool. */
export async function recordInstanceVersion(
  databaseUrl: string,
  running: string,
  log: Logger,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await recordInstanceVersionWith(
      async (sql, params) => (await pool.query(sql, [...params])).rows,
      running,
      log,
    );
  } finally {
    await pool.end();
  }
}
