// `GET /api/version`: gated like every /api/*
// surface (its second job is the CLI's cheapest authenticated probe), the
// injected version in the body, no-store, hint-free 401 without auth.
import { createHash, randomBytes } from "node:crypto";
import {
  encryptToken,
  createEnvKeyProvider,
  createGrantAuth,
  createTokenAuth,
  WriteClassifications,
  type KeyProvider,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { createUpdateCheck, type UpdateCheck } from "../src/update-check";
import { testLogger } from "./logging";
import { KEY_REF, SAME_ORIGIN_HEADERS, brandReviewerId } from "./fixtures";
import { seedApiToken, seedSession } from "./session/fixtures";

const COOKIE_NAME = "__Host-mergebrief_session";

const MANIFEST = JSON.stringify({
  latest: "1.6.0",
  releaseNotesUrl: "https://example.test/releases/v1.6.0",
  releases: [{ version: "1.6.0", breaking: false, security: false }],
});
const SECURITY_MANIFEST = JSON.stringify({
  latest: "1.6.0",
  releases: [{ version: "1.6.0", breaking: false, security: true }],
});
const PREFIXED_MANIFEST = JSON.stringify({
  latest: "v1.6.0",
  releases: [{ version: "v1.6.0", breaking: false, security: false }],
});
const CHECKED_AT = new Date("2026-10-03T10:00:00Z");

describe("GET /api/version", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;
  let updateCheck: UpdateCheck;
  let manifestBody: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CHECKED_AT);
    harness = await createPgliteHarness();
    manifestBody = MANIFEST;
    updateCheck = createUpdateCheck({
      serverVersion: "1.2.3",
      enabled: true,
      url: "https://releases.example.test/version.json",
      fetch: async () => new Response(manifestBody, { status: 200 }),
      log: testLogger(),
    });
    kp = createEnvKeyProvider({
      [KEY_REF]: randomBytes(32).toString("base64"),
    });
    const auth: AuthDeps = {
      oauthClientId: "Iv1.test-client-id",
      oauthClientSecret: "test-client-secret",
      keyProvider: kp,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: "https://app.example.test",
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
        listRepoCollaborators: async () => {
          throw new Error(
            "collaborators port must not be called in this suite",
          );
        },
        commitAttachment: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
        deleteAttachmentBranch: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
      },
      serverVersion: "1.2.3",
      updateCheck,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await harness.close();
  });

  it("returns the update snapshot to a Bearer principal, no-store", async () => {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const sealedAccess = await encryptToken(kp, KEY_REF, "ghu_ACCESS");
    const sealedRefresh = await encryptToken(kp, KEY_REF, "ghr_REFRESH");
    if (!sealedAccess.ok || !sealedRefresh.ok)
      throw new Error("seed encrypt failed");
    const grant = await createGrantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await createTokenAuth(harness.handle).mintToken({
      scope: WriteClassifications.EXTERNAL_WRITE,
      userId: brandReviewerId(555n),
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
    expect(await res.json()).toEqual({ version: "1.2.3" });

    await updateCheck.refresh();
    const after = await app.request("/api/version", {
      headers: { Authorization: `Bearer ${plaintext}` },
    });
    expect(after.headers.get("cache-control")).toBe("no-store");
    expect(await after.json()).toEqual({
      version: "1.2.3",
      latest: "1.6.0",
      releaseNotesUrl: "https://example.test/releases/v1.6.0",
      checkedAt: CHECKED_AT.toISOString(),
      breaking: false,
      security: false,
    });
  });

  it("is gated: no auth → hint-free 401", async () => {
    const res = await app.request("/api/version");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "unauthorized",
      code: "unauthorized",
    });
  });

  async function dismiss(cookie: string, body: unknown): Promise<Response> {
    return app.request("/api/version/dismiss", {
      method: "POST",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        "content-type": "application/json",
        Cookie: `${COOKIE_NAME}=${cookie}`,
      },
      body: JSON.stringify(body),
    });
  }

  it("stores the dismissed version for the viewer and reads it back", async () => {
    const cookie = await seedSession(harness.handle, kp);
    await updateCheck.refresh();

    const before = await app.request("/api/version", {
      headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
    });
    expect(await before.json()).not.toHaveProperty("dismissedVersion");

    const res = await dismiss(cookie, { version: "1.6.0" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });

    const after = await app.request("/api/version", {
      headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
    });
    expect(await after.json()).toMatchObject({
      latest: "1.6.0",
      dismissedVersion: "1.6.0",
    });
  });

  it("serves and stores the canonical triple whatever spelling arrives", async () => {
    const cookie = await seedSession(harness.handle, kp);
    manifestBody = PREFIXED_MANIFEST;
    await updateCheck.refresh();

    const res = await dismiss(cookie, { version: "v1.6.0+build.7" });
    expect(res.status).toBe(200);

    const after = await app.request("/api/version", {
      headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
    });
    expect(await after.json()).toMatchObject({
      latest: "1.6.0",
      dismissedVersion: "1.6.0",
    });
  });

  it("refuses a dismiss of a release that is not the latest", async () => {
    const cookie = await seedSession(harness.handle, kp);
    await updateCheck.refresh();

    const res = await dismiss(cookie, { version: "1.5.0" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid-request" });
  });

  it("refuses a dismiss before the check has an answer", async () => {
    const cookie = await seedSession(harness.handle, kp);

    const res = await dismiss(cookie, { version: "1.6.0" });

    expect(res.status).toBe(400);
  });

  it("refuses a dismiss of a security release", async () => {
    const cookie = await seedSession(harness.handle, kp);
    manifestBody = SECURITY_MANIFEST;
    await updateCheck.refresh();

    const res = await dismiss(cookie, { version: "1.6.0" });

    expect(res.status).toBe(400);
    const after = await app.request("/api/version", {
      headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
    });
    expect(await after.json()).not.toHaveProperty("dismissedVersion");
  });

  it("refuses a dismiss from a Bearer token as human-only", async () => {
    const token = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.PRIVATE_WRITE,
    );
    await updateCheck.refresh();

    const res = await app.request("/api/version/dismiss", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: "1.6.0" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "human-only" });
  });

  it("rejects a dismiss body that is not a version", async () => {
    const cookie = await seedSession(harness.handle, kp);

    const res = await dismiss(cookie, { version: "latest" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid-request" });
  });

  it("refuses a dismiss without a session", async () => {
    const res = await app.request("/api/version/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "1.6.0" }),
    });

    expect(res.status).toBe(401);
  });
});
