// The first boot's race: every process migrates an empty database at once, and
// graphile's own schema install has no lock. Runs only against
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
import { Logger as GraphileLogger, makeWorkerUtils } from "graphile-worker";
import {
  createFreshPostgresDatabase,
  readTestPostgresUrl,
} from "persistence/testing";
import { describe, expect, it } from "vitest";
import { startWorker } from "../src/runner";

const serverUrl = readTestPostgresUrl(process.env);
const CONCURRENT_BOOTS = 4;
const ROUNDS = 8;
const RACE_TIMEOUT_MS = 180_000;
const GRAPHILE_MIGRATIONS = 18;
const SILENT_GRAPHILE_LOGGER = new GraphileLogger(() => () => undefined);

function bootWorker(databaseUrl: string): ReturnType<typeof startWorker> {
  return startWorker({
    databaseUrl,
    taskList: {},
    crontab: "# nothing scheduled\n",
    logger: SILENT_GRAPHILE_LOGGER,
  });
}

async function countQueueMigrations(databaseUrl: string): Promise<number> {
  const utils = await makeWorkerUtils({
    connectionString: databaseUrl,
    logger: SILENT_GRAPHILE_LOGGER,
  });
  try {
    const counted = await utils.withPgClient((client) =>
      client.query<{ migrations: number }>(
        "select count(*)::int as migrations from graphile_worker.migrations",
      ),
    );
    return counted.rows[0]?.migrations ?? 0;
  } finally {
    await utils.release();
  }
}

describe.skipIf(serverUrl === undefined)("first boot on real Postgres", () => {
  it(
    "workers booting together on an empty database all come up",
    async () => {
      if (serverUrl === undefined) {
        throw new Error("unreachable");
      }

      for (let round = 0; round < ROUNDS; round += 1) {
        const database = await createFreshPostgresDatabase(serverUrl);
        try {
          const boots = await Promise.allSettled(
            Array.from({ length: CONCURRENT_BOOTS }, () =>
              bootWorker(database.url),
            ),
          );
          const running = boots.filter((boot) => boot.status === "fulfilled");
          await Promise.all(running.map((boot) => boot.value.stop()));

          const failures = boots.filter((boot) => boot.status === "rejected");
          expect(failures.map((boot) => String(boot.reason))).toEqual([]);
          expect(await countQueueMigrations(database.url)).toBe(
            GRAPHILE_MIGRATIONS,
          );
        } finally {
          await database.drop();
        }
      }
    },
    RACE_TIMEOUT_MS,
  );
});
