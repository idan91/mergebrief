// Reviewer-auth integration tests (BRIEF-2 stage 6): `app.request()` against
// `createApp` over the persistence PGlite harness, with GitHub mocked at the
// HTTP seam via a stubbed global `fetch` (no live network, no new mock libs).
// The stub answers exactly the three endpoints the flow touches — the OAuth
// token endpoint (`/login/oauth/access_token`, code exchange AND refresh), the
// authenticated user (`/user`), and the user installations
// (`/user/installations`) — because both `@octokit/oauth-app` and the
// user-scoped `Octokit` read `globalThis.fetch` at call time.
//
// Covers: login redirect + state cookie; CSRF state mismatch → 400; the happy
// callback (session row with both ciphertexts + `Set-Cookie` for `rs_session`);
// logout deletes the session + clears the cookie; and the refresh orchestrator
// (rotation on success, session deletion on a GitHub refresh failure). Asserts
// NO GitHub token/secret leaks into any response beyond the opaque session cookie.
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import type { Hono } from "hono";
import {
  decryptToken,
  encryptToken,
  envKeyProvider,
  forTenant,
  isInstallationId,
  isReviewerId,
  sessionAuth,
  userSettingsStore,
  type AppDatabase,
  type InstallationId,
  type KeyProvider,
  type ReviewerId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, refreshSessionToken, type AuthDeps } from "../src/lib";

// ---------------------------------------------------------------------------
// Fixtures + deps.
// ---------------------------------------------------------------------------

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const OTHER_INSTALLATION_ID = 111222;
const REVIEWER_ID = 555;

// GitHub token plaintexts the stub hands back — asserted ABSENT from responses.
const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

function keyProvider(): KeyProvider {
  return envKeyProvider({ [KEY_REF]: randomBytes(32).toString("base64") });
}

function authDeps(kp: KeyProvider): AuthDeps {
  return {
    oauthClientId: "Iv1.test-client-id",
    oauthClientSecret: "test-client-secret",
    keyProvider: kp,
    sessionKeyRef: KEY_REF,
    publicBaseUrl: "https://app.example.test",
    cookieSecure: true,
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function brandInstallation(value: bigint): InstallationId {
  if (!isInstallationId(value)) throw new Error("bad installation id");
  return value;
}
function brandReviewer(value: bigint): ReviewerId {
  if (!isReviewerId(value)) throw new Error("bad reviewer id");
  return value;
}

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch).
// ---------------------------------------------------------------------------

interface TokenSuccess {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in: number;
  token_type: string;
  scope: string;
}
type TokenBody = TokenSuccess | { error: string; error_description: string; error_uri: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

function tokenSuccess(access: string, refresh: string): TokenSuccess {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 28_800, // ~8h
    refresh_token_expires_in: 15_897_600, // ~6mo
    token_type: "bearer",
    scope: "",
  };
}

interface StubOptions {
  readonly token: TokenBody;
  readonly installations?: { id: number }[];
  readonly user?: { id: number; login: string };
}

/** Install a fetch stub answering the three GitHub endpoints the flow hits. */
function stubGitHub(opts: StubOptions): ReturnType<typeof vi.fn> {
  const fetchFn = vi.fn(
    async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/login/oauth/access_token")) {
        return jsonResponse(opts.token);
      }
      if (url.endsWith("/user")) {
        return jsonResponse(opts.user ?? { id: REVIEWER_ID, login: "octocat" });
      }
      if (url.includes("/user/installations")) {
        const installations = opts.installations ?? [{ id: INSTALLATION_ID }];
        return jsonResponse({ total_count: installations.length, installations });
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

/** Seed a session row with real encrypted tokens; returns the session hash. */
async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
  input: { expiresAt: Date; accessPlaintext: string; refreshPlaintext: string },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const hash = sha256Hex(token);
  const sealedAccess = await encryptToken(kp, KEY_REF, input.accessPlaintext);
  const sealedRefresh = await encryptToken(kp, KEY_REF, input.refreshPlaintext);
  if (!sealedAccess.ok || !sealedRefresh.ok) throw new Error("seed encrypt failed");
  await forTenant(handle, { installationId: brandInstallation(BigInt(INSTALLATION_ID)) }).sessions.create({
    sessionTokenHash: hash,
    reviewerId: brandReviewer(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    expiresAt: input.expiresAt,
  });
  return hash;
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------


// Conversation port stub (BRIEF-25): these tests never exercise the
// conversation read; a hit here is a test bug.
const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
};

describe("reviewer auth routes", () => {
  let harness: PgliteHarness;
  let app: Hono;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = keyProvider();
    app = createApp({ handle: harness.handle, webhookSecret: SECRET, auth: authDeps(kp), github: unusedConversationPort });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  it("GET /auth/github → 302 to GitHub with an HttpOnly state cookie", async () => {
    const res = await app.request("/auth/github");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("github.com/login/oauth/authorize");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("rs_oauth_state=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("callback with a mismatched state → 400 and clears the state cookie", async () => {
    const res = await app.request("/auth/github/callback?code=abc&state=aaaa", {
      headers: { Cookie: "rs_oauth_state=bbbb" },
    });
    expect(res.status).toBe(400);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("rs_oauth_state=");
    expect(await countRows(harness, "reviewer_session")).toBe(0);
  });

  it("happy callback → session row (both ciphertexts, refresh expiry) + rs_session cookie", async () => {
    stubGitHub({ token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN) });
    const state = "matching-state-nonce";
    const before = Date.now();

    const res = await app.request(`/auth/github/callback?code=thecode&state=${state}`, {
      headers: { Cookie: `rs_oauth_state=${state}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("rs_session=");
    expect(setCookie).toContain("HttpOnly");
    // No GitHub token/secret leaks into the response, only the opaque cookie.
    const body = await res.text();
    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, "test-client-secret"]) {
      expect(setCookie).not.toContain(secret);
      expect(body).not.toContain(secret);
    }

    const rows = await harness.raw("select * from reviewer_session");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(String(row?.["installation_id"])).toBe(String(INSTALLATION_ID));
    expect(String(row?.["reviewer_id"])).toBe(String(REVIEWER_ID));
    expect(String(row?.["gh_token_ciphertext"])).toMatch(/^v1\./);
    expect(String(row?.["gh_refresh_token_ciphertext"])).toMatch(/^v1\./);
    // Ciphertext at rest never equals the plaintext token.
    expect(String(row?.["gh_token_ciphertext"])).not.toContain(ACCESS_TOKEN);
    // Session lifetime = refresh-token lifetime (~6mo out).
    const expiresAt = epochMs(row?.["expires_at"]);
    expect(expiresAt - before).toBeGreaterThan(15_000_000_000);
  });

  it("callback → 403 when the reviewer has no accessible installation", async () => {
    stubGitHub({ token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN), installations: [] });
    const state = "state-no-install";
    const res = await app.request(`/auth/github/callback?code=c&state=${state}`, {
      headers: { Cookie: `rs_oauth_state=${state}` },
    });
    expect(res.status).toBe(403);
    expect(await countRows(harness, "reviewer_session")).toBe(0);
  });

  // Default-binding fallback matrix (D14): the callback binds the session to the
  // user's default installation ONLY when it is in the live accessible set,
  // otherwise the first accessible one. `user_settings` is seeded before login.
  async function runCallbackAndReadInstallation(): Promise<string> {
    const state = "matching-state-nonce";
    const res = await app.request(`/auth/github/callback?code=thecode&state=${state}`, {
      headers: { Cookie: `rs_oauth_state=${state}` },
    });
    expect(res.status).toBe(302);
    const rows = await harness.raw("select installation_id from reviewer_session limit 1");
    return String(rows[0]?.["installation_id"]);
  }

  it("binds the default installation when it is in the accessible set", async () => {
    stubGitHub({
      token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      installations: [{ id: INSTALLATION_ID }, { id: OTHER_INSTALLATION_ID }],
    });
    await userSettingsStore(harness.handle).setDefaultInstallation(
      brandReviewer(BigInt(REVIEWER_ID)),
      brandInstallation(BigInt(OTHER_INSTALLATION_ID)),
    );
    expect(await runCallbackAndReadInstallation()).toBe(String(OTHER_INSTALLATION_ID));
  });

  it("falls back to the first accessible installation when the default is not accessible", async () => {
    stubGitHub({
      token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      installations: [{ id: INSTALLATION_ID }], // OTHER not in the live set
    });
    await userSettingsStore(harness.handle).setDefaultInstallation(
      brandReviewer(BigInt(REVIEWER_ID)),
      brandInstallation(BigInt(OTHER_INSTALLATION_ID)),
    );
    expect(await runCallbackAndReadInstallation()).toBe(String(INSTALLATION_ID));
  });

  it("binds the first accessible installation when no default is set", async () => {
    stubGitHub({
      token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      installations: [{ id: OTHER_INSTALLATION_ID }, { id: INSTALLATION_ID }],
    });
    expect(await runCallbackAndReadInstallation()).toBe(String(OTHER_INSTALLATION_ID));
  });

  it("POST /auth/logout deletes the session and clears the cookie", async () => {
    const token = randomBytes(32).toString("base64url");
    const hash = sha256Hex(token);
    const sealed = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
    const sealedR = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
    if (!sealed.ok || !sealedR.ok) throw new Error("seed failed");
    await forTenant(harness.handle, {
      installationId: brandInstallation(BigInt(INSTALLATION_ID)),
    }).sessions.create({
      sessionTokenHash: hash,
      reviewerId: brandReviewer(BigInt(REVIEWER_ID)),
      reviewerLogin: "octocat",
      ghTokenCiphertext: sealed.value,
      ghRefreshTokenCiphertext: sealedR.value,
      keyRef: KEY_REF,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    expect(await countRows(harness, "reviewer_session")).toBe(1);

    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: { Cookie: `rs_session=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await countRows(harness, "reviewer_session")).toBe(0);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("rs_session=");
    expect(setCookie).toMatch(/Max-Age=0|Expires=/i);
  });

  it("refreshSessionToken rotates both ciphertexts and returns the fresh access token", async () => {
    stubGitHub({ token: tokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH) });
    // The observed access ciphertext still matches the stored row (no concurrent
    // rotation), so the compare-and-swap guard lets a real refresh proceed.
    const hash = await seedSession(harness.handle, kp, {
      expiresAt: new Date("2000-01-01T00:00:00Z"),
      accessPlaintext: ACCESS_TOKEN,
      refreshPlaintext: REFRESH_TOKEN,
    });
    const before = await harness.raw("select gh_token_ciphertext from reviewer_session");
    const beforeCipher = String(before[0]?.["gh_token_ciphertext"]);

    const session = await sessionAuth(harness.handle).findSession(hash);
    if (session === undefined) throw new Error("seeded session not found");
    const result = await refreshSessionToken(
      { handle: harness.handle, auth: authDeps(kp) },
      session,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.accessToken).toBe(ROTATED_ACCESS);

    const after = await harness.raw("select gh_token_ciphertext, gh_refresh_token_ciphertext, expires_at from reviewer_session");
    const afterAccessCipher = String(after[0]?.["gh_token_ciphertext"]);
    expect(afterAccessCipher).not.toBe(beforeCipher);
    // The rotated access ciphertext decrypts back to the rotated plaintext.
    const decrypted = await decryptToken(kp, KEY_REF, afterAccessCipher);
    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) throw new Error("unreachable");
    expect(decrypted.value).toBe(ROTATED_ACCESS);
    // Rotated refresh ciphertext decrypts to the rotated refresh plaintext.
    const decryptedR = await decryptToken(kp, KEY_REF, String(after[0]?.["gh_refresh_token_ciphertext"]));
    if (!decryptedR.ok) throw new Error("unreachable");
    expect(decryptedR.value).toBe(ROTATED_REFRESH);
    // Expiry bumped forward to the new refresh-token expiry.
    expect(epochMs(after[0]?.["expires_at"])).toBeGreaterThan(Date.now());
  });

  it("refreshSessionToken deletes the session on a GitHub refresh failure", async () => {
    stubGitHub({
      token: {
        error: "bad_refresh_token",
        error_description: "The refresh token is expired",
        error_uri: "https://docs.github.com/",
      },
    });
    const hash = await seedSession(harness.handle, kp, {
      expiresAt: new Date("2000-01-01T00:00:00Z"),
      accessPlaintext: ACCESS_TOKEN,
      refreshPlaintext: REFRESH_TOKEN,
    });

    const session = await sessionAuth(harness.handle).findSession(hash);
    if (session === undefined) throw new Error("seeded session not found");
    const result = await refreshSessionToken(
      { handle: harness.handle, auth: authDeps(kp) },
      session,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // Session burned → re-login required.
    expect(await countRows(harness, "reviewer_session")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function epochMs(cell: unknown): number {
  if (cell instanceof Date) return cell.getTime();
  if (typeof cell === "string") return new Date(cell).getTime();
  throw new Error(`expected a timestamp cell, got ${typeof cell}`);
}

async function countRows(harness: PgliteHarness, table: string): Promise<number> {
  const rows = await harness.raw(`select count(*)::int as n from ${table}`);
  const n = rows[0]?.["n"];
  if (typeof n !== "number") throw new Error(`unexpected count result for ${table}`);
  return n;
}
