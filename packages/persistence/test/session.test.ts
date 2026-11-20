// The pre-tenant session boundary on PGlite: create, the grant-JOINed find,
// the deletes with their same-transaction grant orphan-clean, and the
// `setExpiresAt` mirror. Rotation lives on the grant boundary.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createEnvKeyProvider, CryptoErrorCodes } from "../src/auth/crypto";
import type {
  GithubGrantRow,
  GrantCreateInput,
  OrphanedGrant,
} from "../src/auth/grant";
import { createSessionAuth, sweepExpiredSessions } from "../src/auth/session";
import { createTokenAuth } from "../src/auth/token";
import { internal, type AppDatabase } from "../src/db/handle";
import { githubGrant } from "../src/schema/github-grant";
import { isReviewerId, type ReviewerId } from "../src/types";
import {
  brandWith,
  createQueryLog,
  makeGrant,
  registerSharedPglite,
  TEST_KEY_PROVIDER,
  TEST_KEY_REF,
} from "./helpers";
import { AccessLevels } from "types/access-levels";

const shared = registerSharedPglite();

const REVIEWER_ID: ReviewerId = brandWith(isReviewerId, 777n);
const HASH = "a".repeat(64); // shape of a sha256 hex digest
const OTHER_HASH = "b".repeat(64);
const OTHER_REVIEWER_ID: ReviewerId = brandWith(isReviewerId, 888n);
const THIRD_HASH = "c".repeat(64);
const EXPIRY = new Date("2027-01-01T00:00:00Z");
const EXPIRED_AT = new Date("2020-01-01T00:00:00Z");

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
    (await makeGrant(
      handle,
      input.reviewerId ?? REVIEWER_ID,
      input.expiresAt ?? EXPIRY,
    ));
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
    const grant = await makeGrant(handle, REVIEWER_ID, EXPIRY);

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

describe("createSessionAuth.createSessionWithGrant", () => {
  const GRANT_INPUT: GrantCreateInput = {
    userId: REVIEWER_ID,
    accessToken: "ghu_test-access",
    refreshToken: "ghr_test-refresh",
    keyProvider: TEST_KEY_PROVIDER,
    keyRef: TEST_KEY_REF,
    refreshExpiresAt: EXPIRY,
  };

  it("stores the sealed grant and the session that links it", async () => {
    const handle = shared.handle;

    const created = await createSessionAuth(handle).createSessionWithGrant({
      sessionTokenHash: HASH,
      reviewerLogin: "octocat",
      grant: GRANT_INPUT,
    });

    if (!created.ok) {
      throw new Error("unreachable");
    }
    expect(created.value.grant.ghTokenCiphertext.startsWith("v2.")).toBe(true);
    expect(created.value.session).toMatchObject({
      grantId: created.value.grant.id,
      reviewerId: REVIEWER_ID,
      reviewerLogin: "octocat",
      expiresAt: EXPIRY,
    });
    const resolved = await createSessionAuth(handle).findSession(HASH);
    expect(resolved?.grant.id).toBe(created.value.grant.id);
  });

  it("leaves no grant when the session insert fails", async () => {
    const handle = shared.handle;
    const earlier = await seedSession(handle, {});

    const created = createSessionAuth(handle).createSessionWithGrant({
      sessionTokenHash: HASH,
      grant: GRANT_INPUT,
    });

    await expect(created).rejects.toThrow(/auth_session/);
    const grants = await internal(handle)
      .select({ id: githubGrant.id })
      .from(githubGrant);
    expect(grants).toEqual([{ id: earlier.id }]);
  });

  it("stores neither row when the key cannot be resolved", async () => {
    const handle = shared.handle;

    const created = await createSessionAuth(handle).createSessionWithGrant({
      sessionTokenHash: HASH,
      grant: { ...GRANT_INPUT, keyProvider: createEnvKeyProvider({}) },
    });

    expect(created).toMatchObject({
      ok: false,
      error: { code: CryptoErrorCodes.KEY_UNAVAILABLE },
    });
    expect(await grantCount(handle)).toBe(0);
    expect(await createSessionAuth(handle).findSession(HASH)).toBeUndefined();
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
    expect(resolved?.grant.ghTokenCiphertext).toBe(grant.ghTokenCiphertext);
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
    const deleted = await createSessionAuth(shared.handle).deleteSession(HASH);
    expect(deleted.deleted).toBe(1);
    expect(
      await createSessionAuth(shared.handle).findSession(HASH),
    ).toBeUndefined();
    // Last referent gone → the grant died with it.
    expect(await grantCount(shared.handle)).toBe(0);
    // Idempotent: deleting an already-gone hash is a clean 0.
    const again = await createSessionAuth(shared.handle).deleteSession(HASH);
    expect(again).toEqual({ deleted: 0, orphanedGrants: [] });
  });

  it("keeps a grant that another referent still shares", async () => {
    const grant = await seedSession(shared.handle, {});
    await seedSession(shared.handle, { hash: OTHER_HASH, grant });
    const deleted = await createSessionAuth(shared.handle).deleteSession(HASH);
    expect(deleted).toEqual({ deleted: 1, orphanedGrants: [] });
    // The sibling still holds the grant.
    expect(await grantCount(shared.handle)).toBe(1);
    const resolved = await createSessionAuth(shared.handle).findSession(
      OTHER_HASH,
    );
    expect(resolved?.grant.id).toBe(grant.id);
  });

  it("returns the grant its last session took with it", async () => {
    const grant = await seedSession(shared.handle, {});

    const deleted = await createSessionAuth(shared.handle).deleteSession(HASH);

    expect(deleted.orphanedGrants).toEqual([
      {
        id: grant.id,
        ghTokenCiphertext: grant.ghTokenCiphertext,
        keyRef: grant.keyRef,
      },
    ]);
  });

  it("returns no grant while an API token still links it", async () => {
    const grant = await seedSession(shared.handle, {});
    await createTokenAuth(shared.handle).mintToken({
      scope: AccessLevels.READ,
      userId: REVIEWER_ID,
      userLogin: "octocat",
      name: "ci",
      tokenHash: THIRD_HASH,
      grantId: grant.id,
      expiresAt: null,
    });

    const deleted = await createSessionAuth(shared.handle).deleteSession(HASH);

    expect(deleted).toEqual({ deleted: 1, orphanedGrants: [] });
    expect(await grantCount(shared.handle)).toBe(1);
  });

  it("returns the grant when its only token is revoked, keeping the row", async () => {
    const grant = await seedSession(shared.handle, {});
    const tokens = createTokenAuth(shared.handle);
    const minted = await tokens.mintToken({
      scope: AccessLevels.READ,
      userId: REVIEWER_ID,
      userLogin: "octocat",
      name: "ci",
      tokenHash: THIRD_HASH,
      grantId: grant.id,
      expiresAt: null,
    });
    await tokens.revokeToken(REVIEWER_ID, minted.id, EXPIRED_AT);

    const deleted = await createSessionAuth(shared.handle).deleteSession(HASH);

    expect(deleted.orphanedGrants.map((orphan) => orphan.id)).toEqual([
      grant.id,
    ]);
    expect(await grantCount(shared.handle)).toBe(1);
  });

  it("returns the grant when its only token has expired", async () => {
    const grant = await seedSession(shared.handle, {});
    await createTokenAuth(shared.handle).mintToken({
      scope: AccessLevels.READ,
      userId: REVIEWER_ID,
      userLogin: "octocat",
      name: "ci",
      tokenHash: THIRD_HASH,
      grantId: grant.id,
      expiresAt: EXPIRED_AT,
    });

    const deleted = await createSessionAuth(shared.handle).deleteSession(HASH);

    expect(deleted.orphanedGrants.map((orphan) => orphan.id)).toEqual([
      grant.id,
    ]);
  });
});

describe("createSessionAuth.deleteSessionsForReviewer", () => {
  it("locks the candidate grants in id order", async () => {
    const log = createQueryLog(shared.client);
    await seedSession(log.handle, {});
    await seedSession(log.handle, { hash: OTHER_HASH });
    log.statements.length = 0;

    await createSessionAuth(log.handle).deleteSessionsForReviewer(REVIEWER_ID);

    const lock = log.statements.find(
      (statement) =>
        statement.includes('from "github_grant"') &&
        statement.endsWith("for update"),
    );
    expect(lock).toMatch(/order by "github_grant"\."id" for update$/);
  });

  it("deletes every session of the reviewer and orphan-cleans the grant", async () => {
    const grant = await seedSession(shared.handle, {});
    await seedSession(shared.handle, { hash: OTHER_HASH, grant });

    const deleted = await createSessionAuth(
      shared.handle,
    ).deleteSessionsForReviewer(REVIEWER_ID);

    expect(deleted.deleted).toBe(2);
    expect(deleted.orphanedGrants.map((orphan) => orphan.id)).toEqual([
      grant.id,
    ]);
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

    expect(deleted.deleted).toBe(1);
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
    ).toEqual({ deleted: 0, orphanedGrants: [] });
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

async function runSessionSweep(now: Date) {
  const orphanedGrants: OrphanedGrant[] = [];
  const sessionsDeleted = await sweepExpiredSessions(
    shared.handle,
    now,
    (grants) => {
      orphanedGrants.push(...grants);
    },
  );
  return { sessionsDeleted, orphanedGrants };
}

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

    expect((await runSessionSweep(NOW)).sessionsDeleted).toBe(2);

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

    expect((await runSessionSweep(NOW)).sessionsDeleted).toBe(2);

    expect(await grantCount(shared.handle)).toBe(1);
    const survivor = await createSessionAuth(shared.handle).findSession(
      THIRD_HASH,
    );
    expect(survivor?.grant.id).toBe(sharedGrant.id);
  });

  it("returns the grants its expired sessions took with it", async () => {
    const grant = await seedSession(shared.handle, { expiresAt: EXPIRED });

    const swept = await runSessionSweep(NOW);

    expect(swept.orphanedGrants).toEqual([
      {
        id: grant.id,
        ghTokenCiphertext: grant.ghTokenCiphertext,
        keyRef: grant.keyRef,
      },
    ]);
  });

  it("keeps a session whose expiry is exactly now", async () => {
    await seedSession(shared.handle, { expiresAt: NOW });

    expect((await runSessionSweep(NOW)).sessionsDeleted).toBe(0);
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

    expect((await runSessionSweep(NOW)).sessionsDeleted).toBe(backlog + 1);
    expect(await grantCount(shared.handle)).toBe(0);
  });

  it("answers 0 when nothing has expired", async () => {
    await seedSession(shared.handle, { expiresAt: LIVE });

    expect((await runSessionSweep(NOW)).sessionsDeleted).toBe(0);
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
