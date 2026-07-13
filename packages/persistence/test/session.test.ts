// Session-auth seam tests (BRIEF-2 stage 6, D11). Exercises the PRE-TENANT,
// token-hash-keyed resolver against real migrations on PGlite: find/delete by
// hash, and the serialized `refreshSession` transaction in all four branches —
// (a) refresh applies the patch, (b) compare-and-swap short-circuit when the
// seen token ciphertext no longer matches (callback NOT called), (c) caller
// rejection leaves the row untouched, (d)
// absent hash → NOT_FOUND. Rows are seeded through the tenant repository so the
// seam is tested exactly as production writes them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forTenant } from "../src/stores/tenant";
import {
  sessionAuth,
  SessionAuthErrorCode,
  type SessionRefreshPatch,
  type SessionRefreshRejection,
} from "../src/auth/session";
import {
  isInstallationId,
  isReviewerId,
  type InstallationId,
  type Result,
  type ReviewerId,
} from "../src/types";
import { type AppDatabase } from "../src/db/handle";
import { brandWith, freshDatabase } from "./helpers";

const INSTALLATION_ID: InstallationId = brandWith(isInstallationId, 4242n);
const REVIEWER_ID: ReviewerId = brandWith(isReviewerId, 777n);
const HASH = "a".repeat(64); // shape of a sha256 hex digest
const OTHER_HASH = "b".repeat(64);

/** Seed one session row via the tenant repository; returns its expiry. */
async function seedSession(
  handle: AppDatabase,
  input: { hash?: string; expiresAt: Date },
): Promise<void> {
  await forTenant(handle, { installationId: INSTALLATION_ID }).sessions.create({
    sessionTokenHash: input.hash ?? HASH,
    reviewerId: REVIEWER_ID,
    reviewerLogin: "octocat",
    ghTokenCiphertext: "v1.enc-access",
    ghRefreshTokenCiphertext: "v1.enc-refresh",
    keyRef: "SESSION_KEY_V1",
    expiresAt: input.expiresAt,
  });
}

const NEVER_CALLED = (): Promise<
  Result<SessionRefreshPatch, SessionRefreshRejection>
> => {
  throw new Error("refresh callback must not be called");
};

describe("sessionAuth.findSession / deleteSession", () => {
  let handle: AppDatabase;
  beforeEach(async () => {
    handle = await freshDatabase();
  });

  it("finds a session by its globally-unique hash", async () => {
    await seedSession(handle, { expiresAt: new Date("2027-01-01T00:00:00Z") });
    const row = await sessionAuth(handle).findSession(HASH);
    expect(row).toBeDefined();
    expect(row?.sessionTokenHash).toBe(HASH);
    expect(String(row?.installationId)).toBe(String(INSTALLATION_ID));
    expect(String(row?.reviewerId)).toBe(String(REVIEWER_ID));
  });

  it("returns undefined for an unknown hash", async () => {
    expect(await sessionAuth(handle).findSession(OTHER_HASH)).toBeUndefined();
  });

  it("deletes by hash and reports the count", async () => {
    await seedSession(handle, { expiresAt: new Date("2027-01-01T00:00:00Z") });
    expect(await sessionAuth(handle).deleteSession(HASH)).toBe(1);
    expect(await sessionAuth(handle).findSession(HASH)).toBeUndefined();
    // Idempotent: deleting an already-gone hash is a clean 0.
    expect(await sessionAuth(handle).deleteSession(HASH)).toBe(0);
  });
});

describe("sessionAuth.refreshSession", () => {
  let handle: AppDatabase;
  beforeEach(async () => {
    handle = await freshDatabase();
  });

  it("(a) applies the patch and returns the updated row when stale", async () => {
    await seedSession(handle, { expiresAt: new Date("2000-01-01T00:00:00Z") });
    const newExpiry = new Date("2027-06-01T00:00:00Z");
    const patch: SessionRefreshPatch = {
      ghTokenCiphertext: "v1.rotated-access",
      ghRefreshTokenCiphertext: "v1.rotated-refresh",
      keyRef: "SESSION_KEY_V1",
      expiresAt: newExpiry,
    };
    const refresh = vi.fn().mockResolvedValue({ ok: true, value: patch });

    const result = await sessionAuth(handle).refreshSession(
      HASH,
      "v1.enc-access", // matches the stored ciphertext → refresh proceeds
      refresh,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.value.ghTokenCiphertext).toBe("v1.rotated-access");
    expect(result.value.ghRefreshTokenCiphertext).toBe("v1.rotated-refresh");
    expect(result.value.expiresAt).toEqual(newExpiry);

    // Persisted, not just returned.
    const reread = await sessionAuth(handle).findSession(HASH);
    expect(reread?.ghTokenCiphertext).toBe("v1.rotated-access");
    expect(reread?.expiresAt).toEqual(newExpiry);
  });

  it("(b) short-circuits when the token was already rotated under the lock (no callback)", async () => {
    const freshExpiry = new Date("2027-01-01T00:00:00Z");
    await seedSession(handle, { expiresAt: freshExpiry });

    const result = await sessionAuth(handle).refreshSession(
      HASH,
      "v1.stale-access-we-had", // ≠ the stored ciphertext → already rotated
      NEVER_CALLED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // Returned as-is, untouched — the stored (fresh) token stands.
    expect(result.value.ghTokenCiphertext).toBe("v1.enc-access");
    expect(result.value.expiresAt).toEqual(freshExpiry);
  });

  it("(c) leaves the row untouched and returns REFRESH_REJECTED on rejection", async () => {
    await seedSession(handle, { expiresAt: new Date("2000-01-01T00:00:00Z") });
    const refresh = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { reason: "github-refresh-failed" } });

    const result = await sessionAuth(handle).refreshSession(
      HASH,
      "v1.enc-access", // matches stored → refresh attempted (then rejected)
      refresh,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(SessionAuthErrorCode.REFRESH_REJECTED);

    // Untouched: the original ciphertext + expiry survive.
    const reread = await sessionAuth(handle).findSession(HASH);
    expect(reread?.ghTokenCiphertext).toBe("v1.enc-access");
    expect(reread?.expiresAt).toEqual(new Date("2000-01-01T00:00:00Z"));
  });

  it("(d) returns NOT_FOUND for an absent hash", async () => {
    const result = await sessionAuth(handle).refreshSession(
      OTHER_HASH,
      "v1.enc-access",
      NEVER_CALLED,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(SessionAuthErrorCode.NOT_FOUND);
  });
});
