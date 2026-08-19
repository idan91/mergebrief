// Session-auth boundary tests. Exercises the PRE-TENANT, token-hash-keyed
// resolver against real migrations
// on PGlite: the grant-JOINed find, delete-by-hash with same-transaction
// grant orphan-clean (shared grants survive, last-referent grants die), and
// the `setExpiresAt` mirror the cookie channel writes after a rotation.
// Rotation itself lives on the grant boundary — see grant.test.ts. Rows are
// seeded through the tenant repository so the boundary is tested exactly as
// production writes them.
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { grantAuth, type GithubGrantRow } from "../src/auth/grant";
import { sessionAuth } from "../src/auth/session";
import { forTenant } from "../src/stores/tenant";
import { internal, type AppDatabase } from "../src/db/handle";
import { githubGrant } from "../src/schema/github-grant";
import {
  isInstallationId,
  isReviewerId,
  type InstallationId,
  type ReviewerId,
} from "../src/types";
import { brandWith, freshDatabase } from "./helpers";

const INSTALLATION_ID: InstallationId = brandWith(isInstallationId, 4242n);
const REVIEWER_ID: ReviewerId = brandWith(isReviewerId, 777n);
const HASH = "a".repeat(64); // shape of a sha256 hex digest
const OTHER_HASH = "b".repeat(64);
const EXPIRY = new Date("2027-01-01T00:00:00Z");

/** Seed a grant + one session row referencing it (the production shape). */
async function seedSession(
  handle: AppDatabase,
  input: { hash?: string; expiresAt?: Date; grant?: GithubGrantRow },
): Promise<GithubGrantRow> {
  const grant =
    input.grant ??
    (await grantAuth(handle).createGrant({
      ghTokenCiphertext: "v1.enc-access",
      ghRefreshTokenCiphertext: "v1.enc-refresh",
      keyRef: "SESSION_KEY_V1",
      refreshExpiresAt: input.expiresAt ?? EXPIRY,
    }));
  await forTenant(handle, { installationId: INSTALLATION_ID }).sessions.create({
    sessionTokenHash: input.hash ?? HASH,
    reviewerId: REVIEWER_ID,
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

describe("sessionAuth.findSession", () => {
  let handle: AppDatabase;
  beforeEach(async () => {
    handle = await freshDatabase();
  });

  it("finds a session by its globally-unique hash, JOINed to its grant", async () => {
    const grant = await seedSession(handle, {});
    const resolved = await sessionAuth(handle).findSession(HASH);
    expect(resolved).toBeDefined();
    expect(resolved?.session.sessionTokenHash).toBe(HASH);
    expect(String(resolved?.session.installationId)).toBe(
      String(INSTALLATION_ID),
    );
    expect(String(resolved?.session.reviewerId)).toBe(String(REVIEWER_ID));
    // The credential material rides on the grant half only.
    expect(resolved?.grant.id).toBe(grant.id);
    expect(resolved?.grant.ghTokenCiphertext).toBe("v1.enc-access");
    expect(resolved?.session).not.toHaveProperty("ghTokenCiphertext");
  });

  it("returns undefined for an unknown hash", async () => {
    expect(await sessionAuth(handle).findSession(OTHER_HASH)).toBeUndefined();
  });
});

describe("sessionAuth.deleteSession — last-referent lifecycle", () => {
  let handle: AppDatabase;
  beforeEach(async () => {
    handle = await freshDatabase();
  });

  it("deletes by hash and orphan-cleans the grant in the same transaction", async () => {
    await seedSession(handle, {});
    expect(await grantCount(handle)).toBe(1);
    expect(await sessionAuth(handle).deleteSession(HASH)).toBe(1);
    expect(await sessionAuth(handle).findSession(HASH)).toBeUndefined();
    // Last referent gone → the grant died with it.
    expect(await grantCount(handle)).toBe(0);
    // Idempotent: deleting an already-gone hash is a clean 0.
    expect(await sessionAuth(handle).deleteSession(HASH)).toBe(0);
  });

  it("keeps a grant that another referent still shares", async () => {
    const grant = await seedSession(handle, {});
    await seedSession(handle, { hash: OTHER_HASH, grant });
    expect(await sessionAuth(handle).deleteSession(HASH)).toBe(1);
    // The sibling still holds the grant.
    expect(await grantCount(handle)).toBe(1);
    const resolved = await sessionAuth(handle).findSession(OTHER_HASH);
    expect(resolved?.grant.id).toBe(grant.id);
  });
});

describe("sessionAuth.setExpiresAt", () => {
  let handle: AppDatabase;
  beforeEach(async () => {
    handle = await freshDatabase();
  });

  it("mirrors a rotated refresh-token lifetime onto the session row", async () => {
    await seedSession(handle, {});
    const rotated = new Date("2027-06-01T00:00:00Z");
    expect(await sessionAuth(handle).setExpiresAt(HASH, rotated)).toBe(1);
    const resolved = await sessionAuth(handle).findSession(HASH);
    expect(resolved?.session.expiresAt).toEqual(rotated);
    // Unknown hash is a clean 0, not an error.
    expect(await sessionAuth(handle).setExpiresAt(OTHER_HASH, rotated)).toBe(0);
  });
});

describe("auth_session schema — no credential columns", () => {
  it("the session table carries a grant FK and NO ciphertext columns", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const { fileURLToPath } = await import("node:url");
    const db = drizzle(new PGlite());
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
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
      "installation_id",
      "reviewer_id",
      "reviewer_login",
      "session_token_hash",
    ]);
  });
});
