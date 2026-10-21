// The session layer's 401s by wire code: a cookie that names no live
// session is `signed-out`, a refused Bearer token the hint-free
// `unauthorized`.
import { randomBytes } from "node:crypto";
import { createEnvKeyProvider, type KeyProvider } from "persistence";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { SESSION_COOKIE } from "../src/routes/auth/session/consts";
import { KEY_REF, buildAuthDeps } from "./fixtures";
import { testLogger } from "./logging";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";
import { seedSignIn } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

const SESSION_ONLY_PATH = "/api/capabilities";
const PAST_EXPIRY_MS = 1000;

describe("sessionLayer refusals", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let app: ApiApp;

  beforeEach(() => {
    kp = createEnvKeyProvider({
      [KEY_REF]: randomBytes(32).toString("base64"),
    });
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  async function requestWithCookie(cookie: string): Promise<Response> {
    return app.request(SESSION_ONLY_PATH, {
      headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
    });
  }

  it("answers signed-out when no session cookie rides", async () => {
    const res = await app.request(SESSION_ONLY_PATH);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "signed out",
      code: "signed-out",
    });
  });

  it("answers signed-out for a cookie no session row holds", async () => {
    const unknownCookie = randomBytes(32).toString("base64url");

    const res = await requestWithCookie(unknownCookie);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "signed-out" });
  });

  it("answers signed-out for an expired session", async () => {
    const { cookie } = await seedSignIn(harness.handle, kp, {
      expiresAt: new Date(Date.now() - PAST_EXPIRY_MS),
    });

    const res = await requestWithCookie(cookie);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "signed-out" });
  });

  it("answers a hint-free unauthorized for a bad Bearer token", async () => {
    const res = await app.request(SESSION_ONLY_PATH, {
      headers: { Authorization: "Bearer mergebrief_unknown" },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "unauthorized",
      code: "unauthorized",
    });
  });
});
