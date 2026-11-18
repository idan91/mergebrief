// The migration lock across real sessions: PGlite runs one connection, so it
// cannot show a waiter, a dead holder or a second process. Runs only against
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
import { setTimeout as sleep } from "node:timers/promises";
import { createLogger, type Logger } from "logging";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureAppSchema, migrateApp } from "../src/db/migrate";
import { runUnderMigrationLock } from "../src/db/migration-lock";
import {
  createFreshPostgresDatabase,
  readTestPostgresUrl,
  waitUntil,
  type FreshPostgresDatabase,
} from "../src/testing";

const serverUrl = readTestPostgresUrl(process.env);
const CONCURRENT_BOOTS = 4;
const ROUNDS = 3;
const QUEUE_STEP_MS = 30;
const SHORT_WAIT_MS = 400;
const LONG_WAIT_MS = 10_000;
const POLL_SLACK_MS = 1_000;
const WARN_EVERY_MS = 300;
const WARNED_LINES = 3;
const RACE_TIMEOUT_MS = 120_000;

interface Gate {
  readonly opened: Promise<void>;
  open(): void;
}

function makeGate(): Gate {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

function makeCapturedLog(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const log = createLogger({
    env: {},
    destination: {
      write: (line: string) => {
        lines.push(line);
      },
    },
  });
  return { log, lines };
}

/** Holds the lock until the returned `release` is called. */
async function holdMigrationLock(
  databaseUrl: string,
): Promise<{ pid: number; release: () => Promise<void> }> {
  const entered = makeGate();
  const leave = makeGate();
  let pid = 0;
  const holding = runUnderMigrationLock(databaseUrl, async (client) => {
    const backend = await client.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    pid = backend.rows[0]?.pid ?? 0;
    entered.open();
    await leave.opened;
  });
  await entered.opened;
  return {
    pid,
    release: async () => {
      leave.open();
      await holding;
    },
  };
}

async function terminateBackend(databaseUrl: string, pid: number) {
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    await admin.query("select pg_terminate_backend($1)", [pid]);
  } finally {
    await admin.end();
  }
}

describe.skipIf(serverUrl === undefined)("migration lock", () => {
  let database: FreshPostgresDatabase;
  let databaseUrl = "";

  beforeAll(async () => {
    if (serverUrl === undefined) {
      throw new Error("unreachable");
    }
    database = await createFreshPostgresDatabase(serverUrl);
    databaseUrl = database.url;
  });

  afterAll(async () => {
    await database.drop();
  });

  it(
    "concurrent boots on an empty database run one migrator at a time",
    async () => {
      if (serverUrl === undefined) {
        throw new Error("unreachable");
      }

      for (let round = 0; round < ROUNDS; round += 1) {
        const empty = await createFreshPostgresDatabase(serverUrl);
        let inside = 0;
        let mostInside = 0;
        let queueSteps = 0;
        const migrateQueue = async (): Promise<void> => {
          inside += 1;
          mostInside = Math.max(mostInside, inside);
          await sleep(QUEUE_STEP_MS);
          inside -= 1;
          queueSteps += 1;
        };

        const boots = await Promise.all(
          Array.from({ length: CONCURRENT_BOOTS }, () =>
            ensureAppSchema(empty.url, { autoMigrate: true, migrateQueue }),
          ),
        );

        expect(boots.every((boot) => boot.ok)).toBe(true);
        expect(mostInside).toBe(1);
        expect(queueSteps).toBe(CONCURRENT_BOOTS);
        await empty.drop();
      }
    },
    RACE_TIMEOUT_MS,
  );

  it("a waiter says so once and takes the lock when the holder leaves", async () => {
    const holder = await holdMigrationLock(databaseUrl);
    const { log, lines } = makeCapturedLog();
    let ran = false;

    const waiting = runUnderMigrationLock(
      databaseUrl,
      async () => {
        ran = true;
      },
      { log, waitMs: LONG_WAIT_MS },
    );
    await waitUntil(() => lines.length > 0, LONG_WAIT_MS);
    expect(ran).toBe(false);

    await holder.release();
    await waiting;

    expect(ran).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("another process is migrating");
  });

  it("a waiter warns about a pooler while the lock stays held", async () => {
    const holder = await holdMigrationLock(databaseUrl);
    const { log, lines } = makeCapturedLog();

    const waiting = runUnderMigrationLock(databaseUrl, async () => undefined, {
      log,
      waitMs: LONG_WAIT_MS,
      warnEveryMs: WARN_EVERY_MS,
    });
    await waitUntil(() => lines.length >= WARNED_LINES, LONG_WAIT_MS);
    await holder.release();
    await waiting;

    expect(lines[0]).toContain("another process is migrating");
    expect(lines[1]).toContain("still waiting");
    expect(lines[1]).toContain("transaction pooler");
    expect(lines[2]).toContain("still waiting");
  });

  it("a waiter past its bound throws without the connection string", async () => {
    const holder = await holdMigrationLock(databaseUrl);
    const started = Date.now();

    const failure = await runUnderMigrationLock(
      databaseUrl,
      async () => undefined,
      { waitMs: SHORT_WAIT_MS },
    ).catch((error: unknown) => String(error));

    const waited = Date.now() - started;
    await holder.release();

    expect(failure).toContain("migration lock: still held after");
    expect(failure).toContain("transaction pooler");
    expect(failure).not.toContain(databaseUrl);
    expect(waited).toBeGreaterThanOrEqual(SHORT_WAIT_MS);
    expect(waited).toBeLessThan(SHORT_WAIT_MS + POLL_SLACK_MS);
  });

  it("a failed step releases the lock and keeps its own error", async () => {
    await expect(
      runUnderMigrationLock(databaseUrl, async () => {
        throw new Error("migration failed");
      }),
    ).rejects.toThrow("migration failed");

    const next = await runUnderMigrationLock(databaseUrl, async () => "taken", {
      waitMs: SHORT_WAIT_MS,
    });
    expect(next).toBe("taken");
  });

  it("a holder whose session dies frees the lock and finishes its step", async () => {
    const entered = makeGate();
    const finish = makeGate();
    const { log, lines } = makeCapturedLog();
    let holderPid = 0;
    const holding = runUnderMigrationLock(
      databaseUrl,
      async (client) => {
        const backend = await client.query<{ pid: number }>(
          "select pg_backend_pid() as pid",
        );
        holderPid = backend.rows[0]?.pid ?? 0;
        entered.open();
        await finish.opened;
        return "finished";
      },
      { log },
    );
    await entered.opened;

    const waiter = runUnderMigrationLock(databaseUrl, async () => "taken", {
      waitMs: LONG_WAIT_MS,
    });
    await terminateBackend(databaseUrl, holderPid);

    expect(await waiter).toBe("taken");
    finish.open();
    expect(await holding).toBe("finished");
    expect(lines.join("\n")).toContain("connection lost before the release");
  });

  it("a release that finds no lock warns about a transaction pooler", async () => {
    const { log, lines } = makeCapturedLog();

    // What a transaction pooler does: the unlock lands on a session that never
    // took the lock.
    await runUnderMigrationLock(
      databaseUrl,
      async (client) => {
        await client.query("select pg_advisory_unlock_all()");
      },
      { log },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("transaction pooler");
  });

  it("a check-only boot never waits on the lock", async () => {
    await migrateApp(databaseUrl);
    const holder = await holdMigrationLock(databaseUrl);
    const steps: string[] = [];

    const checked = await ensureAppSchema(databaseUrl, {
      autoMigrate: false,
      migrateQueue: async () => {
        steps.push("queue");
      },
    });
    await holder.release();

    expect(checked.ok).toBe(true);
    expect(steps).toEqual(["queue"]);
  });
});
