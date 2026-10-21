// The scheduled audit sweep: the boot guard on its crontab line, and the
// task itself against a real migrated schema (the `persistence/testing` PGlite
// harness). Rows are seeded through the harness's raw window because ageing a
// row is not something the audit writer offers.
import { describe, expect, it } from "vitest";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { createLogger, type Logger } from "logging";
import { assertScheduledTasksRegistered, startWorker } from "../src/runner";
import {
  createSweepAuditTask,
  SWEEP_AUDIT_CRONTAB,
  SWEEP_AUDIT_TASK,
} from "../src/task/sweep-audit";

const TENANT = 4001n;
const OTHER_TENANT = 4002n;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * MS_PER_DAY);
}

async function seedAged(
  harness: PgliteHarness,
  installationId: bigint,
  occurredAt: Date,
): Promise<void> {
  await harness.raw(
    `insert into audit_log (installation_id, occurred_at, actor_type, operation, outcome)
     values ($1, $2, 'system', 'generate', 'ok')`,
    [installationId, occurredAt],
  );
}

async function auditRows(
  harness: PgliteHarness,
): Promise<Record<string, unknown>[]> {
  return harness.raw("select * from audit_log order by id");
}

function silentLogger(): Logger {
  return createLogger({ env: { LOG_LEVEL: "error" } });
}

describe("sweep-audit schedule", () => {
  it("refuses the boot itself, before it touches the database", async () => {
    // The unreachable DSN is the assertion: if the guard ever moves after the
    // migration step, this rejects with a connection error instead.
    await expect(
      startWorker({
        databaseUrl: "postgres://nobody@127.0.0.1:1/none",
        taskList: { generate: () => Promise.resolve() },
        crontab: SWEEP_AUDIT_CRONTAB,
      }),
    ).rejects.toThrow(/not a registered task/);
  });

  it("refuses a boot whose crontab names a task nobody registered", () => {
    // graphile queues jobs for an unknown task identifier without complaint;
    // this guard is what turns that silent drift into a boot failure.
    expect(() =>
      assertScheduledTasksRegistered(SWEEP_AUDIT_CRONTAB, {
        [SWEEP_AUDIT_TASK]: () => Promise.resolve(),
      }),
    ).not.toThrow();
    expect(() =>
      assertScheduledTasksRegistered(SWEEP_AUDIT_CRONTAB, {
        generate: () => Promise.resolve(),
      }),
    ).toThrow(/not a registered task/);
  });
});

describe("sweep-audit task", () => {
  it("deletes nothing when retention is unset", async () => {
    const harness = await createPgliteHarness();
    await seedAged(harness, TENANT, daysAgo(4000));

    await createSweepAuditTask({
      handle: harness.handle,
      retentionDays: null,
      log: silentLogger(),
    })();

    expect(await auditRows(harness)).toHaveLength(1);
    await harness.close();
  });

  it("erases rows past the window in every installation, counting each", async () => {
    const harness = await createPgliteHarness();
    await seedAged(harness, TENANT, daysAgo(120));
    await seedAged(harness, TENANT, daysAgo(90));
    await seedAged(harness, TENANT, daysAgo(10));
    await seedAged(harness, OTHER_TENANT, daysAgo(200));

    await createSweepAuditTask({
      handle: harness.handle,
      retentionDays: 30,
      log: silentLogger(),
    })();

    const remaining = await auditRows(harness);
    // The kept row, plus the sweep's own entry per installation swept.
    expect(remaining).toHaveLength(3);
    const sweeps = remaining.filter((row) => row["operation"] === "delete");
    expect(
      new Map(
        sweeps.map((row) => [String(row["installation_id"]), row["metadata"]]),
      ),
    ).toEqual(
      new Map([
        [String(TENANT), { count: 2 }],
        [String(OTHER_TENANT), { count: 1 }],
      ]),
    );
    await harness.close();
  });

  it("refuses a retention window under the floor", async () => {
    const harness = await createPgliteHarness();
    await expect(
      createSweepAuditTask({
        handle: harness.handle,
        retentionDays: 7,
        log: silentLogger(),
      })(),
    ).rejects.toThrow(/30/);
    await harness.close();
  });
});
