// Reviewer-auth integration tests against `createApp` over the PGlite harness.
// GitHub is mocked at the HTTP boundary through a stubbed global fetch, which
// covers both `@octokit/oauth-app` and the user-scoped Octokit. Asserts no
// GitHub token or secret leaks into any response beyond the session cookie.
import { randomBytes } from "node:crypto";
import {
  decryptToken,
  encryptToken,
  createTenantRepository,
  createGrantAuth,
  createSessionAuth,
  createTokenAuth,
  WriteClassifications,
  createUserSettingsStore,
  type AppDatabase,
  type KeyProvider,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  derivePrincipalFromApiToken,
  derivePrincipalFromSession,
  refreshSessionToken,
  type ApiApp,
} from "../src/index";
import { testLogger, testLogging } from "./logging";
import {
  INSTALLATION_ID,
  KEY_REF,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandReviewerId,
  buildAuthDeps,
  createKeyProvider,
  hashSha256Hex,
  getRequestUrl,
} from "./fixtures";

// ---------------------------------------------------------------------------
// Fixtures + deps.
// ---------------------------------------------------------------------------

const OTHER_INSTALLATION_ID = 111222;

// GitHub token plaintexts the stub hands back, asserted ABSENT from responses.
const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

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
      const url = getRequestUrl(input);
      if (url.includes("/login/oauth/access_token")) {
        return jsonResponse(opts.token);
      }
      if (url.endsWith("/user")) {
        return jsonResponse(opts.user ?? { id: REVIEWER_ID, login: "octocat" });
      }
      if (url.includes("/user/installations")) {
        const installations = (
          opts.installations ?? [{ id: INSTALLATION_ID }]
        ).map((installation) => ({
          id: installation.id,
          account: { login: `org-${installation.id}` },
        }));
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
  const hash = hashSha256Hex(token);
  const sealedAccess = await encryptToken(kp, KEY_REF, input.accessPlaintext);
  const sealedRefresh = await encryptToken(kp, KEY_REF, input.refreshPlaintext);
  if (!sealedAccess.ok || !sealedRefresh.ok)
    throw new Error("seed encrypt failed");
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: input.expiresAt,
  });
  await createTenantRepository(handle, {
    installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
  }).sessions.create({
    sessionTokenHash: hash,
    reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt: input.expiresAt,
  });
  return hash;
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

// Conversation port stub: a call here is a test bug.
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
    kp = createKeyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: unusedConversationPort,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  it("lists nothing for a session that reaches no installation", async () => {
    const fetchFn = stubGitHub({
      token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      installations: [],
    });
    const token = randomBytes(32).toString("base64url");
    const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
    const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
    if (!sealedAccess.ok || !sealedRefresh.ok)
      throw new Error("seed encrypt failed");
    const grant = await createGrantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    // Owner-world (url-box) session: installation_id NULL by construction.
    await createTenantRepository(harness.handle, {
      ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
    }).sessions.create({
      sessionTokenHash: hashSha256Hex(token),
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      reviewerLogin: "octocat",
      grantId: grant.id,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });

    const res = await app.request("/api/pulls", {
      headers: { cookie: `rs_session=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pulls: [] });
    const urls = fetchFn.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((url) => url.includes("/repositories"))).toEqual([]);
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
    expect(((await res.json()) as { code?: string }).code).toBe(
      "sign-in-failed",
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("rs_oauth_state=");
    expect(await countRows(harness, "auth_session")).toBe(0);
  });

  it("stores both ciphertexts, refresh expiry and the session cookie", async () => {
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

    const rows = await harness.raw("select * from auth_session");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(String(row?.["installation_id"])).toBe(String(INSTALLATION_ID));
    expect(String(row?.["reviewer_id"])).toBe(String(REVIEWER_ID));
    // The credential pair lands on the linked grant row, sealed.
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

  it("callback with no accessible installation binds an OWNER-world session", async () => {
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
    // The url-box world: sign-in no longer requires an installation.
    expect(res.status).toBe(302);
    const rows = await harness.raw(
      "select installation_id, reviewer_id from auth_session",
    );
    expect(rows).toEqual([{ installation_id: null, reviewer_id: REVIEWER_ID }]);
  });

  // Default-binding fallback matrix: the callback binds the session to the
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
      "select installation_id from auth_session limit 1",
    );
    return String(rows[0]?.["installation_id"]);
  }

  it("binds the default installation when it is in the accessible set", async () => {
    stubGitHub({
      token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      installations: [{ id: INSTALLATION_ID }, { id: OTHER_INSTALLATION_ID }],
    });
    await createUserSettingsStore(harness.handle).setDefaultInstallation(
      brandReviewerId(BigInt(REVIEWER_ID)),
      brandInstallationId(BigInt(OTHER_INSTALLATION_ID)),
    );
    expect(await runCallbackAndReadInstallation()).toBe(
      String(OTHER_INSTALLATION_ID),
    );
  });

  it("falls back to the first accessible installation", async () => {
    stubGitHub({
      token: tokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      installations: [{ id: INSTALLATION_ID }], // OTHER not in the live set
    });
    await createUserSettingsStore(harness.handle).setDefaultInstallation(
      brandReviewerId(BigInt(REVIEWER_ID)),
      brandInstallationId(BigInt(OTHER_INSTALLATION_ID)),
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

  it("logout deletes the session and its orphaned grant, clearing the cookie", async () => {
    const token = randomBytes(32).toString("base64url");
    const hash = hashSha256Hex(token);
    const sealed = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
    const sealedR = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
    if (!sealed.ok || !sealedR.ok) throw new Error("seed failed");
    const grant = await createGrantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealed.value,
      ghRefreshTokenCiphertext: sealedR.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await createTenantRepository(harness.handle, {
      installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
    }).sessions.create({
      sessionTokenHash: hash,
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      reviewerLogin: "octocat",
      grantId: grant.id,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    expect(await countRows(harness, "auth_session")).toBe(1);

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `rs_session=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await countRows(harness, "auth_session")).toBe(0);
    // Last-referent lifecycle: the grant died with its only referent.
    expect(await countRows(harness, "github_grant")).toBe(0);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("rs_session=");
    expect(setCookie).toMatch(/Max-Age=0|Expires=/i);
  });

  it("GET /api/auth/session without a cookie answers 401", async () => {
    const res = await app.request("/api/auth/session");
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/session with a live session answers ok", async () => {
    const token = randomBytes(32).toString("base64url");
    const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
    const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
    if (!sealedAccess.ok || !sealedRefresh.ok)
      throw new Error("seed encrypt failed");
    const grant = await createGrantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await createTenantRepository(harness.handle, {
      ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
    }).sessions.create({
      sessionTokenHash: hashSha256Hex(token),
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      reviewerLogin: "octocat",
      grantId: grant.id,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });

    const res = await app.request("/api/auth/session", {
      headers: { cookie: `rs_session=${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("refresh rotates both ciphertexts and returns the fresh access token", async () => {
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

    const resolved = await createSessionAuth(harness.handle).findSession(hash);
    if (resolved === undefined) throw new Error("seeded session not found");
    const result = await refreshSessionToken(
      { handle: harness.handle, auth: buildAuthDeps(kp) },
      derivePrincipalFromSession(resolved),
      testLogger(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.accessToken).toBe(ROTATED_ACCESS);

    // The rotation lands on the GRANT row; the session row mirrors the
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
    const sessionRow = await harness.raw("select expires_at from auth_session");
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

    const resolved = await createSessionAuth(harness.handle).findSession(hash);
    if (resolved === undefined) throw new Error("seeded session not found");
    const capture = testLogging();
    const result = await refreshSessionToken(
      { handle: harness.handle, auth: buildAuthDeps(kp) },
      derivePrincipalFromSession(resolved),
      capture.logger,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // Session burned → re-login required; the orphaned grant died with it.
    expect(await countRows(harness, "auth_session")).toBe(0);
    expect(await countRows(harness, "github_grant")).toBe(0);
    // The failure is operator-visible: one
    // token.refresh.fail error line, numeric ids only.
    const line = capture.lines().find((l) => l["evt"] === "token.refresh.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["reviewerId"]).toBe(String(resolved.session.reviewerId));
  });

  it("a stale CAS seed returns the stored token with no GitHub exchange", async () => {
    // The token endpoint is stubbed to FAIL, if the orchestrator attempted a
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
    const stale = await createSessionAuth(harness.handle).findSession(hash);
    if (stale === undefined) throw new Error("seeded session not found");

    // Another channel wins the rotation while our principal is in flight.
    const rotatedExpiry = new Date("2027-09-01T00:00:00Z");
    const sealedAccess = await encryptToken(kp, KEY_REF, ROTATED_ACCESS);
    const sealedRefresh = await encryptToken(kp, KEY_REF, ROTATED_REFRESH);
    if (!sealedAccess.ok || !sealedRefresh.ok)
      throw new Error("seed encrypt failed");
    const rotated = await createGrantAuth(harness.handle).refreshGrant(
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
      { handle: harness.handle, auth: buildAuthDeps(kp) },
      derivePrincipalFromSession(stale), // still carries the PRE-rotation ciphertext
      testLogger(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // The stored (fresh) token comes back decrypted, no second exchange.
    expect(result.value.accessToken).toBe(ROTATED_ACCESS);
    // The mirror runs on the short-circuit path too, the rotation may have
    // been won by the Bearer channel, which never mirrors.
    const sessionRow = await harness.raw("select expires_at from auth_session");
    expect(epochMs(sessionRow[0]?.["expires_at"])).toBe(
      rotatedExpiry.getTime(),
    );
  });

  it("cookie refresh returns NOT_FOUND when the session vanishes", async () => {
    stubGitHub({ token: tokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH) });
    const hash = await seedSession(harness.handle, kp, {
      expiresAt: new Date("2000-01-01T00:00:00Z"),
      accessPlaintext: ACCESS_TOKEN,
      refreshPlaintext: REFRESH_TOKEN,
    });
    const resolved = await createSessionAuth(harness.handle).findSession(hash);
    if (resolved === undefined) throw new Error("seeded session not found");
    // A minted token shares the grant, so the grant SURVIVES the logout and
    // the rotation proceeds, only the session-expiry mirror can notice.
    await createTokenAuth(harness.handle).mintToken({
      scope: WriteClassifications.EXTERNAL_WRITE,
      userId: brandReviewerId(BigInt(REVIEWER_ID)),
      name: "shares-the-grant",
      tokenHash: hashSha256Hex(randomBytes(32).toString("base64url")),
      grantId: resolved.session.grantId,
      expiresAt: null,
    });
    // Logout lands between resolution and refresh.
    await createSessionAuth(harness.handle).deleteSession(hash);

    const result = await refreshSessionToken(
      { handle: harness.handle, auth: buildAuthDeps(kp) },
      derivePrincipalFromSession(resolved),
      testLogger(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("not-found");
    // The rotation itself stood, it benefits the surviving token referent.
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

  it("bearer refresh denies a token revoked mid-rotation and keeps the row", async () => {
    stubGitHub({ token: tokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH) });
    const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
    const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
    if (!sealedAccess.ok || !sealedRefresh.ok)
      throw new Error("seed encrypt failed");
    const grant = await createGrantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    const bearerHash = hashSha256Hex(randomBytes(32).toString("base64url"));
    const minted = await createTokenAuth(harness.handle).mintToken({
      scope: WriteClassifications.EXTERNAL_WRITE,
      userId: brandReviewerId(BigInt(REVIEWER_ID)),
      name: "revoked-mid-flight",
      tokenHash: bearerHash,
      grantId: grant.id,
      expiresAt: null,
    });
    const live = await createTokenAuth(harness.handle).resolveByHash(
      bearerHash,
      new Date(),
    );
    if (!live.ok) throw new Error("seeded token did not resolve");
    const principal = derivePrincipalFromApiToken(live.value);
    // The owner revokes while the request is in flight.
    const revoked = await createTokenAuth(harness.handle).revokeToken(
      brandReviewerId(BigInt(REVIEWER_ID)),
      minted.id,
      new Date(),
    );
    if (!revoked.ok) throw new Error("revoke failed");

    const capture = testLogging();
    const result = await refreshSessionToken(
      { handle: harness.handle, auth: buildAuthDeps(kp) },
      principal,
      capture.logger,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("refresh-failed");
    // Bearer posture: the row is NEVER deleted, its owner sees and revokes.
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
