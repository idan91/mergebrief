// The headers on every answer the app gives, whichever layer answers: a route,
// a gate's refusal, a redirect in the sign-in flow, an unmatched path.
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { buildAuthDeps, createKeyProvider } from "./fixtures";
import { testLogger } from "./logging";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";
import { registerSharedPglite } from "./shared-pglite";

const EXPECTED_HEADERS = {
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const ANSWERS = [
  ["a gate's refusal", "GET", "/api/version", 401],
  ["the sign-in redirect", "GET", "/api/auth/github", 302],
  ["the OAuth callback's redirect", "GET", "/api/auth/github/callback", 302],
  ["an unsigned webhook", "POST", "/api/webhooks/github", 401],
  ["an unmatched api path", "GET", "/api/no-such-route", 404],
  ["a path outside /api", "GET", "/no-such-route", 404],
] as const;

describe("security response headers", () => {
  const harness = registerSharedPglite();
  let app: ApiApp;

  beforeEach(() => {
    const auth = buildAuthDeps(createKeyProvider());
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth,
      ...UNUSED_INSTALLATION_DEPS,
      serverVersion: "1.4.0",
    });
  });

  it("answers every layer with every header", async () => {
    const answers: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [answer, method, path, status] of ANSWERS) {
      const res = await app.request(path, { method });
      const headers = Object.fromEntries(res.headers.entries());
      answers[answer] = { status: res.status, headers };
      expected[answer] = { status, headers: EXPECTED_HEADERS };
    }

    expect(answers).toMatchObject(expected);
  });
});
