import { createHash, randomBytes } from "node:crypto";
import { ProductActionIds } from "contract";
import {
  createEnvKeyProvider,
  createTokenAuth,
  type KeyProvider,
} from "persistence";
import { seedGrant } from "persistence/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { shapeCatalogOperations } from "../src/product-operations/catalog";
import { productOperationRegistry } from "../src/product-operations/registry";
import { SESSION_COOKIE } from "../src/routes/auth/session/consts";
import { MAX_REQUEST_BODY_BYTES } from "../src/routes/wire-bounds";
import { testLogger } from "./logging";
import {
  KEY_REF,
  brandReviewerId,
  buildAuthDeps,
  createKeyProvider,
} from "./fixtures";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";
import { seedApiToken, seedSignIn } from "./sign-in";
import { AccessLevels } from "types/access-levels";
import { registerSharedPglite } from "./shared-pglite";

const harness = registerSharedPglite();

// `MergeBrief-Version`: stamped on every /api response whose session layer
// resolved a principal, absent on a 401, a login redirect and a webhook, so a
// stranger learns nothing the gated /api/version did not already say.
describe("MergeBrief-Version response header", () => {
  const HEADER = "MergeBrief-Version";
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(() => {
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

  function mintBearer(): Promise<string> {
    return seedApiToken(harness.handle, kp, AccessLevels.READ);
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

// `GET /api/capabilities`: the composed registry served as data, gated like
// every /api/* surface, the catalog fields in registry order.
describe("GET /api/capabilities", () => {
  const bodySchema = z.object({
    operations: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        classification: z.string(),
        endpoint: z.string(),
      }),
    ),
  });
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(() => {
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
    });
  });

  async function bearer(): Promise<string> {
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
      scope: AccessLevels.READ,
      userId: brandReviewerId(555n),
      name: "ci-token",
      tokenHash: createHash("sha256").update(plaintext).digest("hex"),
      grantId: grant.id,
      expiresAt: null,
    });
    return plaintext;
  }

  it("serves the registry's catalog fields, no-store", async () => {
    const token = await bearer();
    const res = await app.request("/api/capabilities", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = bodySchema.parse(await res.json());
    expect(body.operations).toEqual(
      shapeCatalogOperations(productOperationRegistry.list()),
    );
  });
});

// The session layer's 401s by wire code: a cookie that names no live
// session is `signed-out`, a refused Bearer token the hint-free
// `unauthorized`.
describe("sessionLayer refusals", () => {
  const SESSION_ONLY_PATH = "/api/capabilities";
  const PAST_EXPIRY_MS = 1000;
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
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

// The headers on every answer the app gives, whichever layer answers: a route,
// a gate's refusal, a redirect in the sign-in flow, an unmatched path.
describe("security response headers", () => {
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

// The request-body cap at the composition root: it answers before the
// session layer, so these requests carry no credential.
describe("request body cap", () => {
  const JSON_HEADERS = { "content-type": "application/json" };
  const OVERSIZED = JSON.stringify({
    body: "x".repeat(MAX_REQUEST_BODY_BYTES),
  });
  const STREAM_CHUNK_BYTES = 64 * 1024;
  const PATH_PARAM = /:[A-Za-z]+/g;
  let app: ApiApp;

  function getUploadPath(): string {
    const upload = productOperationRegistry
      .list()
      .find(
        (descriptor) => descriptor.id === ProductActionIds.UPLOAD_ATTACHMENT,
      );
    if (upload === undefined) {
      throw new Error("the upload operation is not registered");
    }
    const [, path = ""] = upload.endpoint.split(" ");
    return path.replace(PATH_PARAM, "1");
  }

  function streamBytes(total: number): ReadableStream<Uint8Array> {
    let sent = 0;
    return new ReadableStream({
      pull(controller) {
        if (sent >= total) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(STREAM_CHUNK_BYTES));
        sent += STREAM_CHUNK_BYTES;
      },
    });
  }

  beforeEach(() => {
    const keys = createEnvKeyProvider({
      [KEY_REF]: randomBytes(32).toString("base64"),
    });
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: "test-webhook-secret",
      auth: buildAuthDeps(keys),
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  it("refuses a declared body over the cap with request-too-large", async () => {
    const res = await app.request("/api/version/dismiss", {
      method: "POST",
      headers: JSON_HEADERS,
      body: OVERSIZED,
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "request-too-large" });
  });

  it("refuses a streamed body that crosses the cap mid-read", async () => {
    const res = await app.request("/api/version/dismiss", {
      method: "POST",
      headers: { ...JSON_HEADERS, "transfer-encoding": "chunked" },
      body: streamBytes(MAX_REQUEST_BODY_BYTES + STREAM_CHUNK_BYTES),
      duplex: "half",
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "request-too-large" });
  });

  it("lets a body under the cap reach the session layer", async () => {
    const res = await app.request("/api/version/dismiss", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ version: "1.6.0" }),
    });

    expect(res.status).toBe(401);
  });

  it("leaves the attachment upload to its own larger cap", async () => {
    const res = await app.request(getUploadPath(), {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(MAX_REQUEST_BODY_BYTES + 1),
    });

    expect(res.status).toBe(401);
  });
});
