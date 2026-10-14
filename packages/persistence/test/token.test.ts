// API-token boundary tests against real migrations on PGlite, mirroring
// `session.test.ts`; credential rotation lives in grant.test.ts. The
// hash-only-storage assertion is structural: the exact column set is pinned
// so a plaintext or ciphertext column cannot be added silently.
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { apiToken } from "../src/schema/api-token";

import { createGrantAuth, type GithubGrantRow } from "../src/auth/grant";
import {
  createTokenAuth,
  TokenAuthErrorCodes,
  type TokenMintInput,
} from "../src/auth/token";
import { isReviewerId, type ReviewerId } from "../src/types";
import type { AppDatabase } from "../src/db/handle";
import { brandWith, freshDatabase } from "./helpers";
import { AccessLevels } from "types/access-levels";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

type Db = ReturnType<typeof drizzle>;

/** Raw pglite drizzle handle for information_schema introspection. */
async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

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
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("stores only the token hash, no credential column exists", async () => {
    const result = await db.execute(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'api_token' order by column_name`,
    );
    const names = result.rows
      .map((row) => row["column_name"])
      .filter((name): name is string => typeof name === "string");
    expect(names).toEqual([...API_TOKEN_COLUMNS]);
  });

  it("rejects two rows with the same token_hash", async () => {
    const tokenHash = "a".repeat(64); // shape of a sha256 hex digest
    await db.execute(sql`
      insert into github_grant (gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref, refresh_expires_at)
      values ('ct', 'rct', 'K', now() + interval '6 months')
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

const NOW = new Date("2026-07-09T12:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date("2026-10-07T00:00:00Z");

async function seedGrant(handle: AppDatabase): Promise<GithubGrantRow> {
  return createGrantAuth(handle).createGrant({
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
    handle = await freshDatabase();
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
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      throw new Error("unreachable");
    }
    expect(resolved.value.token.id).toBe(minted.id);
    expect(resolved.value.token.name).toBe("ci-token");
    // The credential material rides on the grant half. LINKED, not copied.
    expect(resolved.value.grant.id).toBe(grant.id);
    expect(resolved.value.grant.ghTokenCiphertext).toBe("v1.enc-access");
    expect(resolved.value.token).not.toHaveProperty("ghTokenCiphertext");
  });

  it("settings-facing results carry NO secret-bearing columns", async () => {
    const auth = createTokenAuth(handle);
    const minted = await auth.mintToken(mintInput(grant));
    const listed = await auth.listForUser(USER);
    const revoked = await auth.revokeToken(USER, minted.id, NOW);
    if (!revoked.ok) {
      throw new Error("expected revocation");
    }

    for (const row of [minted, listed[0], revoked.value]) {
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
    expect(resolved.ok).toBe(true);
  });

  it("returns NOT_FOUND for an unknown hash", async () => {
    const resolved = await createTokenAuth(handle).resolveByHash(
      OTHER_HASH,
      NOW,
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      throw new Error("unreachable");
    }
    expect(resolved.error.code).toBe(TokenAuthErrorCodes.NOT_FOUND);
  });

  it("returns EXPIRED for a token past its expiry", async () => {
    const auth = createTokenAuth(handle);
    await auth.mintToken(mintInput(grant, { expiresAt: PAST }));
    const resolved = await auth.resolveByHash(HASH, NOW);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      throw new Error("unreachable");
    }
    expect(resolved.error.code).toBe(TokenAuthErrorCodes.EXPIRED);
  });

  it("touches last_used_at by hash", async () => {
    const auth = createTokenAuth(handle);
    await auth.mintToken(mintInput(grant));
    expect(await auth.touchLastUsed(HASH, NOW)).toBe(1);
    const resolved = await auth.resolveByHash(HASH, NOW);
    if (!resolved.ok) {
      throw new Error("expected resolution");
    }
    expect(resolved.value.token.lastUsedAt).toEqual(NOW);
    // Unknown hash is a clean 0, not an error.
    expect(await auth.touchLastUsed(OTHER_HASH, NOW)).toBe(0);
  });
});

describe("createTokenAuth list / revoke", () => {
  let handle: AppDatabase;
  let grant: GithubGrantRow;
  beforeEach(async () => {
    handle = await freshDatabase();
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
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) {
      throw new Error("unreachable");
    }
    expect(revoked.value.revokedAt).toEqual(NOW);

    const resolved = await auth.resolveByHash(HASH, NOW);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      throw new Error("unreachable");
    }
    expect(resolved.error.code).toBe(TokenAuthErrorCodes.REVOKED);

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
    expect(again.ok).toBe(true);
    if (!again.ok) {
      throw new Error("unreachable");
    }
    expect(again.value.revokedAt).toEqual(PAST);
  });

  it("returns NOT_FOUND revoking a token the user does not own", async () => {
    const auth = createTokenAuth(handle);
    const minted = await auth.mintToken(mintInput(grant));
    const result = await auth.revokeToken(OTHER_USER, minted.id, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(TokenAuthErrorCodes.NOT_FOUND);
    // The row is untouched.
    const resolved = await auth.resolveByHash(HASH, NOW);
    expect(resolved.ok).toBe(true);
  });
});

describe("createTokenAuth.mintToken audit atomicity", () => {
  it("mint emits its issuance audit row in the same transaction", async () => {
    const handle = await freshDatabase();
    const grant = await seedGrant(handle);
    await createTokenAuth(handle).mintToken(mintInput(grant));
    const { internal } = await import("../src/db/handle");
    const { auditLog } = await import("../src/schema/audit-log");
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
});
