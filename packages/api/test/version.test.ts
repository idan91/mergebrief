// `GET /api/version` (BRIEF-17 PR 5 — ADR 0029 #8): gated like every /api/*
// surface (its second job is the CLI's cheapest authenticated probe), the
// injected version in the body, no-store, hint-free 401 without auth.
import { createHash, randomBytes } from "node:crypto";
import {
  encryptToken,
  envKeyProvider,
  grantAuth,
  isInstallationId,
  isReviewerId,
  tokenAuth,
  type KeyProvider,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AuthDeps } from "../src/lib";
import { testLogger } from "./logging";

const KEY_REF = "SESSION_KEY_V1";

function brand<T extends bigint>(guard: (v: bigint) => v is T, value: number): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) throw new Error("bad branded id");
  return asBigInt;
}
const CTX: TenantContext = { installationId: brand(isInstallationId, 987654) };

describe("GET /api/version", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = envKeyProvider({ [KEY_REF]: randomBytes(32).toString("base64") });
    const auth: AuthDeps = {
      oauthClientId: "Iv1.test-client-id",
      oauthClientSecret: "test-client-secret",
      keyProvider: kp,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: "https://app.example.test",
      cookieSecure: true,
    };
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth,
      github: {
        fetchPullRequestConversation: async () => {
          throw new Error("conversation port must not be called in this suite");
        },
      },
      serverVersion: "1.2.3-test",
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  it("returns the injected version to a Bearer principal, no-store", async () => {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const sealedAccess = await encryptToken(kp, KEY_REF, "ghu_ACCESS");
    const sealedRefresh = await encryptToken(kp, KEY_REF, "ghr_REFRESH");
    if (!sealedAccess.ok || !sealedRefresh.ok) throw new Error("seed encrypt failed");
    const grant = await grantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await tokenAuth(harness.handle).mintToken({
      installationId: CTX.installationId,
      userId: brand(isReviewerId, 555),
      name: "ci-token",
      tokenHash: createHash("sha256").update(plaintext).digest("hex"),
      grantId: grant.id,
      expiresAt: null,
    });

    const res = await app.request("/api/version", {
      headers: { Authorization: `Bearer ${plaintext}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ version: "1.2.3-test" });
  });

  it("is gated: no auth → hint-free 401", async () => {
    const res = await app.request("/api/version");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
