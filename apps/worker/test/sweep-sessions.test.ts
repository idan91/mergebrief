// The scheduled session sweep against a real migrated schema (the
// `persistence/testing` PGlite harness). Sessions are seeded through
// persistence's own session writes.
import { describe, expect, it } from "vitest";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import {
  createGrantAuth,
  createSessionAuth,
  isReviewerId,
  type ReviewerId,
} from "persistence";
import { createLogger, type Logger } from "logging";
import { createSweepSessionsTask } from "../src/task/sweep-sessions";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
    userId: reviewerId,
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
});
