// The migrate entry and the api's boot share the lock with the worker: several
// runs on an empty database all exit 0, against real graphile. Runs only against
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
import { ensureAppSchema } from "persistence";
import {
  createFreshPostgresDatabase,
  readTestPostgresUrl,
} from "persistence/testing";
import { describe, expect, it } from "vitest";
import { runMigrate } from "../src/boot/migrate";
import { ExitCodes } from "../src/boot/types";
import { migrateQueue } from "../src/queue";
import { testLogging } from "./logging";

const serverUrl = readTestPostgresUrl(process.env);
const CONCURRENT_RUNS = 4;
const ROUNDS = 8;
const RACE_TIMEOUT_MS = 180_000;

describe.skipIf(serverUrl === undefined)("migrate on real Postgres", () => {
  it(
    "runs together on an empty database all exit 0 with no error line",
    async () => {
      if (serverUrl === undefined) {
        throw new Error("unreachable");
      }

      for (let round = 0; round < ROUNDS; round += 1) {
        const database = await createFreshPostgresDatabase(serverUrl);
        const logging = testLogging();
        try {
          const codes = await Promise.all(
            Array.from({ length: CONCURRENT_RUNS }, () =>
              runMigrate({
                databaseUrl: database.url,
                runningVersion: "1.6.0",
                log: logging.logger,
                ensure: ensureAppSchema,
                migrateQueue,
              }),
            ),
          );

          expect(codes).toEqual(
            Array.from({ length: CONCURRENT_RUNS }, () => ExitCodes.SUCCESS),
          );
          const errors = logging
            .lines()
            .filter((line) => line["level"] === "error");
          expect(errors).toEqual([]);
        } finally {
          await database.drop();
        }
      }
    },
    RACE_TIMEOUT_MS,
  );
});
