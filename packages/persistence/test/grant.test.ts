// Grant boundary tests: `createGrantAuth` against real migrations on PGlite.
// Covers create, every branch of the serialized `refreshGrant` CAS, and the
// last-referent lifecycle (`deleteIfOrphaned`; the referent-delete paths live
// in the session and purge suites). A true concurrent race on one
// FOR UPDATE lock is NOT expressible on single-connection PGlite: the
// already-rotated case pins the loser's observable behavior, and the live
// interleaving is exercised against real Postgres.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGrantAuth,
  GrantAuthErrorCodes,
  type GrantRefreshPatch,
  type GrantRefreshRejection,
} from "../src/auth/grant";
import { createSessionAuth } from "../src/auth/session";
import { internal, type AppDatabase } from "../src/db/handle";
import { githubGrant } from "../src/schema/github-grant";
import { isReviewerId, type ReviewerId } from "../src/types";
import type { Result } from "types/utils";
import { brandWith, freshDatabase } from "./helpers";

const REVIEWER: ReviewerId = brandWith(isReviewerId, 777n);
const FUTURE = new Date("2027-01-01T00:00:00Z");
const ROTATED_EXPIRY = new Date("2027-06-01T00:00:00Z");

function createInput() {
  return {
    ghTokenCiphertext: "v1.enc-access",
    ghRefreshTokenCiphertext: "v1.enc-refresh",
    keyRef: "SESSION_KEY_V1",
    refreshExpiresAt: FUTURE,
  };
}

const NEVER_CALLED = (): Promise<
  Result<GrantRefreshPatch, GrantRefreshRejection>
> => {
  throw new Error("refresh callback must not be called");
};

describe("createGrantAuth.createGrant / refreshGrant", () => {
  let handle: AppDatabase;
  beforeEach(async () => {
    handle = await freshDatabase();
  });

  it("creates a grant row holding the sealed pair", async () => {
    const grant = await createGrantAuth(handle).createGrant(createInput());
    expect(grant.ghTokenCiphertext).toBe("v1.enc-access");
    expect(grant.ghRefreshTokenCiphertext).toBe("v1.enc-refresh");
    expect(grant.keyRef).toBe("SESSION_KEY_V1");
    expect(grant.refreshExpiresAt).toEqual(FUTURE);
  });

  it("applies the patch and returns the updated row when stale", async () => {
    const auth = createGrantAuth(handle);
    const grant = await auth.createGrant(createInput());
    const patch: GrantRefreshPatch = {
      ghTokenCiphertext: "v1.rotated-access",
      ghRefreshTokenCiphertext: "v1.rotated-refresh",
      keyRef: "SESSION_KEY_V1",
      refreshExpiresAt: ROTATED_EXPIRY,
    };
    const refresh = vi.fn().mockResolvedValue({ ok: true, value: patch });

    const result = await auth.refreshGrant(
      grant.id,
      "v1.enc-access", // matches the stored ciphertext → refresh proceeds
      refresh,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.value.ghTokenCiphertext).toBe("v1.rotated-access");
    expect(result.value.ghRefreshTokenCiphertext).toBe("v1.rotated-refresh");
    expect(result.value.refreshExpiresAt).toEqual(ROTATED_EXPIRY);

    // Persisted, not just returned.
    const rows = await internal(handle)
      .select()
      .from(githubGrant)
      .where(eq(githubGrant.id, grant.id));
    expect(rows[0]?.ghTokenCiphertext).toBe("v1.rotated-access");
    expect(rows[0]?.refreshExpiresAt).toEqual(ROTATED_EXPIRY);
  });

  it("skips the callback when the pair was already rotated under the lock", async () => {
    const auth = createGrantAuth(handle);
    const grant = await auth.createGrant(createInput());

    const result = await auth.refreshGrant(
      grant.id,
      "v1.stale-access-we-had", // ≠ the stored ciphertext → already rotated
      NEVER_CALLED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    // Returned as-is, untouched: the stored (fresh) pair stands.
    expect(result.value.ghTokenCiphertext).toBe("v1.enc-access");
    expect(result.value.refreshExpiresAt).toEqual(FUTURE);
  });

  it("leaves the row untouched and returns REFRESH_REJECTED on rejection", async () => {
    const auth = createGrantAuth(handle);
    const grant = await auth.createGrant(createInput());
    const refresh = vi.fn().mockResolvedValue({
      ok: false,
      error: { reason: "github-refresh-failed" },
    });

    const result = await auth.refreshGrant(grant.id, "v1.enc-access", refresh);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(GrantAuthErrorCodes.REFRESH_REJECTED);

    const rows = await internal(handle)
      .select()
      .from(githubGrant)
      .where(eq(githubGrant.id, grant.id));
    expect(rows[0]?.ghTokenCiphertext).toBe("v1.enc-access");
  });

  it("returns NOT_FOUND for an absent grant id", async () => {
    const auth = createGrantAuth(handle);
    const grant = await auth.createGrant(createInput());
    await auth.deleteIfOrphaned(grant.id);
    const result = await auth.refreshGrant(
      grant.id,
      "v1.enc-access",
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
  let handle: AppDatabase;
  beforeEach(async () => {
    handle = await freshDatabase();
  });

  it("deletes an unreferenced grant on the login compensation path", async () => {
    const auth = createGrantAuth(handle);
    const grant = await auth.createGrant(createInput());
    expect(await auth.deleteIfOrphaned(grant.id)).toBe(1);
    // Idempotent: an already-gone id is a clean 0.
    expect(await auth.deleteIfOrphaned(grant.id)).toBe(0);
  });

  it("is a no-op on a grant that still has a referent", async () => {
    const auth = createGrantAuth(handle);
    const grant = await auth.createGrant(createInput());
    await createSessionAuth(handle).createSession({
      sessionTokenHash: "a".repeat(64),
      reviewerId: REVIEWER,
      reviewerLogin: "octocat",
      grantId: grant.id,
      expiresAt: FUTURE,
    });
    expect(await auth.deleteIfOrphaned(grant.id)).toBe(0);
    // The referent still resolves with its grant.
    const resolved = await createSessionAuth(handle).findSession(
      "a".repeat(64),
    );
    expect(resolved?.grant.id).toBe(grant.id);
  });
});

describe("createGrantAuth.getGrant", () => {
  it("reads a grant by id; absence is a normal undefined", async () => {
    const handle = await freshDatabase();
    const auth = createGrantAuth(handle);
    const grant = await auth.createGrant(createInput());

    const read = await auth.getGrant(grant.id);
    expect(read?.id).toBe(grant.id);
    expect(read?.ghTokenCiphertext).toBe(grant.ghTokenCiphertext);

    await auth.deleteIfOrphaned(grant.id);
    expect(await auth.getGrant(grant.id)).toBeUndefined();
  });
});
