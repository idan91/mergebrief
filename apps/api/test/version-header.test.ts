// `MergeBrief-Version`: stamped on every /api response whose session layer
// resolved a principal, absent on a 401, a login redirect and a webhook, so a
// stranger learns nothing the gated /api/version did not already say.
import { WriteClassifications, type KeyProvider } from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import { buildAuthDeps, createKeyProvider } from "./fixtures";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";
import { seedApiToken } from "./sign-in";

const HEADER = "MergeBrief-Version";

describe("MergeBrief-Version response header", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
      serverVersion: "1.4.0",
    });
  });

  afterEach(async () => {
    await harness.close();
  });

  function mintBearer(): Promise<string> {
    return seedApiToken(harness.handle, kp, WriteClassifications.READ);
  }

  it("stamps the server version on a gated response", async () => {
    const token = await mintBearer();

    const res = await app.request("/api/version", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get(HEADER)).toBe("1.4.0");
  });

  it("stamps a product query the session layer passed", async () => {
    const token = await mintBearer();

    const res = await app.request("/api/capabilities", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get(HEADER)).toBe("1.4.0");
  });

  it("leaves a 401 without the header", async () => {
    const res = await app.request("/api/version");

    expect(res.status).toBe(401);
    expect(res.headers.get(HEADER)).toBeNull();
  });

  it("leaves the login redirect without the header", async () => {
    const res = await app.request("/api/auth/github");

    expect(res.status).toBe(302);
    expect(res.headers.get(HEADER)).toBeNull();
  });

  it("leaves a refused webhook delivery without the header", async () => {
    const res = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(401);
    expect(res.headers.get(HEADER)).toBeNull();
  });
});
