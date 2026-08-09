// user_settings tests (PGlite). Prove the NON-tenant boundary: a row
// keyed by GitHub user id, readable/writable WITHOUT a tenant ctx, that
// survives session deletion (the whole point — a default that outlives any one
// session). Idempotent upsert of the default installation.
import { describe, expect, it } from "vitest";
import {
  forTenant,
  grantAuth,
  userSettingsStore,
  type InstallationId,
  type ReviewerId,
} from "../src/index";
import { isInstallationId, isReviewerId } from "../src/types";
import { brandWith, freshDatabase } from "./helpers";

const USER: ReviewerId = brandWith(isReviewerId, 31337n);
const INSTALL_A: InstallationId = brandWith(isInstallationId, 1000n);
const INSTALL_B: InstallationId = brandWith(isInstallationId, 2000n);

describe("userSettingsStore — the non-tenant per-user seam", () => {
  it("get returns undefined for a user with no settings row", async () => {
    const handle = await freshDatabase();
    expect(await userSettingsStore(handle).get(USER)).toBeUndefined();
  });

  it("setDefaultInstallation upserts, then updates in place (idempotent, keyed by user)", async () => {
    const handle = await freshDatabase();
    const store = userSettingsStore(handle);

    const first = await store.setDefaultInstallation(USER, INSTALL_A);
    expect(first.ghUserId).toBe(USER);
    expect(first.defaultInstallationId).toBe(INSTALL_A);

    const second = await store.setDefaultInstallation(USER, INSTALL_B);
    // Same PK → one row, updated in place.
    expect(second.ghUserId).toBe(USER);
    expect(second.defaultInstallationId).toBe(INSTALL_B);
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(
      first.updatedAt.getTime(),
    );

    expect((await store.get(USER))?.defaultInstallationId).toBe(INSTALL_B);
  });

  it("settings survive session deletion (default outlives the session)", async () => {
    const handle = await freshDatabase();
    const store = userSettingsStore(handle);

    // A session under installation A carrying this reviewer.
    const grant = await grantAuth(handle).createGrant({
      ghTokenCiphertext: "cipher",
      ghRefreshTokenCiphertext: "refresh-cipher",
      keyRef: "env:K1",
      refreshExpiresAt: new Date(Date.now() + 3_600_000),
    });
    await forTenant(handle, { installationId: INSTALL_A }).sessions.create({
      sessionTokenHash: "hash-x",
      reviewerId: USER,
      grantId: grant.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await store.setDefaultInstallation(USER, INSTALL_A);

    // Delete every session for the reviewer (logout / offboarding).
    expect(
      await forTenant(handle, {
        installationId: INSTALL_A,
      }).sessions.deleteByReviewer(USER),
    ).toBe(1);

    // The settings row is untouched — no FK, no tenant scope.
    expect((await store.get(USER))?.defaultInstallationId).toBe(INSTALL_A);
  });

  it("is not tenant-scoped: the same user id resolves one row regardless of installation", async () => {
    const handle = await freshDatabase();
    const store = userSettingsStore(handle);
    await store.setDefaultInstallation(USER, INSTALL_B);
    // No ctx anywhere in this call — the row is addressed purely by user id.
    expect((await store.get(USER))?.defaultInstallationId).toBe(INSTALL_B);
  });
});
