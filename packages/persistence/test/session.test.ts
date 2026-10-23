// The pre-tenant session boundary on PGlite: create, the grant-JOINed find,
// the deletes with their same-transaction grant orphan-clean, and the
// `setExpiresAt` mirror. Rotation lives on the grant boundary.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createGrantAuth, type GithubGrantRow } from "../src/auth/grant";
import { createSessionAuth, sweepExpiredSessions } from "../src/auth/session";
import { internal, type AppDatabase } from "../src/db/handle";
import { githubGrant } from "../src/schema/github-grant";
import { isReviewerId, type ReviewerId } from "../src/types";
import { brandWith, registerSharedPglite } from "./helpers";

const shared = registerSharedPglite();

const REVIEWER_ID: ReviewerId = brandWith(isReviewerId, 777n);
const HASH = "a".repeat(64); // shape of a sha256 hex digest
const OTHER_HASH = "b".repeat(64);
const OTHER_REVIEWER_ID: ReviewerId = brandWith(isReviewerId, 888n);
const THIRD_HASH = "c".repeat(64);
const EXPIRY = new Date("2027-01-01T00:00:00Z");

/** Seed a grant + one session row referencing it (the production shape). */
async function seedSession(
  handle: AppDatabase,
  input: {
    hash?: string;
    expiresAt?: Date;
    grant?: GithubGrantRow;
    reviewerId?: ReviewerId;
  },
): Promise<GithubGrantRow> {
  const grant =
    input.grant ??
    (await createGrantAuth(handle).createGrant({
      userId: input.reviewerId ?? REVIEWER_ID,
      ghTokenCiphertext: "v1.enc-access",
      ghRefreshTokenCiphertext: "v1.enc-refresh",
      keyRef: "SESSION_KEY_V1",
      refreshExpiresAt: input.expiresAt ?? EXPIRY,
    }));
  await createSessionAuth(handle).createSession({
    sessionTokenHash: input.hash ?? HASH,
    reviewerId: input.reviewerId ?? REVIEWER_ID,
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt: input.expiresAt ?? EXPIRY,
  });
  return grant;
}

async function grantCount(handle: AppDatabase): Promise<number> {
  return (
    await internal(handle).select({ id: githubGrant.id }).from(githubGrant)
  ).length;
}

describe("createSessionAuth.createSession", () => {
  it("creates a session that links its grant by id", async () => {
    const handle = shared.handle;
    const grant = await createGrantAuth(handle).createGrant({
      userId: REVIEWER_ID,
      ghTokenCiphertext: "v1.enc-access",
      ghRefreshTokenCiphertext: "v1.enc-refresh",
      keyRef: "SESSION_KEY_V1",
      refreshExpiresAt: EXPIRY,
    });

    const row = await createSessionAuth(handle).createSession({
      sessionTokenHash: HASH,
      reviewerId: REVIEWER_ID,
      grantId: grant.id,
      expiresAt: EXPIRY,
    });

    expect(row.grantId).toBe(grant.id);
    expect(row.reviewerId).toBe(REVIEWER_ID);
    const resolved = await createSessionAuth(handle).findSession(HASH);
    expect(resolved?.grant.id).toBe(grant.id);
  });
});

describe("createSessionAuth.findSession", () => {
  it("finds a session by its globally-unique hash, JOINed to its grant", async () => {
    const grant = await seedSession(shared.handle, {});
    const resolved = await createSessionAuth(shared.handle).findSession(HASH);
    expect(resolved).toBeDefined();
    expect(resolved?.session.sessionTokenHash).toBe(HASH);
    expect(String(resolved?.session.reviewerId)).toBe(String(REVIEWER_ID));
    // The credential material rides on the grant half only.
    expect(resolved?.grant.id).toBe(grant.id);
    expect(resolved?.grant.ghTokenCiphertext).toBe("v1.enc-access");
    expect(resolved?.session).not.toHaveProperty("ghTokenCiphertext");
  });

  it("returns undefined for an unknown hash", async () => {
    expect(
      await createSessionAuth(shared.handle).findSession(OTHER_HASH),
    ).toBeUndefined();
  });
});

describe("createSessionAuth.deleteSession, last-referent lifecycle", () => {
  it("deletes by hash and orphan-cleans the grant in the same transaction", async () => {
    await seedSession(shared.handle, {});
    expect(await grantCount(shared.handle)).toBe(1);
    expect(await createSessionAuth(shared.handle).deleteSession(HASH)).toBe(1);
    expect(
      await createSessionAuth(shared.handle).findSession(HASH),
    ).toBeUndefined();
    // Last referent gone → the grant died with it.
    expect(await grantCount(shared.handle)).toBe(0);
    // Idempotent: deleting an already-gone hash is a clean 0.
    expect(await createSessionAuth(shared.handle).deleteSession(HASH)).toBe(0);
  });

  it("keeps a grant that another referent still shares", async () => {
    const grant = await seedSession(shared.handle, {});
    await seedSession(shared.handle, { hash: OTHER_HASH, grant });
    expect(await createSessionAuth(shared.handle).deleteSession(HASH)).toBe(1);
    // The sibling still holds the grant.
    expect(await grantCount(shared.handle)).toBe(1);
    const resolved = await createSessionAuth(shared.handle).findSession(
      OTHER_HASH,
    );
    expect(resolved?.grant.id).toBe(grant.id);
  });
});

describe("createSessionAuth.deleteSessionsForReviewer", () => {
  it("deletes every session of the reviewer and orphan-cleans the grant", async () => {
    const grant = await seedSession(shared.handle, {});
    await seedSession(shared.handle, { hash: OTHER_HASH, grant });

    const deleted = await createSessionAuth(
      shared.handle,
    ).deleteSessionsForReviewer(REVIEWER_ID);

    expect(deleted).toBe(2);
    expect(
      await createSessionAuth(shared.handle).findSession(HASH),
    ).toBeUndefined();
    expect(await grantCount(shared.handle)).toBe(0);
  });

  it("leaves another reviewer's sessions and grant in place", async () => {
    await seedSession(shared.handle, {});
    const otherGrant = await seedSession(shared.handle, {
      hash: THIRD_HASH,
      reviewerId: OTHER_REVIEWER_ID,
    });

    const deleted = await createSessionAuth(
      shared.handle,
    ).deleteSessionsForReviewer(REVIEWER_ID);

    expect(deleted).toBe(1);
    const survivor = await createSessionAuth(shared.handle).findSession(
      THIRD_HASH,
    );
    expect(survivor?.session.reviewerId).toBe(OTHER_REVIEWER_ID);
    expect(survivor?.grant.id).toBe(otherGrant.id);
    expect(await grantCount(shared.handle)).toBe(1);
  });

  it("answers 0 for a reviewer with no sessions", async () => {
    expect(
      await createSessionAuth(shared.handle).deleteSessionsForReviewer(
        REVIEWER_ID,
      ),
    ).toBe(0);
  });
});

describe("createSessionAuth.setExpiresAt", () => {
  it("mirrors a rotated refresh-token lifetime onto the session row", async () => {
    await seedSession(shared.handle, {});
    const rotated = new Date("2027-06-01T00:00:00Z");
    expect(
      await createSessionAuth(shared.handle).setExpiresAt(HASH, rotated),
    ).toBe(1);
    const resolved = await createSessionAuth(shared.handle).findSession(HASH);
    expect(resolved?.session.expiresAt).toEqual(rotated);
    // Unknown hash is a clean 0, not an error.
    expect(
      await createSessionAuth(shared.handle).setExpiresAt(OTHER_HASH, rotated),
    ).toBe(0);
  });
});

describe("sweepExpiredSessions", () => {
  const NOW = new Date("2026-07-04T00:00:00Z");
  const EXPIRED = new Date("2026-07-01T00:00:00Z");
  const LIVE = new Date("2026-07-10T00:00:00Z");

  it("deletes expired sessions of every reviewer and keeps live ones", async () => {
    await seedSession(shared.handle, { hash: HASH, expiresAt: EXPIRED });
    await seedSession(shared.handle, {
      hash: OTHER_HASH,
      expiresAt: EXPIRED,
      reviewerId: OTHER_REVIEWER_ID,
    });
    await seedSession(shared.handle, { hash: THIRD_HASH, expiresAt: LIVE });

    expect(await sweepExpiredSessions(shared.handle, NOW)).toBe(2);

    const sessions = createSessionAuth(shared.handle);
    expect(await sessions.findSession(HASH)).toBeUndefined();
    expect(await sessions.findSession(OTHER_HASH)).toBeUndefined();
    expect(await sessions.findSession(THIRD_HASH)).toBeDefined();
  });

  it("orphan-cleans swept grants and keeps one a live session shares", async () => {
    await seedSession(shared.handle, { hash: HASH, expiresAt: EXPIRED });
    const sharedGrant = await seedSession(shared.handle, {
      hash: OTHER_HASH,
      expiresAt: EXPIRED,
    });
    await seedSession(shared.handle, {
      hash: THIRD_HASH,
      expiresAt: LIVE,
      grant: sharedGrant,
    });
    expect(await grantCount(shared.handle)).toBe(2);

    expect(await sweepExpiredSessions(shared.handle, NOW)).toBe(2);

    expect(await grantCount(shared.handle)).toBe(1);
    const survivor = await createSessionAuth(shared.handle).findSession(
      THIRD_HASH,
    );
    expect(survivor?.grant.id).toBe(sharedGrant.id);
  });

  it("keeps a session whose expiry is exactly now", async () => {
    await seedSession(shared.handle, { expiresAt: NOW });

    expect(await sweepExpiredSessions(shared.handle, NOW)).toBe(0);
    expect(
      await createSessionAuth(shared.handle).findSession(HASH),
    ).toBeDefined();
  });

  it("sweeps a backlog larger than one batch in a single call", async () => {
    const grant = await seedSession(shared.handle, { expiresAt: EXPIRED });
    const backlog = 1200;
    await internal(shared.handle).execute(
      sql`insert into auth_session (session_token_hash, reviewer_id, grant_id, expires_at)
          select 'backlog-' || n, ${REVIEWER_ID}, ${grant.id}, ${EXPIRED}
          from generate_series(1, ${backlog}) as n`,
    );

    expect(await sweepExpiredSessions(shared.handle, NOW)).toBe(backlog + 1);
    expect(await grantCount(shared.handle)).toBe(0);
  });

  it("answers 0 when nothing has expired", async () => {
    await seedSession(shared.handle, { expiresAt: LIVE });

    expect(await sweepExpiredSessions(shared.handle, NOW)).toBe(0);
    expect(await grantCount(shared.handle)).toBe(1);
  });
});

describe("auth_session schema, no credential columns", () => {
  it("the session table carries a grant FK and NO ciphertext columns", async () => {
    const db = shared.db;
    const result = await db.execute(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'auth_session' order by column_name`,
    );
    const names = result.rows
      .map((row) => row["column_name"])
      .filter((name): name is string => typeof name === "string");
    expect(names).toEqual([
      "created_at",
      "expires_at",
      "grant_id",
      "id",
      "reviewer_id",
      "reviewer_login",
      "session_token_hash",
    ]);
  });
});
