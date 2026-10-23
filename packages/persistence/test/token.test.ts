// API-token boundary tests against real migrations on PGlite, mirroring
// `session.test.ts`; credential rotation lives in grant.test.ts. The
// hash-only-storage assertion is structural: the exact column set is pinned
// so a plaintext or ciphertext column cannot be added silently.
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { apiToken } from "../src/schema/api-token";
import { auditLog } from "../src/schema/audit-log";

import { createGrantAuth, type GithubGrantRow } from "../src/auth/grant";
import { createSessionAuth } from "../src/auth/session";
import { createTokenAuth, type TokenMintInput } from "../src/auth/token";
import { TokenMintErrorCodes } from "../src/auth/types";
import { isReviewerId, type ReviewerId } from "../src/types";
import { internal, type AppDatabase } from "../src/db/handle";
import {
  brandWith,
  expectCheckViolation,
  freshDatabase,
  registerSharedPglite,
} from "./helpers";
import { AccessLevels } from "types/access-levels";

const shared = registerSharedPglite();

/** The full column inventory, hash + grant FK, NO plaintext or ciphertext. */
const API_TOKEN_COLUMNS = [
  "created_at",
  "expires_at",
  "grant_id",
  "id",
  "last_used_at",
  "name",
  "revoked_at",
  "scope",
  "token_hash",
  "user_id",
  "user_login",
] as const;

describe("api_token schema", () => {
  it("stores only the token hash, no credential column exists", async () => {
    const db = shared.db;
    const result = await db.execute(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'api_token' order by column_name`,
    );
    const names = result.rows
      .map((row) => row["column_name"])
      .filter((name): name is string => typeof name === "string");
    expect(names).toEqual([...API_TOKEN_COLUMNS]);
  });

  it("rejects two rows with the same token_hash", async () => {
    const db = shared.db;
    const tokenHash = "a".repeat(64); // shape of a sha256 hex digest
    await db.execute(sql`
      insert into github_grant (user_id, gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref, refresh_expires_at)
      values (777, 'ct', 'rct', 'K', now() + interval '6 months')
    `);
    await db.execute(sql`
      insert into api_token (token_hash, user_id, name, scope, grant_id)
      values (${tokenHash}, 777, 'ci-token', 'external-write', (select id from github_grant limit 1))
    `);
    let thrown: unknown;
    try {
      await db.execute(sql`
        insert into api_token (token_hash, user_id, name, scope, grant_id)
        values (${tokenHash}, 888, 'other', 'external-write', (select id from github_grant limit 1))
      `);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    let found = false;
    let current: unknown = thrown;
    while (current instanceof Error) {
      if (current.message.includes("api_token_token_hash_unique")) {
        found = true;
        break;
      }
      current = current.cause;
    }
    expect(found).toBe(true);
  });

  it("carries one FK, the grant reference, and none to pull_request", async () => {
    const db = shared.db;
    const result = await db.execute(sql`
      select ccu.table_name as target from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.table_schema = 'public' and tc.table_name = 'api_token' and tc.constraint_type = 'FOREIGN KEY'
    `);
    expect(result.rows.map((row) => row["target"])).toEqual(["github_grant"]);
    // The table object is importable and queryable through drizzle.
    expect(await db.select({ id: apiToken.id }).from(apiToken)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createTokenAuth, the PRE-TENANT, hash-keyed resolver (mirrors createSessionAuth).
// ---------------------------------------------------------------------------

const USER: ReviewerId = brandWith(isReviewerId, 777n);
const OTHER_USER: ReviewerId = brandWith(isReviewerId, 888n);
const HASH = "a".repeat(64); // shape of a sha256 hex digest
const OTHER_HASH = "b".repeat(64);
const THIRD_HASH = "c".repeat(64);

const NOW = new Date("2026-07-09T12:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date("2026-10-07T00:00:00Z");
const SESSION_EXPIRES_AT = new Date("2027-06-01T00:00:00Z");

async function seedGrant(handle: AppDatabase): Promise<GithubGrantRow> {
  return createGrantAuth(handle).createGrant({
    userId: USER,
    ghTokenCiphertext: "v1.enc-access",
    ghRefreshTokenCiphertext: "v1.enc-refresh",
    keyRef: "SESSION_KEY_V1",
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
}

function mintInput(
  grant: GithubGrantRow,
  overrides: Partial<TokenMintInput> = {},
): TokenMintInput {
  return {
    userId: USER,
    userLogin: "octocat",
    name: "ci-token",
    scope: AccessLevels.EXTERNAL_WRITE,
    tokenHash: HASH,
    grantId: grant.id,
    expiresAt: FUTURE,
    ...overrides,
  };
}

describe("createTokenAuth mint / resolve / touch", () => {
  let handle: AppDatabase;
  let grant: GithubGrantRow;
  beforeEach(async () => {
    handle = shared.handle;
    grant = await seedGrant(handle);
  });

  it("mints a token row linking the grant and resolves it by hash", async () => {
    const auth = createTokenAuth(handle);
    const minted = await auth.mintToken(mintInput(grant));
    expect(minted.revokedAt).toBeNull();
    expect(minted.lastUsedAt).toBeNull();
    // Chosen at mint, and on the metadata projection the settings list reads.
    expect(minted.scope).toBe(AccessLevels.EXTERNAL_WRITE);

    const resolved = await auth.resolveByHash(HASH, NOW);
    expect(resolved?.token.id).toBe(minted.id);
    expect(resolved?.token.name).toBe("ci-token");
    // The credential material rides on the grant half. LINKED, not copied.
    expect(resolved?.grant.id).toBe(grant.id);
    expect(resolved?.grant.ghTokenCiphertext).toBe("v1.enc-access");
    expect(resolved?.token).not.toHaveProperty("ghTokenCiphertext");
  });

  it("settings-facing results carry NO secret-bearing columns", async () => {
    const auth = createTokenAuth(handle);
    const minted = await auth.mintToken(mintInput(grant));
    const listed = await auth.listForUser(USER);
    const revoked = await auth.revokeToken(USER, minted.id, NOW);

    for (const row of [minted, listed[0], revoked?.token]) {
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty("tokenHash");
      expect(row).not.toHaveProperty("grantId");
      expect(row).not.toHaveProperty("ghTokenCiphertext");
      expect(row).not.toHaveProperty("ghRefreshTokenCiphertext");
      expect(row).not.toHaveProperty("keyRef");
    }
  });

  it("resolves a no-expiry token, a null expires_at never expires", async () => {
    const auth = createTokenAuth(handle);
    await auth.mintToken(mintInput(grant, { expiresAt: null }));
    const resolved = await auth.resolveByHash(
      HASH,
      new Date("2099-01-01T00:00:00Z"),
    );
    expect(resolved).toBeDefined();
  });

  it("resolves nothing for an unknown hash", async () => {
    const resolved = await createTokenAuth(handle).resolveByHash(
      OTHER_HASH,
      NOW,
    );
    expect(resolved).toBeUndefined();
  });

  it("resolves nothing for a token past its expiry", async () => {
    const auth = createTokenAuth(handle);
    await auth.mintToken(mintInput(grant, { expiresAt: PAST }));
    expect(await auth.resolveByHash(HASH, NOW)).toBeUndefined();
  });

  it("resolves nothing for a token that expires at this instant", async () => {
    const auth = createTokenAuth(handle);
    await auth.mintToken(mintInput(grant, { expiresAt: NOW }));
    expect(await auth.resolveByHash(HASH, NOW)).toBeUndefined();
  });

  it("touches last_used_at by hash", async () => {
    const auth = createTokenAuth(handle);
    await auth.mintToken(mintInput(grant));
    expect(await auth.touchLastUsed(HASH, NOW)).toBe(1);
    const resolved = await auth.resolveByHash(HASH, NOW);
    expect(resolved?.token.lastUsedAt).toEqual(NOW);
    // Unknown hash is a clean 0, not an error.
    expect(await auth.touchLastUsed(OTHER_HASH, NOW)).toBe(0);
  });
});

describe("createTokenAuth.mintTokenFromSession", () => {
  let handle: AppDatabase;
  let grant: GithubGrantRow;
  beforeEach(async () => {
    handle = shared.handle;
    grant = await seedGrant(handle);
    await createSessionAuth(handle).createSession({
      sessionTokenHash: OTHER_HASH,
      reviewerId: USER,
      reviewerLogin: "octocat",
      grantId: grant.id,
      expiresAt: SESSION_EXPIRES_AT,
    });
  });

  it("mints on the live session's grant", async () => {
    const minted = await createTokenAuth(handle).mintTokenFromSession(
      OTHER_HASH,
      mintInput(grant),
    );

    expect(minted.ok).toBe(true);
    expect(
      await createTokenAuth(handle).resolveByHash(HASH, NOW),
    ).toBeDefined();
  });

  it("refuses a mint whose session a logout already deleted", async () => {
    const tokens = createTokenAuth(handle);
    const revoked = await tokens.mintToken(
      mintInput(grant, { tokenHash: THIRD_HASH }),
    );
    await tokens.revokeToken(USER, revoked.id, NOW);
    await createSessionAuth(handle).deleteSession(OTHER_HASH);

    const minted = await createTokenAuth(handle).mintTokenFromSession(
      OTHER_HASH,
      mintInput(grant),
    );

    expect(minted.ok ? undefined : minted.error.code).toBe(
      TokenMintErrorCodes.SESSION_GONE,
    );
    expect(await tokens.resolveByHash(HASH, NOW)).toBeUndefined();
    expect(await tokens.listForUser(USER)).toHaveLength(1);
  });
});

describe("createTokenAuth list / revoke", () => {
  let handle: AppDatabase;
  let grant: GithubGrantRow;
  beforeEach(async () => {
    handle = shared.handle;
    grant = await seedGrant(handle);
  });

  it("lists a user's tokens, not other users'", async () => {
    const auth = createTokenAuth(handle);
    await auth.mintToken(mintInput(grant));
    await auth.mintToken(
      mintInput(grant, {
        tokenHash: OTHER_HASH,
        name: "other-org",
      }),
    );
    await auth.mintToken(
      mintInput(grant, {
        tokenHash: "c".repeat(64),
        userId: OTHER_USER,
        name: "not-mine",
      }),
    );

    const mine = await auth.listForUser(USER);
    expect(mine.map((row) => row.name).toSorted()).toEqual([
      "ci-token",
      "other-org",
    ]);
    expect(await auth.listForUser(OTHER_USER)).toHaveLength(1);
  });

  it("revokes an owned token that stays listable but never resolves", async () => {
    const auth = createTokenAuth(handle);
    const minted = await auth.mintToken(mintInput(grant));

    const revoked = await auth.revokeToken(USER, minted.id, NOW);
    expect(revoked?.token.revokedAt).toEqual(NOW);

    expect(await auth.resolveByHash(HASH, NOW)).toBeUndefined();

    // Still listable (the settings list stays honest after revocation), and
    // the soft revoke KEEPS the grant reference, only hard deletes
    // orphan-clean.
    const listed = await auth.listForUser(USER);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.revokedAt).toEqual(NOW);
  });

  it("revocation is idempotent, the original revoked_at is preserved", async () => {
    const auth = createTokenAuth(handle);
    const minted = await auth.mintToken(mintInput(grant));
    await auth.revokeToken(USER, minted.id, PAST);
    const again = await auth.revokeToken(USER, minted.id, NOW);
    expect(again?.token.revokedAt).toEqual(PAST);
    expect(again?.orphanedGrants).toEqual([]);
  });

  it("revoking a grant's last live referent returns the grant", async () => {
    const auth = createTokenAuth(handle);
    const minted = await auth.mintToken(mintInput(grant));

    const revoked = await auth.revokeToken(USER, minted.id, NOW);

    expect(revoked?.orphanedGrants.map((orphan) => orphan.id)).toEqual([
      grant.id,
    ]);
  });

  it("a live browser session keeps the grant through a CLI token revoke", async () => {
    await createSessionAuth(handle).createSession({
      sessionTokenHash: OTHER_HASH,
      reviewerId: USER,
      reviewerLogin: "octocat",
      grantId: grant.id,
      expiresAt: SESSION_EXPIRES_AT,
    });
    const auth = createTokenAuth(handle);
    const minted = await auth.mintToken(mintInput(grant));

    const revoked = await auth.revokeToken(USER, minted.id, NOW);

    expect(revoked?.orphanedGrants).toEqual([]);
    const session = await createSessionAuth(handle).findSession(OTHER_HASH);
    expect(session?.grant.id).toBe(grant.id);
  });

  it("revokes nothing for a token the user does not own", async () => {
    const auth = createTokenAuth(handle);
    const minted = await auth.mintToken(mintInput(grant));
    const result = await auth.revokeToken(OTHER_USER, minted.id, NOW);
    expect(result).toBeUndefined();
    // The row is untouched.
    expect(await auth.resolveByHash(HASH, NOW)).toBeDefined();
  });
});

describe("createTokenAuth.mintToken audit atomicity", () => {
  it("mint emits its issuance audit row with the token's metadata", async () => {
    const handle = shared.handle;
    const grant = await seedGrant(handle);
    await createTokenAuth(handle).mintToken(mintInput(grant));
    const rows = await internal(handle).select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.operation).toBe("issue-api-token");
    expect(rows[0]?.outcome).toBe("ok");
    expect(rows[0]?.targetType).toBe("api_token");
    expect(rows[0]?.metadata).toEqual({ decision: "200", kind: "mint" });
    expect(rows[0]?.installationId).toBeNull();
    expect(rows[0]?.source).toBe("url");
    expect(String(rows[0]?.actorId)).toBe(String(USER));
  });

  it("mint rolls the token back when its audit row fails", async () => {
    const handle = await freshDatabase();
    const grant = await seedGrant(handle);
    await internal(handle).execute(
      sql`alter table audit_log add constraint refuse_issuance check (operation <> 'issue-api-token')`,
    );

    await expectCheckViolation(
      createTokenAuth(handle).mintToken(mintInput(grant)),
      "refuse_issuance",
    );

    const tokens = await internal(handle)
      .select({ id: apiToken.id })
      .from(apiToken);
    expect(tokens).toEqual([]);
  });
});
