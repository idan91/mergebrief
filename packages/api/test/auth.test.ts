// Reviewer-auth integration tests (BRIEF-2 stage 6): `app.request()` against
// `createApp` over the persistence PGlite harness, with GitHub mocked at the
// HTTP boundary via a stubbed global `fetch` (no live network, no new mock libs).
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
import {
  decryptToken,
  encryptToken,
  envKeyProvider,
  forTenant,
  grantAuth,
  isInstallationId,
  isReviewerId,
  sessionAuth,
  tokenAuth,
  userSettingsStore,
  type AppDatabase,
  type InstallationId,
  type KeyProvider,
  type ReviewerId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  principalFromApiToken,
  principalFromSession,
  refreshSessionToken,
  type ApiApp,
  type AuthDeps,
} from "../src/index";
import { testLogger, testLogging } from "./logging";

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
type TokenBody =
  | TokenSuccess
  | { error: string; error_description: string; error_uri: string };

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
    async (
      input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/login/oauth/access_token")) {
        return jsonResponse(opts.token);
      }
      if (url.endsWith("/user")) {
        return jsonResponse(opts.user ?? { id: REVIEWER_ID, login: "octocat" });
      }
      if (url.includes("/user/installations")) {
        const installations = opts.installations ?? [{ id: INSTALLATION_ID }];
        return jsonResponse({
          total_count: installations.length,
          installations,
        });
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

/** Seed a grant + session row with real encrypted tokens; returns the hash. */
async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
  input: { expiresAt: Date; accessPlaintext: string; refreshPlaintext: string },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const hash = sha256Hex(token);
  const sealedAccess = await encryptToken(kp, KEY_REF, input.accessPlaintext);
  const sealedRefresh = await encryptToken(kp, KEY_REF, input.refreshPlaintext);
  if (!sealedAccess.ok || !sealedRefresh.ok)
    throw new Error("seed encrypt failed");
  const grant = await grantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: input.expiresAt,
  });
  await forTenant(handle, {
    installationId: brandInstallation(BigInt(INSTALLATION_ID)),
  }).sessions.create({
    sessionTokenHash: hash,
    reviewerId: brandReviewer(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    grantId: grant.id,
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
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
};

describe("reviewer auth routes", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = keyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: authDeps(kp),
      github: unusedConversationPort,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  it("GET /api/auth/github → 302 to GitHub with an HttpOnly state cookie", async () => {
    const res = await app.request("/api/auth/github");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(
      "github.com/login/oauth/authorize",
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("rs_oauth_state=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("callback with a mismatched state → 400 and clears the state cookie", async () => {
    const res = await app.request(
      "/api/auth/github/callback?code=abc&state=aaaa",
      {
        headers: { Cookie: "rs_oauth_state=bbbb" },
      },
    );
    expect(res.status).toBe(400);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("rs_oauth_state=");
    expect(await countRows(harness, "reviewer_session")).toBe(0);
  });

  it("happy callback → session row (both ciphertexts, refresh expiry) + rs_session cookie", async () => {
    stubGitHub({ token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN) });
    const state = "matching-state-nonce";
    const before = Date.now();

    const res = await app.request(
      `/api/auth/github/callback?code=thecode&state=${state}`,
      {
        headers: { Cookie: `rs_oauth_state=${state}` },
      },
    );
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
    // D15: the credential pair lands on the linked grant row, sealed.
    const grantRows = await harness.raw("select * from github_grant");
    expect(grantRows).toHaveLength(1);
    expect(String(row?.["grant_id"])).toBe(String(grantRows[0]?.["id"]));
    expect(String(grantRows[0]?.["gh_token_ciphertext"])).toMatch(/^v1\./);
    expect(String(grantRows[0]?.["gh_refresh_token_ciphertext"])).toMatch(
      /^v1\./,
    );
    // Ciphertext at rest never equals the plaintext token.
    expect(String(grantRows[0]?.["gh_token_ciphertext"])).not.toContain(
      ACCESS_TOKEN,
    );
    // Session lifetime = refresh-token lifetime (~6mo out).
    const expiresAt = epochMs(row?.["expires_at"]);
    expect(expiresAt - before).toBeGreaterThan(15_000_000_000);
  });

  it("callback → 403 when the reviewer has no accessible installation", async () => {
    stubGitHub({
      token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      installations: [],
    });
    const state = "state-no-install";
    const res = await app.request(
      `/api/auth/github/callback?code=c&state=${state}`,
      {
        headers: { Cookie: `rs_oauth_state=${state}` },
      },
    );
    expect(res.status).toBe(403);
    expect(await countRows(harness, "reviewer_session")).toBe(0);
  });

  // Default-binding fallback matrix (D14): the callback binds the session to the
  // user's default installation ONLY when it is in the live accessible set,
  // otherwise the first accessible one. `user_settings` is seeded before login.
  async function runCallbackAndReadInstallation(): Promise<string> {
    const state = "matching-state-nonce";
    const res = await app.request(
      `/api/auth/github/callback?code=thecode&state=${state}`,
      {
        headers: { Cookie: `rs_oauth_state=${state}` },
      },
    );
    expect(res.status).toBe(302);
    const rows = await harness.raw(
      "select installation_id from reviewer_session limit 1",
    );
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
    expect(await runCallbackAndReadInstallation()).toBe(
      String(OTHER_INSTALLATION_ID),
    );
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
    expect(await runCallbackAndReadInstallation()).toBe(
      String(INSTALLATION_ID),
    );
  });

  it("binds the first accessible installation when no default is set", async () => {
    stubGitHub({
      token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      installations: [{ id: OTHER_INSTALLATION_ID }, { id: INSTALLATION_ID }],
    });
    expect(await runCallbackAndReadInstallation()).toBe(
      String(OTHER_INSTALLATION_ID),
    );
  });

  it("POST /api/auth/logout deletes the session (and its orphaned grant) and clears the cookie", async () => {
    const token = randomBytes(32).toString("base64url");
    const hash = sha256Hex(token);
    const sealed = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
    const sealedR = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
    if (!sealed.ok || !sealedR.ok) throw new Error("seed failed");
    const grant = await grantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealed.value,
      ghRefreshTokenCiphertext: sealedR.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await forTenant(harness.handle, {
      installationId: brandInstallation(BigInt(INSTALLATION_ID)),
    }).sessions.create({
      sessionTokenHash: hash,
      reviewerId: brandReviewer(BigInt(REVIEWER_ID)),
      reviewerLogin: "octocat",
      grantId: grant.id,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    expect(await countRows(harness, "reviewer_session")).toBe(1);

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `rs_session=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await countRows(harness, "reviewer_session")).toBe(0);
    // D15 last-referent lifecycle: the grant died with its only referent.
    expect(await countRows(harness, "github_grant")).toBe(0);
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
    const before = await harness.raw(
      "select gh_token_ciphertext from github_grant",
    );
    const beforeCipher = String(before[0]?.["gh_token_ciphertext"]);

    const resolved = await sessionAuth(harness.handle).findSession(hash);
    if (resolved === undefined) throw new Error("seeded session not found");
    const result = await refreshSessionToken(
      { handle: harness.handle, auth: authDeps(kp) },
      principalFromSession(resolved),
      testLogger(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.accessToken).toBe(ROTATED_ACCESS);

    // The rotation lands on the GRANT row (D15); the session row mirrors the
    // rotated refresh-token lifetime onto its own expires_at.
    const after = await harness.raw(
      "select gh_token_ciphertext, gh_refresh_token_ciphertext from github_grant",
    );
    const afterAccessCipher = String(after[0]?.["gh_token_ciphertext"]);
    expect(afterAccessCipher).not.toBe(beforeCipher);
    // The rotated access ciphertext decrypts back to the rotated plaintext.
    const decrypted = await decryptToken(kp, KEY_REF, afterAccessCipher);
    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) throw new Error("unreachable");
    expect(decrypted.value).toBe(ROTATED_ACCESS);
    // Rotated refresh ciphertext decrypts to the rotated refresh plaintext.
    const decryptedR = await decryptToken(
      kp,
      KEY_REF,
      String(after[0]?.["gh_refresh_token_ciphertext"]),
    );
    if (!decryptedR.ok) throw new Error("unreachable");
    expect(decryptedR.value).toBe(ROTATED_REFRESH);
    // Session expiry mirrored forward to the new refresh-token expiry.
    const sessionRow = await harness.raw(
      "select expires_at from reviewer_session",
    );
    expect(epochMs(sessionRow[0]?.["expires_at"])).toBeGreaterThan(Date.now());
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

    const resolved = await sessionAuth(harness.handle).findSession(hash);
    if (resolved === undefined) throw new Error("seeded session not found");
    const capture = testLogging();
    const result = await refreshSessionToken(
      { handle: harness.handle, auth: authDeps(kp) },
      principalFromSession(resolved),
      capture.logger,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // Session burned → re-login required; the orphaned grant died with it.
    expect(await countRows(harness, "reviewer_session")).toBe(0);
    expect(await countRows(harness, "github_grant")).toBe(0);
    // The failure is operator-visible (ADR 0034 taxonomy): one
    // token.refresh.fail error line, numeric ids only.
    const line = capture.lines().find((l) => l["evt"] === "token.refresh.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["reviewerId"]).toBe(String(resolved.session.reviewerId));
  });

  it("refreshSessionToken short-circuits on a stale CAS seed: no GitHub exchange, stored token returned, expiry mirrored", async () => {
    // The token endpoint is stubbed to FAIL — if the orchestrator attempted a
    // real exchange the test would fail, proving the short-circuit path.
    stubGitHub({
      token: {
        error: "must_not_be_called",
        error_description: "",
        error_uri: "",
      },
    });
    const hash = await seedSession(harness.handle, kp, {
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      accessPlaintext: ACCESS_TOKEN,
      refreshPlaintext: REFRESH_TOKEN,
    });
    const stale = await sessionAuth(harness.handle).findSession(hash);
    if (stale === undefined) throw new Error("seeded session not found");

    // Another channel wins the rotation while our principal is in flight.
    const rotatedExpiry = new Date("2027-09-01T00:00:00Z");
    const sealedAccess = await encryptToken(kp, KEY_REF, ROTATED_ACCESS);
    const sealedRefresh = await encryptToken(kp, KEY_REF, ROTATED_REFRESH);
    if (!sealedAccess.ok || !sealedRefresh.ok)
      throw new Error("seed encrypt failed");
    const rotated = await grantAuth(harness.handle).refreshGrant(
      stale.grant.id,
      stale.grant.ghTokenCiphertext,
      () =>
        Promise.resolve({
          ok: true,
          value: {
            ghTokenCiphertext: sealedAccess.value,
            ghRefreshTokenCiphertext: sealedRefresh.value,
            keyRef: KEY_REF,
            refreshExpiresAt: rotatedExpiry,
          },
        }),
    );
    if (!rotated.ok) throw new Error("out-of-band rotation failed");

    const result = await refreshSessionToken(
      { handle: harness.handle, auth: authDeps(kp) },
      principalFromSession(stale), // still carries the PRE-rotation ciphertext
      testLogger(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // The stored (fresh) token comes back decrypted, no second exchange.
    expect(result.value.accessToken).toBe(ROTATED_ACCESS);
    // The mirror runs on the short-circuit path too — the rotation may have
    // been won by the Bearer channel, which never mirrors.
    const sessionRow = await harness.raw(
      "select expires_at from reviewer_session",
    );
    expect(epochMs(sessionRow[0]?.["expires_at"])).toBe(
      rotatedExpiry.getTime(),
    );
  });

  it("refreshSessionToken (cookie) returns NOT_FOUND when the session vanished mid-rotation", async () => {
    stubGitHub({ token: tokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH) });
    const hash = await seedSession(harness.handle, kp, {
      expiresAt: new Date("2000-01-01T00:00:00Z"),
      accessPlaintext: ACCESS_TOKEN,
      refreshPlaintext: REFRESH_TOKEN,
    });
    const resolved = await sessionAuth(harness.handle).findSession(hash);
    if (resolved === undefined) throw new Error("seeded session not found");
    // A minted token shares the grant, so the grant SURVIVES the logout and
    // the rotation proceeds — only the session-expiry mirror can notice.
    await tokenAuth(harness.handle).mintToken({
      installationId: brandInstallation(BigInt(INSTALLATION_ID)),
      userId: brandReviewer(BigInt(REVIEWER_ID)),
      name: "shares-the-grant",
      tokenHash: sha256Hex(randomBytes(32).toString("base64url")),
      grantId: resolved.session.grantId,
      expiresAt: null,
    });
    // Logout lands between resolution and refresh.
    await sessionAuth(harness.handle).deleteSession(hash);

    const result = await refreshSessionToken(
      { handle: harness.handle, auth: authDeps(kp) },
      principalFromSession(resolved),
      testLogger(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("not-found");
    // The rotation itself stood — it benefits the surviving token referent.
    const grantRow = await harness.raw(
      "select gh_token_ciphertext from github_grant",
    );
    const decrypted = await decryptToken(
      kp,
      KEY_REF,
      String(grantRow[0]?.["gh_token_ciphertext"]),
    );
    if (!decrypted.ok) throw new Error("unreachable");
    expect(decrypted.value).toBe(ROTATED_ACCESS);
  });

  it("refreshSessionToken (bearer) denies a token revoked mid-rotation without deleting the row", async () => {
    stubGitHub({ token: tokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH) });
    const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
    const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
    if (!sealedAccess.ok || !sealedRefresh.ok)
      throw new Error("seed encrypt failed");
    const grant = await grantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    const bearerHash = sha256Hex(randomBytes(32).toString("base64url"));
    const minted = await tokenAuth(harness.handle).mintToken({
      installationId: brandInstallation(BigInt(INSTALLATION_ID)),
      userId: brandReviewer(BigInt(REVIEWER_ID)),
      name: "revoked-mid-flight",
      tokenHash: bearerHash,
      grantId: grant.id,
      expiresAt: null,
    });
    const live = await tokenAuth(harness.handle).resolveByHash(
      bearerHash,
      new Date(),
    );
    if (!live.ok) throw new Error("seeded token did not resolve");
    const principal = principalFromApiToken(live.value);
    // The owner revokes while the request is in flight.
    const revoked = await tokenAuth(harness.handle).revokeToken(
      brandReviewer(BigInt(REVIEWER_ID)),
      minted.id,
      new Date(),
    );
    if (!revoked.ok) throw new Error("revoke failed");

    const capture = testLogging();
    const result = await refreshSessionToken(
      { handle: harness.handle, auth: authDeps(kp) },
      principal,
      capture.logger,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("refresh-failed");
    // Bearer posture: the row is NEVER deleted — its owner sees and revokes.
    const rows = await harness.raw("select revoked_at from api_token");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["revoked_at"]).not.toBeNull();
    const line = capture.lines().find((l) => l["evt"] === "token.refresh.fail");
    expect(line?.["level"]).toBe("error");
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

async function countRows(
  harness: PgliteHarness,
  table: string,
): Promise<number> {
  const rows = await harness.raw(`select count(*)::int as n from ${table}`);
  const n = rows[0]?.["n"];
  if (typeof n !== "number")
    throw new Error(`unexpected count result for ${table}`);
  return n;
}
