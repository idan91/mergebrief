// The scheduled session sweep: the crontab line the runner registers, and the
// task itself against a real migrated schema (the `persistence/testing` PGlite
// harness). Sessions are seeded through persistence's own session writes.
import { describe, expect, it } from "vitest";
import { parseCrontab } from "graphile-worker";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import {
  createGrantAuth,
  createSessionAuth,
  isReviewerId,
  type ReviewerId,
} from "persistence";
import { createLogger, type Logger } from "logging";
import { assertScheduledTasksRegistered } from "../src/runner";
import {
  createSweepSessionsTask,
  SWEEP_SESSIONS_CRONTAB,
  SWEEP_SESSIONS_TASK,
} from "../src/task/sweep-sessions";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;

function makeReviewerId(id: bigint): ReviewerId {
  if (!isReviewerId(id)) {
    throw new Error("not a reviewer id");
  }
  return id;
}

const REVIEWER = makeReviewerId(5001n);
const OTHER_REVIEWER = makeReviewerId(5002n);

function shiftNowByDays(days: number): Date {
  return new Date(Date.now() + days * MS_PER_DAY);
}

async function seedSession(
  harness: PgliteHarness,
  hash: string,
  reviewerId: ReviewerId,
  expiresAt: Date,
): Promise<void> {
  const grant = await createGrantAuth(harness.handle).createGrant({
    ghTokenCiphertext: "v1.enc-access",
    ghRefreshTokenCiphertext: "v1.enc-refresh",
    keyRef: "SESSION_KEY_V1",
    refreshExpiresAt: expiresAt,
  });
  await createSessionAuth(harness.handle).createSession({
    sessionTokenHash: hash,
    reviewerId,
    grantId: grant.id,
    expiresAt,
  });
}

async function readSessionHashes(harness: PgliteHarness): Promise<unknown[]> {
  const rows = await harness.raw(
    "select session_token_hash from auth_session order by id",
  );
  return rows.map((row) => row["session_token_hash"]);
}

async function countGrants(harness: PgliteHarness): Promise<number> {
  return (await harness.raw("select id from github_grant")).length;
}

function makeSilentLogger(): Logger {
  return createLogger({ env: { LOG_LEVEL: "error" } });
}

describe("sweep-sessions schedule", () => {
  it("fires once an hour", () => {
    const items = parseCrontab(SWEEP_SESSIONS_CRONTAB);
    expect(items).toHaveLength(1);
    const match = items[0]?.match;
    let fired = 0;
    for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
      for (let min = 0; min < MINUTES_PER_HOUR; min += 1) {
        const matched = match?.({ min, hour, date: 10, month: 6, dow: 1 });
        fired += matched === true ? 1 : 0;
      }
    }
    expect(fired).toBe(HOURS_PER_DAY);
  });

  it("refuses a boot that schedules it without registering it", () => {
    expect(() =>
      assertScheduledTasksRegistered(SWEEP_SESSIONS_CRONTAB, {
        [SWEEP_SESSIONS_TASK]: () => Promise.resolve(),
      }),
    ).not.toThrow();
    expect(() =>
      assertScheduledTasksRegistered(SWEEP_SESSIONS_CRONTAB, {
        generate: () => Promise.resolve(),
      }),
    ).toThrow(/not a registered task/);
  });
});

describe("sweep-sessions task", () => {
  it("deletes expired sessions of every reviewer and keeps live ones", async () => {
    const harness = await createPgliteHarness();
    await seedSession(harness, "expired-a", REVIEWER, shiftNowByDays(-1));
    await seedSession(
      harness,
      "expired-b",
      OTHER_REVIEWER,
      shiftNowByDays(-30),
    );
    await seedSession(harness, "live", REVIEWER, shiftNowByDays(1));

    await createSweepSessionsTask({
      handle: harness.handle,
      log: makeSilentLogger(),
    })();

    expect(await readSessionHashes(harness)).toEqual(["live"]);
    expect(await countGrants(harness)).toBe(1);
    await harness.close();
  });

  it("deletes nothing when no session has expired", async () => {
    const harness = await createPgliteHarness();
    await seedSession(harness, "live", REVIEWER, shiftNowByDays(1));

    await createSweepSessionsTask({
      handle: harness.handle,
      log: makeSilentLogger(),
    })();

    expect(await readSessionHashes(harness)).toEqual(["live"]);
    await harness.close();
  });
});
