// Grant boundary tests: `createGrantAuth` against real migrations on PGlite.
// Covers create, every branch of the serialized `refreshGrant` CAS, and the
// last-referent lifecycle (`deleteIfOrphaned`; the referent-delete paths live
// in the session and purge suites). A true concurrent race on one
// FOR UPDATE lock is NOT expressible on single-connection PGlite: the
// already-rotated case pins the loser's observable behavior, and the live
// interleaving is exercised against real Postgres.
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CryptoErrorCodes,
  createEnvKeyProvider,
  decryptToken,
} from "../src/auth/crypto";
import {
  createGrantAuth,
  GrantAuthErrorCodes,
  type GithubGrantRow,
  type GrantAuth,
  type GrantCreateInput,
  type GrantRefreshPatch,
  type GrantRefreshRejection,
} from "../src/auth/grant";
import { GrantSealedColumns } from "../src/auth/types";
import { createSessionAuth } from "../src/auth/session";
import { createTokenAuth } from "../src/auth/token";
import { internal } from "../src/db/handle";
import { githubGrant } from "../src/schema/github-grant";
import { isReviewerId, type GrantRowId, type ReviewerId } from "../src/types";
import type { Result } from "types/utils";
import { AccessLevels } from "types/access-levels";
import { brandWith, registerSharedPglite } from "./helpers";

const shared = registerSharedPglite();

const REVIEWER: ReviewerId = brandWith(isReviewerId, 777n);
const FUTURE = new Date("2027-01-01T00:00:00Z");
const ROTATED_EXPIRY = new Date("2027-06-01T00:00:00Z");

const KEY_REF = "SESSION_KEY_V1";
const KEY_PROVIDER = createEnvKeyProvider({
  [KEY_REF]: randomBytes(32).toString("base64"),
});
const ACCESS_TOKEN = "ghu_access";
const REFRESH_TOKEN = "ghr_refresh";

function createInput(): GrantCreateInput {
  return {
    userId: REVIEWER,
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    keyProvider: KEY_PROVIDER,
    keyRef: KEY_REF,
    refreshExpiresAt: FUTURE,
  };
}

async function makeGrant(auth: GrantAuth): Promise<GithubGrantRow> {
  const created = await auth.createGrant(createInput());
  if (!created.ok) {
    throw new Error(`setup: createGrant failed (${created.error.code})`);
  }
  return created.value;
}

const NEVER_CALLED = (): Promise<
  Result<GrantRefreshPatch, GrantRefreshRejection>
> => {
  throw new Error("refresh callback must not be called");
};

describe("createGrantAuth.createGrant / refreshGrant", () => {
  it("creates a grant row holding the sealed pair", async () => {
    const grant = await makeGrant(createGrantAuth(shared.handle));
    expect(grant.ghTokenCiphertext.startsWith("v2.")).toBe(true);
    expect(grant.ghRefreshTokenCiphertext.startsWith("v2.")).toBe(true);
    expect(grant.ghTokenCiphertext).not.toContain(ACCESS_TOKEN);
    expect(grant.keyRef).toBe(KEY_REF);
    expect(grant.refreshExpiresAt).toEqual(FUTURE);
  });

  it("seals each token to the new row's own id and column", async () => {
    const grant = await makeGrant(createGrantAuth(shared.handle));

    const access = await decryptToken(
      KEY_PROVIDER,
      grant.keyRef,
      grant.ghTokenCiphertext,
      { grantId: grant.id, column: GrantSealedColumns.ACCESS_TOKEN },
    );
    const refresh = await decryptToken(
      KEY_PROVIDER,
      grant.keyRef,
      grant.ghRefreshTokenCiphertext,
      { grantId: grant.id, column: GrantSealedColumns.REFRESH_TOKEN },
    );
    expect(access).toEqual({ ok: true, value: ACCESS_TOKEN });
    expect(refresh).toEqual({ ok: true, value: REFRESH_TOKEN });
  });

  it("inserts nothing when the key cannot be resolved", async () => {
    const auth = createGrantAuth(shared.handle);
    const created = await auth.createGrant({
      ...createInput(),
      keyProvider: createEnvKeyProvider({}),
    });

    expect(created.ok).toBe(false);
    if (created.ok) {
      throw new Error("unreachable");
    }
    expect(created.error.code).toBe(CryptoErrorCodes.KEY_UNAVAILABLE);
    const rows = await internal(shared.handle).select().from(githubGrant);
    expect(rows).toEqual([]);
  });

  it("stores the GitHub user the grant belongs to", async () => {
    const auth = createGrantAuth(shared.handle);
    const grant = await makeGrant(auth);

    const read = await auth.getGrant(grant.id);
    expect(read?.userId).toBe(777n);
  });

  it("applies the patch and returns the updated row when stale", async () => {
    const auth = createGrantAuth(shared.handle);
    const grant = await makeGrant(auth);
    const patch: GrantRefreshPatch = {
      ghTokenCiphertext: "v2.rotated-access",
      ghRefreshTokenCiphertext: "v2.rotated-refresh",
      keyRef: KEY_REF,
      refreshExpiresAt: ROTATED_EXPIRY,
    };
    const refresh = vi.fn().mockResolvedValue({ ok: true, value: patch });

    const result = await auth.refreshGrant(
      grant.id,
      grant.ghTokenCiphertext, // matches the stored ciphertext → refresh proceeds
      refresh,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.value.ghTokenCiphertext).toBe("v2.rotated-access");
    expect(result.value.ghRefreshTokenCiphertext).toBe("v2.rotated-refresh");
    expect(result.value.refreshExpiresAt).toEqual(ROTATED_EXPIRY);

    // Persisted, not just returned.
    const rows = await internal(shared.handle)
      .select()
      .from(githubGrant)
      .where(eq(githubGrant.id, grant.id));
    expect(rows[0]?.ghTokenCiphertext).toBe("v2.rotated-access");
    expect(rows[0]?.refreshExpiresAt).toEqual(ROTATED_EXPIRY);
  });

  it("skips the callback when the pair was already rotated under the lock", async () => {
    const auth = createGrantAuth(shared.handle);
    const grant = await makeGrant(auth);

    const result = await auth.refreshGrant(
      grant.id,
      "v2.stale-access-we-had", // ≠ the stored ciphertext → already rotated
      NEVER_CALLED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    // Returned as-is, untouched: the stored (fresh) pair stands.
    expect(result.value.ghTokenCiphertext).toBe(grant.ghTokenCiphertext);
    expect(result.value.refreshExpiresAt).toEqual(FUTURE);
  });

  it("leaves the row untouched and returns REFRESH_REJECTED on rejection", async () => {
    const auth = createGrantAuth(shared.handle);
    const grant = await makeGrant(auth);
    const refresh = vi.fn().mockResolvedValue({
      ok: false,
      error: { reason: "github-refresh-failed" },
    });

    const result = await auth.refreshGrant(
      grant.id,
      grant.ghTokenCiphertext,
      refresh,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GrantAuthErrorCodes.REFRESH_REJECTED);

    const rows = await internal(shared.handle)
      .select()
      .from(githubGrant)
      .where(eq(githubGrant.id, grant.id));
    expect(rows[0]?.ghTokenCiphertext).toBe(grant.ghTokenCiphertext);
  });

  it("returns NOT_FOUND for an absent grant id", async () => {
    const auth = createGrantAuth(shared.handle);
    const grant = await makeGrant(auth);
    await auth.deleteIfOrphaned(grant.id);
    const result = await auth.refreshGrant(
      grant.id,
      grant.ghTokenCiphertext,
      NEVER_CALLED,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GrantAuthErrorCodes.NOT_FOUND);
  });
});

describe("grant lifecycle: deleteIfOrphaned", () => {
  it("deletes an unreferenced grant on the login compensation path", async () => {
    const auth = createGrantAuth(shared.handle);
    const grant = await makeGrant(auth);
    const orphaned = await auth.deleteIfOrphaned(grant.id);
    expect(orphaned.map((orphan) => orphan.id)).toEqual([grant.id]);
    // Idempotent: an already-gone id deletes nothing.
    expect(await auth.deleteIfOrphaned(grant.id)).toEqual([]);
  });

  it("is a no-op on a grant that still has a referent", async () => {
    const auth = createGrantAuth(shared.handle);
    const grant = await makeGrant(auth);
    await createSessionAuth(shared.handle).createSession({
      sessionTokenHash: "a".repeat(64),
      reviewerId: REVIEWER,
      reviewerLogin: "octocat",
      grantId: grant.id,
      expiresAt: FUTURE,
    });
    expect(await auth.deleteIfOrphaned(grant.id)).toEqual([]);
    // The referent still resolves with its grant.
    const resolved = await createSessionAuth(shared.handle).findSession(
      "a".repeat(64),
    );
    expect(resolved?.grant.id).toBe(grant.id);
  });
});

describe("createGrantAuth.getGrant", () => {
  it("reads a grant by id; absence is a normal undefined", async () => {
    const handle = shared.handle;
    const auth = createGrantAuth(handle);
    const grant = await makeGrant(auth);

    const read = await auth.getGrant(grant.id);
    expect(read?.id).toBe(grant.id);
    expect(read?.ghTokenCiphertext).toBe(grant.ghTokenCiphertext);

    await auth.deleteIfOrphaned(grant.id);
    expect(await auth.getGrant(grant.id)).toBeUndefined();
  });
});

const RETIRED_AT = new Date("2026-10-23T12:00:00Z");
const EARLIER_REVOKE = new Date("2026-10-01T00:00:00Z");

async function makeSession(grantId: GrantRowId, hashChar: string) {
  await createSessionAuth(shared.handle).createSession({
    sessionTokenHash: hashChar.repeat(64),
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    grantId,
    expiresAt: FUTURE,
  });
  return hashChar.repeat(64);
}

async function makeToken(grantId: GrantRowId, name: string) {
  return createTokenAuth(shared.handle).mintToken({
    userId: REVIEWER,
    name,
    scope: AccessLevels.EXTERNAL_WRITE,
    tokenHash: name.padEnd(64, "0"),
    grantId,
    expiresAt: FUTURE,
  });
}

async function readTokenRevokedAt(name: string): Promise<Date | null> {
  const tokens = await createTokenAuth(shared.handle).listForUser(REVIEWER);
  const token = tokens.find((row) => row.name === name);
  if (token === undefined) {
    throw new Error(`token ${name} not found`);
  }
  return token.revokedAt;
}

describe("createGrantAuth.retireGrant", () => {
  it("deletes the grant's sessions and leaves another grant's session", async () => {
    const auth = createGrantAuth(shared.handle);
    const dead = await makeGrant(auth);
    const live = await makeGrant(auth);
    const deadHash = await makeSession(dead.id, "b");
    const liveHash = await makeSession(live.id, "c");

    const retired = await auth.retireGrant(dead.id, RETIRED_AT);

    expect(retired.sessionsDeleted).toBe(1);
    const sessions = createSessionAuth(shared.handle);
    expect(await sessions.findSession(deadHash)).toBeUndefined();
    expect((await sessions.findSession(liveHash))?.grant.id).toBe(live.id);
  });

  it("revokes only the grant's live tokens and keeps an earlier revoke", async () => {
    const auth = createGrantAuth(shared.handle);
    const dead = await makeGrant(auth);
    const live = await makeGrant(auth);
    await makeToken(dead.id, "dead-live");
    const alreadyRevoked = await makeToken(dead.id, "dead-revoked");
    await createTokenAuth(shared.handle).revokeToken(
      REVIEWER,
      alreadyRevoked.id,
      EARLIER_REVOKE,
    );
    await makeToken(live.id, "other-grant");

    const retired = await auth.retireGrant(dead.id, RETIRED_AT);

    expect(retired.tokensRevoked).toBe(1);
    expect(await readTokenRevokedAt("dead-live")).toEqual(RETIRED_AT);
    expect(await readTokenRevokedAt("dead-revoked")).toEqual(EARLIER_REVOKE);
    expect(await readTokenRevokedAt("other-grant")).toBeNull();
  });

  it("deletes a grant that only sessions referenced", async () => {
    const auth = createGrantAuth(shared.handle);
    const grant = await makeGrant(auth);
    await makeSession(grant.id, "d");

    await auth.retireGrant(grant.id, RETIRED_AT);

    expect(await auth.getGrant(grant.id)).toBeUndefined();
  });

  it("keeps a grant its revoked tokens still reference", async () => {
    const auth = createGrantAuth(shared.handle);
    const grant = await makeGrant(auth);
    await makeSession(grant.id, "e");
    await makeToken(grant.id, "kept-row");

    await auth.retireGrant(grant.id, RETIRED_AT);

    expect((await auth.getGrant(grant.id))?.id).toBe(grant.id);
  });
});
