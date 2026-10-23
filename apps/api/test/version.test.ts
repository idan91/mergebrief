// `GET /api/version`: gated like every /api/*
// surface (its second job is the CLI's cheapest authenticated probe), the
// injected version in the body, no-store, hint-free 401 without auth.
import { createHash, randomBytes } from "node:crypto";
import {
  createEnvKeyProvider,
  createTokenAuth,
  type KeyProvider,
} from "persistence";
import { seedGrant } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { createUpdateCheck, type UpdateCheck } from "../src/update-check";
import { testLogger } from "./logging";
import {
  KEY_REF,
  SAME_ORIGIN_HEADERS,
  brandReviewerId,
  buildAuthDeps,
} from "./fixtures";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";
import { seedSignIn } from "./sign-in";
import { AccessLevels } from "types/access-levels";
import { registerSharedPglite } from "./shared-pglite";

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
  const harness = registerSharedPglite();
  let app: ApiApp;
  let kp: KeyProvider;
  let updateCheck: UpdateCheck;
  let manifestBody: string;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CHECKED_AT);
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
    const auth: AuthDeps = buildAuthDeps(kp);
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth,
      ...UNUSED_INSTALLATION_DEPS,
      serverVersion: "1.2.3",
      updateCheck,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the update snapshot to a Bearer principal, no-store", async () => {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const grant = await seedGrant(harness.handle, {
      userId: brandReviewerId(555n),
      accessToken: "ghu_ACCESS",
      refreshToken: "ghr_REFRESH",
      keyProvider: kp,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await createTokenAuth(harness.handle).mintToken({
      scope: AccessLevels.EXTERNAL_WRITE,
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

  it("answers signed-out without auth and carries no version header", async () => {
    const res = await app.request("/api/version");
    expect(res.status).toBe(401);
    expect(res.headers.get("MergeBrief-Version")).toBeNull();
    expect(await res.json()).toEqual({
      error: "signed out",
      code: "signed-out",
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
    const { cookie } = await seedSignIn(harness.handle, kp);
    await updateCheck.refresh();

    const before = await app.request("/api/version", {
      headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
    });
    expect(await before.json()).not.toHaveProperty("dismissedVersion");

    const res = await dismiss(cookie, { version: "1.6.0" });
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");

    const after = await app.request("/api/version", {
      headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
    });
    expect(await after.json()).toMatchObject({
      latest: "1.6.0",
      dismissedVersion: "1.6.0",
    });
  });

  it("serves and stores the canonical triple whatever spelling arrives", async () => {
    const { cookie } = await seedSignIn(harness.handle, kp);
    manifestBody = PREFIXED_MANIFEST;
    await updateCheck.refresh();

    const res = await dismiss(cookie, { version: "v1.6.0+build.7" });
    expect(res.status).toBe(204);

    const after = await app.request("/api/version", {
      headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
    });
    expect(await after.json()).toMatchObject({
      latest: "1.6.0",
      dismissedVersion: "1.6.0",
    });
  });

  it("refuses a dismiss of a release that is not the latest", async () => {
    const { cookie } = await seedSignIn(harness.handle, kp);
    await updateCheck.refresh();

    const res = await dismiss(cookie, { version: "1.5.0" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid-request" });
  });

  it("refuses a dismiss before the check has an answer", async () => {
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await dismiss(cookie, { version: "1.6.0" });

    expect(res.status).toBe(400);
  });

  it("refuses a dismiss of a security release", async () => {
    const { cookie } = await seedSignIn(harness.handle, kp);
    manifestBody = SECURITY_MANIFEST;
    await updateCheck.refresh();

    const res = await dismiss(cookie, { version: "1.6.0" });

    expect(res.status).toBe(400);
    const after = await app.request("/api/version", {
      headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
    });
    expect(await after.json()).not.toHaveProperty("dismissedVersion");
  });

  it("rejects a dismiss body that is not a version", async () => {
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await dismiss(cookie, { version: "latest" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid-request" });
  });
});
