// API-token seam tests (BRIEF-17 PR 1 — ADR 0016 #4 as amended 2026-07-09).
// Exercises the `api_token` schema and the PRE-TENANT, hash-keyed `tokenAuth`
// resolver against real migrations on PGlite, mirroring `session.test.ts`.
//
// The hash-only-storage assertion is structural: the table's exact column set
// is pinned so a plaintext-token column cannot be added silently, and the
// `tokenAuth` surface itself never accepts plaintext (mint takes `tokenHash`).
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { apiToken } from "../src/schema/api-token";

import {
  tokenAuth,
  TokenAuthErrorCode,
  type TokenMintInput,
  type TokenRefreshPatch,
  type TokenRefreshRejection,
} from "../src/token";
import {
  isInstallationId,
  isReviewerId,
  type InstallationId,
  type Result,
  type ReviewerId,
} from "../src/types";
import type { AppDatabase } from "../src/db";
import { brandWith, freshDatabase } from "./helpers";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

type Db = ReturnType<typeof drizzle>;

/** Raw pglite drizzle handle for information_schema introspection. */
async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/** The full column inventory — NO plaintext token column, only the hash. */
const API_TOKEN_COLUMNS = [
  "created_at",
  "expires_at",
  "gh_refresh_token_ciphertext",
  "gh_token_ciphertext",
  "id",
  "installation_id",
  "key_ref",
  "last_used_at",
  "name",
  "revoked_at",
  "token_hash",
  "user_id",
  "user_login",
] as const;

describe("api_token schema", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("stores ONLY the token hash — the exact column set has no plaintext column", async () => {
    const result = await db.execute(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'api_token' order by column_name`,
    );
    const names = result.rows
      .map((row) => row["column_name"])
      .filter((name): name is string => typeof name === "string");
    expect(names).toEqual([...API_TOKEN_COLUMNS]);
  });

  it("rejects two rows with the same token_hash (globally unique)", async () => {
    const tokenHash = "a".repeat(64); // shape of a sha256 hex digest
    await db.execute(sql`
      insert into api_token (installation_id, token_hash, user_id, name, gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref)
      values (4242, ${tokenHash}, 777, 'ci-token', 'ct', 'rct', 'K')
    `);
    let thrown: unknown;
    try {
      await db.execute(sql`
        insert into api_token (installation_id, token_hash, user_id, name, gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref)
        values (9999, ${tokenHash}, 888, 'other', 'ct2', 'rct2', 'K')
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

  it("is NOT FK'd to pull_request — token rows survive a PR-graph purge", async () => {
    const result = await db.execute(sql`
      select count(*)::int as fk_count from information_schema.table_constraints
      where table_schema = 'public' and table_name = 'api_token' and constraint_type = 'FOREIGN KEY'
    `);
    expect(result.rows[0]?.["fk_count"]).toBe(0);
    // The table object is importable and queryable through drizzle.
    expect(await db.select({ id: apiToken.id }).from(apiToken)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// tokenAuth — the PRE-TENANT, hash-keyed resolver (mirrors sessionAuth).
// ---------------------------------------------------------------------------

const INSTALLATION: InstallationId = brandWith(isInstallationId, 4242n);
const OTHER_INSTALLATION: InstallationId = brandWith(isInstallationId, 9999n);
const USER: ReviewerId = brandWith(isReviewerId, 777n);
const OTHER_USER: ReviewerId = brandWith(isReviewerId, 888n);
const HASH = "a".repeat(64); // shape of a sha256 hex digest
const OTHER_HASH = "b".repeat(64);

const NOW = new Date("2026-07-09T12:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date("2026-10-07T00:00:00Z");

function mintInput(overrides: Partial<TokenMintInput> = {}): TokenMintInput {
  return {
    installationId: INSTALLATION,
    userId: USER,
    userLogin: "octocat",
    name: "ci-token",
    tokenHash: HASH,
    ghTokenCiphertext: "v1.enc-access",
    ghRefreshTokenCiphertext: "v1.enc-refresh",
    keyRef: "SESSION_KEY_V1",
    expiresAt: FUTURE,
    ...overrides,
  };
}

const NEVER_CALLED = (): Promise<
  Result<TokenRefreshPatch, TokenRefreshRejection>
> => {
  throw new Error("refresh callback must not be called");
};

describe("tokenAuth mint / resolve / touch", () => {
  let handle: AppDatabase;
  beforeEach(async () => {
    handle = await freshDatabase();
  });

  it("mints a token row and resolves it by hash", async () => {
    const auth = tokenAuth(handle);
    const minted = await auth.mintToken(mintInput());
    expect(String(minted.installationId)).toBe(String(INSTALLATION));
    expect(minted.revokedAt).toBeNull();
    expect(minted.lastUsedAt).toBeNull();

    const resolved = await auth.resolveByHash(HASH, NOW);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("unreachable");
    expect(resolved.value.id).toBe(minted.id);
    expect(resolved.value.name).toBe("ci-token");
  });

  it("settings-facing results carry NO secret-bearing columns (codex R1)", async () => {
    const auth = tokenAuth(handle);
    const minted = await auth.mintToken(mintInput());
    const listed = await auth.listForUser(USER);
    const revoked = await auth.revokeToken(USER, minted.id, NOW);
    if (!revoked.ok) throw new Error("expected revocation");

    for (const row of [minted, listed[0], revoked.value]) {
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty("tokenHash");
      expect(row).not.toHaveProperty("ghTokenCiphertext");
      expect(row).not.toHaveProperty("ghRefreshTokenCiphertext");
      expect(row).not.toHaveProperty("keyRef");
    }
  });

  it("resolves a no-expiry token (expires_at null never expires)", async () => {
    const auth = tokenAuth(handle);
    await auth.mintToken(mintInput({ expiresAt: null }));
    const resolved = await auth.resolveByHash(HASH, new Date("2099-01-01T00:00:00Z"));
    expect(resolved.ok).toBe(true);
  });

  it("returns NOT_FOUND for an unknown hash", async () => {
    const resolved = await tokenAuth(handle).resolveByHash(OTHER_HASH, NOW);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("unreachable");
    expect(resolved.error.code).toBe(TokenAuthErrorCode.NOT_FOUND);
  });

  it("returns EXPIRED for a token past its expiry", async () => {
    const auth = tokenAuth(handle);
    await auth.mintToken(mintInput({ expiresAt: PAST }));
    const resolved = await auth.resolveByHash(HASH, NOW);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("unreachable");
    expect(resolved.error.code).toBe(TokenAuthErrorCode.EXPIRED);
  });

  it("touches last_used_at by hash", async () => {
    const auth = tokenAuth(handle);
    await auth.mintToken(mintInput());
    expect(await auth.touchLastUsed(HASH, NOW)).toBe(1);
    const resolved = await auth.resolveByHash(HASH, NOW);
    if (!resolved.ok) throw new Error("expected resolution");
    expect(resolved.value.lastUsedAt).toEqual(NOW);
    // Unknown hash is a clean 0, not an error.
    expect(await auth.touchLastUsed(OTHER_HASH, NOW)).toBe(0);
  });
});

describe("tokenAuth list / revoke", () => {
  let handle: AppDatabase;
  beforeEach(async () => {
    handle = await freshDatabase();
  });

  it("lists a user's tokens across installations, not other users'", async () => {
    const auth = tokenAuth(handle);
    await auth.mintToken(mintInput());
    await auth.mintToken(
      mintInput({
        tokenHash: OTHER_HASH,
        name: "other-org",
        installationId: OTHER_INSTALLATION,
      }),
    );
    await auth.mintToken(
      mintInput({ tokenHash: "c".repeat(64), userId: OTHER_USER, name: "not-mine" }),
    );

    const mine = await auth.listForUser(USER);
    expect(mine.map((row) => row.name).toSorted()).toEqual(["ci-token", "other-org"]);
    expect(await auth.listForUser(OTHER_USER)).toHaveLength(1);
  });

  it("revokes an owned token; a revoked token stays listable but never resolves", async () => {
    const auth = tokenAuth(handle);
    const minted = await auth.mintToken(mintInput());

    const revoked = await auth.revokeToken(USER, minted.id, NOW);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) throw new Error("unreachable");
    expect(revoked.value.revokedAt).toEqual(NOW);

    const resolved = await auth.resolveByHash(HASH, NOW);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("unreachable");
    expect(resolved.error.code).toBe(TokenAuthErrorCode.REVOKED);

    // Still listable (the settings list stays honest after revocation).
    const listed = await auth.listForUser(USER);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.revokedAt).toEqual(NOW);
  });

  it("revocation is idempotent — the original revoked_at is preserved", async () => {
    const auth = tokenAuth(handle);
    const minted = await auth.mintToken(mintInput());
    await auth.revokeToken(USER, minted.id, PAST);
    const again = await auth.revokeToken(USER, minted.id, NOW);
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error("unreachable");
    expect(again.value.revokedAt).toEqual(PAST);
  });

  it("returns NOT_FOUND revoking a token the user does not own", async () => {
    const auth = tokenAuth(handle);
    const minted = await auth.mintToken(mintInput());
    const result = await auth.revokeToken(OTHER_USER, minted.id, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(TokenAuthErrorCode.NOT_FOUND);
    // The row is untouched.
    const resolved = await auth.resolveByHash(HASH, NOW);
    expect(resolved.ok).toBe(true);
  });
});

describe("tokenAuth.refreshToken", () => {
  let handle: AppDatabase;
  beforeEach(async () => {
    handle = await freshDatabase();
  });

  it("(a) applies the patch WITHOUT touching the token's own expiry", async () => {
    const auth = tokenAuth(handle);
    await auth.mintToken(mintInput({ expiresAt: FUTURE }));
    const patch: TokenRefreshPatch = {
      ghTokenCiphertext: "v1.rotated-access",
      ghRefreshTokenCiphertext: "v1.rotated-refresh",
      keyRef: "SESSION_KEY_V1",
    };

    const result = await auth.refreshToken(
      HASH,
      "v1.enc-access", // matches the stored ciphertext → refresh proceeds
      NOW,
      () => Promise.resolve({ ok: true, value: patch }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.ghTokenCiphertext).toBe("v1.rotated-access");
    expect(result.value.ghRefreshTokenCiphertext).toBe("v1.rotated-refresh");
    // The mint-chosen token expiry is independent of GitHub credential
    // rotation — it must never move on refresh.
    expect(result.value.expiresAt).toEqual(FUTURE);

    // Persisted, not just returned.
    const reread = await auth.resolveByHash(HASH, NOW);
    if (!reread.ok) throw new Error("expected resolution");
    expect(reread.value.ghTokenCiphertext).toBe("v1.rotated-access");
  });

  it("(b) short-circuits when the token was already rotated under the lock", async () => {
    const auth = tokenAuth(handle);
    await auth.mintToken(mintInput());
    const result = await auth.refreshToken(
      HASH,
      "v1.stale-access-we-had", // ≠ stored → already rotated by another request
      NOW,
      NEVER_CALLED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.ghTokenCiphertext).toBe("v1.enc-access");
  });

  it("(c) leaves the row untouched and returns REFRESH_REJECTED on rejection", async () => {
    const auth = tokenAuth(handle);
    await auth.mintToken(mintInput());
    const result = await auth.refreshToken(HASH, "v1.enc-access", NOW, () =>
      Promise.resolve({ ok: false, error: { reason: "github-refresh-failed" } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(TokenAuthErrorCode.REFRESH_REJECTED);

    const reread = await auth.resolveByHash(HASH, NOW);
    if (!reread.ok) throw new Error("expected resolution");
    expect(reread.value.ghTokenCiphertext).toBe("v1.enc-access");
  });

  it("(d) returns NOT_FOUND for an absent hash", async () => {
    const result = await tokenAuth(handle).refreshToken(
      OTHER_HASH,
      "v1.enc-access",
      NOW,
      NEVER_CALLED,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(TokenAuthErrorCode.NOT_FOUND);
  });

  it("(e) refuses to rotate credentials of a revoked or expired token", async () => {
    const auth = tokenAuth(handle);
    const minted = await auth.mintToken(mintInput());
    await auth.revokeToken(USER, minted.id, PAST);
    const revoked = await auth.refreshToken(HASH, "v1.enc-access", NOW, NEVER_CALLED);
    expect(revoked.ok).toBe(false);
    if (revoked.ok) throw new Error("unreachable");
    expect(revoked.error.code).toBe(TokenAuthErrorCode.REVOKED);

    await auth.mintToken(mintInput({ tokenHash: OTHER_HASH, expiresAt: PAST }));
    const expired = await auth.refreshToken(OTHER_HASH, "v1.enc-access", NOW, NEVER_CALLED);
    expect(expired.ok).toBe(false);
    if (expired.ok) throw new Error("unreachable");
    expect(expired.error.code).toBe(TokenAuthErrorCode.EXPIRED);
  });
});

describe("tokenAuth.mintToken audit atomicity (codex PR2 R1)", () => {
  it("mint emits its D9 auth audit row in the same transaction", async () => {
    const handle = await freshDatabase();
    await tokenAuth(handle).mintToken(mintInput());
    const { internal } = await import("../src/db");
    const { auditLog } = await import("../src/schema/audit-log");
    const rows = await internal(handle).select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("auth");
    expect(rows[0]?.targetType).toBe("api_token");
    expect(rows[0]?.metadata).toEqual({ decision: "200", kind: "mint" });
    expect(String(rows[0]?.installationId)).toBe(String(INSTALLATION));
    expect(String(rows[0]?.actorId)).toBe(String(USER));
  });
});
