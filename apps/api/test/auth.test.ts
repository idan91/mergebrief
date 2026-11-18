// Reviewer-auth integration tests against `createApp` over the PGlite harness.
// GitHub is mocked at the HTTP boundary through a stubbed global fetch, which
// covers both `@octokit/oauth-app` and the user-scoped Octokit. Asserts no
// GitHub token or secret leaks into any response beyond the session cookie.
import { randomBytes } from "node:crypto";
import {
  decryptToken,
  encryptToken,
  GrantSealedColumns,
  createGrantAuth,
  createSessionAuth,
  createTokenAuth,
  type GithubGrantRow,
  type KeyProvider,
} from "persistence";
import { seedGrant } from "persistence/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  derivePrincipalFromApiToken,
  derivePrincipalFromSession,
  RefreshErrorCodes,
  refreshSessionToken,
  type ApiApp,
  type AppDeps,
} from "../src/index";
import { testLogger, testLogging } from "./logging";
import {
  INSTALLATION_ID,
  KEY_REF,
  REVIEWER_ID,
  SECRET,
  brandReviewerId,
  buildAuthDeps,
  createKeyProvider,
  hashSha256Hex,
  getRequestUrl,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import {
  BAD_REFRESH_TOKEN_BODY,
  LISTED_REVIEWER_DEPS,
  UNUSED_INSTALLATION_DEPS,
  makeOAuthErrorBody,
  makeTokenSuccess,
  stubGitHub,
} from "./reviewer-github";
import type { ViewerPrincipal } from "../src/routes/auth/session/types";
import { seedPullRequest } from "./session/fixtures";
import { ACCESS_TOKEN, REFRESH_TOKEN, seedSignIn } from "./sign-in";
import { AccessLevels } from "types/access-levels";
import {
  openPerTestPglite,
  registerSharedPglite,
  type SharedPglite,
} from "./shared-pglite";

// ---------------------------------------------------------------------------
// Fixtures + deps.
// ---------------------------------------------------------------------------

// GitHub token plaintexts the stub hands back, asserted ABSENT from responses.
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";
/** The route mints its CSRF state from this many random bytes. */
const OAUTH_STATE_BYTES = 32;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

describe("reviewer auth routes", () => {
  const harness = registerSharedPglite();
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(() => {
    kp = createKeyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
    });
  });

  it("lists nothing for a session that reaches no installation", async () => {
    const fetchFn = stubGitHub({
      token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      installations: [],
    });
    await seedPullRequest(harness.handle);
    const { cookie: token } = await seedSignIn(harness.handle, kp);

    const res = await app.request("/api/inbox", {
      headers: { cookie: `__Host-mergebrief_session=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ items: [] });
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
    expect(setCookie.startsWith("__Host-mergebrief_oauth_state=")).toBe(true);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Domain=");
  });

  it("a mismatched callback lands on sign-in-failed and keeps the state", async () => {
    const res = await app.request(
      "/api/auth/github/callback?code=abc&state=aaaa",
      {
        headers: { Cookie: "__Host-mergebrief_oauth_state=bbbb" },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?error=sign-in-failed");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await countRows(harness, "auth_session")).toBe(0);
  });

  it("a second start reuses the in-flight state and restarts its TTL", async () => {
    const inFlight = randomBytes(OAUTH_STATE_BYTES).toString("base64url");

    const res = await app.request("/api/auth/github", {
      headers: { Cookie: `__Host-mergebrief_oauth_state=${inFlight}` },
    });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("state")).toBe(inFlight);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(
      setCookie.startsWith(`__Host-mergebrief_oauth_state=${inFlight};`),
    ).toBe(true);
    expect(setCookie).toContain("Max-Age=600");
  });

  it("callback lands home with github-unavailable when the user read fails", async () => {
    stubGitHub({
      token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      userStatus: 401,
    });
    const state = "state-user-read-fails";

    const res = await app.request(
      `/api/auth/github/callback?code=thecode&state=${state}`,
      { headers: { Cookie: `__Host-mergebrief_oauth_state=${state}` } },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?error=github-unavailable");
    expect(await countRows(harness, "auth_session")).toBe(0);
  });

  it("logs a wrong client secret at sign-in as an operator error", async () => {
    stubGitHub({ token: makeOAuthErrorBody("incorrect_client_credentials") });
    const capture = testLogging();
    const captureApp = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
    });
    const state = "state-wrong-client-secret";

    const res = await captureApp.request(
      `/api/auth/github/callback?code=thecode&state=${state}`,
      { headers: { Cookie: `__Host-mergebrief_oauth_state=${state}` } },
    );

    expect(res.status).toBe(302);
    const line = capture
      .lines()
      .find((entry) => entry["kind"] === "incorrect_client_credentials");
    expect(line?.["level"]).toBe("error");
  });

  it("a sign-in cancelled on GitHub lands home and keeps the state", async () => {
    const res = await app.request(
      "/api/auth/github/callback?error=access_denied&state=aaaa",
      { headers: { Cookie: "__Host-mergebrief_oauth_state=aaaa" } },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("stores both ciphertexts, refresh expiry and the session cookie", async () => {
    stubGitHub({ token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN) });
    const state = "matching-state-nonce";
    const before = Date.now();

    const res = await app.request(
      `/api/auth/github/callback?code=thecode&state=${state}`,
      {
        headers: { Cookie: `__Host-mergebrief_oauth_state=${state}` },
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");

    // Two Set-Cookie lines ride this response: the state clear, then the
    // session; `get` would join them, so the session one is picked out.
    const setCookie = res.headers.get("set-cookie") ?? "";
    const sessionCookie =
      res.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("__Host-mergebrief_session=")) ??
      "";
    expect(sessionCookie).not.toBe("");
    const stateClear = res.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-mergebrief_oauth_state="));
    expect(stateClear).toMatch(/Max-Age=0/i);
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).toContain("Path=/");
    expect(sessionCookie).not.toContain("Domain=");
    // No GitHub token/secret leaks into the response, only the opaque cookie.
    const body = await res.text();
    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, "test-client-secret"]) {
      expect(setCookie).not.toContain(secret);
      expect(body).not.toContain(secret);
    }

    const rows = await harness.raw("select * from auth_session");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(String(row?.["reviewer_id"])).toBe(String(REVIEWER_ID));
    // The credential pair lands on the linked grant row, sealed.
    const grantRows = await harness.raw("select * from github_grant");
    expect(grantRows).toHaveLength(1);
    expect(String(row?.["grant_id"])).toBe(String(grantRows[0]?.["id"]));
    expect(String(grantRows[0]?.["gh_token_ciphertext"])).toMatch(/^v2\./);
    expect(String(grantRows[0]?.["gh_refresh_token_ciphertext"])).toMatch(
      /^v2\./,
    );
    // Ciphertext at rest never equals the plaintext token.
    expect(String(grantRows[0]?.["gh_token_ciphertext"])).not.toContain(
      ACCESS_TOKEN,
    );
    // Session lifetime = refresh-token lifetime (~6mo out).
    const expiresAt = epochMs(row?.["expires_at"]);
    expect(expiresAt - before).toBeGreaterThan(15_000_000_000);
  });

  it("stores no grant when the session insert fails", async () => {
    stubGitHub({ token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN) });
    const own = await openPerTestPglite();
    await own.raw(
      "create function refuse_write() returns trigger language plpgsql as $$ begin raise exception 'refused'; end $$",
    );
    await own.raw(
      "create trigger refuse_session_insert before insert on auth_session for each row execute function refuse_write()",
    );
    // A process that dies after the grant insert runs no cleanup either.
    await own.raw(
      "create trigger refuse_grant_delete before delete on github_grant for each row execute function refuse_write()",
    );
    const failing = createApp({
      logger: testLogger(),
      handle: own.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
    });
    const state = "state-session-refused";

    const res = await failing.request(
      `/api/auth/github/callback?code=c&state=${state}`,
      {
        headers: { Cookie: `__Host-mergebrief_oauth_state=${state}` },
      },
    );

    expect(res.headers.get("location")).toBe("/?error=sign-in-failed");
    expect(await own.raw("select id from github_grant")).toEqual([]);
  });

  it("callback stores a session that names the reviewer and no installation", async () => {
    const fetchFn = stubGitHub({
      token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      installations: [{ id: INSTALLATION_ID }],
    });
    const state = "state-reviewer-only";
    const res = await app.request(
      `/api/auth/github/callback?code=c&state=${state}`,
      {
        headers: { Cookie: `__Host-mergebrief_oauth_state=${state}` },
      },
    );
    expect(res.status).toBe(302);
    const rows = await harness.raw("select reviewer_id from auth_session");
    expect(rows).toEqual([{ reviewer_id: REVIEWER_ID }]);
    // Sign-in reads the user only; the installations are each request's.
    const urls = fetchFn.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((url) => url.includes("/user/installations"))).toEqual(
      [],
    );
  });

  describe("who may sign in", () => {
    const LISTED_ACCOUNT = 9919;
    const OTHER_ACCOUNT = 7070;

    function buildListingApp(
      policy: Pick<AppDeps, "allowedAccess" | "operatorIds">,
    ): ApiApp {
      return createApp({
        logger: testLogger(),
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: buildAuthDeps(kp),
        ...UNUSED_INSTALLATION_DEPS,
        ...policy,
      });
    }

    async function signIn(listing: ApiApp): Promise<Response> {
      const state = "state-allowed-block";
      return listing.request(
        `/api/auth/github/callback?code=c&state=${state}`,
        { headers: { Cookie: `__Host-mergebrief_oauth_state=${state}` } },
      );
    }

    function listTokenDeletes(fetchFn: ReturnType<typeof vi.fn>): string[] {
      return fetchFn.mock.calls
        .filter((call) => {
          const init: unknown = call[1];
          if (typeof init !== "object" || init === null) {
            return false;
          }
          const isDelete = "method" in init && init.method === "DELETE";
          return isDelete;
        })
        .map((call) => String(call[0]));
    }

    const listingAccounts = {
      users: new Set<bigint>(),
      accounts: new Set([BigInt(LISTED_ACCOUNT)]),
    };

    it("refuses an unlisted account and revokes its token", async () => {
      const fetchFn = stubGitHub({
        token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
        installations: [{ id: INSTALLATION_ID, accountId: OTHER_ACCOUNT }],
      });

      const res = await signIn(
        buildListingApp({ allowedAccess: listingAccounts }),
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/?error=account-not-allowed");
      expect(res.headers.get("set-cookie") ?? "").not.toContain(
        "__Host-mergebrief_session=",
      );
      expect(await countRows(harness, "auth_session")).toBe(0);
      expect(await countRows(harness, "github_grant")).toBe(0);
      expect(listTokenDeletes(fetchFn)).toHaveLength(1);
    });

    it("refuses everyone on an instance with nothing configured", async () => {
      const fetchFn = stubGitHub({
        token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
        installations: [{ id: INSTALLATION_ID, accountId: LISTED_ACCOUNT }],
      });

      const res = await signIn(buildListingApp({}));

      expect(res.headers.get("location")).toBe("/?error=account-not-allowed");
      expect(await countRows(harness, "auth_session")).toBe(0);
      expect(listTokenDeletes(fetchFn)).toHaveLength(1);
    });

    it("signs in a viewer in a listed account's installation", async () => {
      stubGitHub({
        token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
        installations: [{ id: INSTALLATION_ID, accountId: LISTED_ACCOUNT }],
      });

      const res = await signIn(
        buildListingApp({ allowedAccess: listingAccounts }),
      );

      expect(res.headers.get("location")).toBe("/");
      expect(await countRows(harness, "auth_session")).toBe(1);
    });

    it("signs in a listed user with no installation read", async () => {
      const fetchFn = stubGitHub({
        token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
        installations: [],
      });

      const res = await signIn(
        buildListingApp({
          allowedAccess: {
            users: new Set([BigInt(REVIEWER_ID)]),
            accounts: new Set(),
          },
        }),
      );

      expect(res.headers.get("location")).toBe("/");
      const urls = fetchFn.mock.calls.map((call) => String(call[0]));
      expect(urls.filter((url) => url.includes("/user/installations"))).toEqual(
        [],
      );
    });

    it("signs in an Operator on no list", async () => {
      stubGitHub({
        token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
        installations: [],
      });

      const res = await signIn(
        buildListingApp({
          allowedAccess: listingAccounts,
          operatorIds: new Set([BigInt(REVIEWER_ID)]),
        }),
      );

      expect(res.headers.get("location")).toBe("/");
    });

    it("stores nothing when GitHub cannot answer the installation read", async () => {
      const fetchFn = vi.fn(async (input: string | URL | Request) => {
        const url = getRequestUrl(input);
        if (url.includes("/login/oauth/access_token")) {
          return jsonResponse(makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN));
        }
        if (url.endsWith("/user")) {
          return jsonResponse({ id: REVIEWER_ID, login: "octocat" });
        }
        if (url.includes("/user/installations")) {
          return jsonResponse({ message: "unavailable" }, 502);
        }
        return new Response(null, { status: 204 });
      });
      vi.stubGlobal("fetch", fetchFn);

      const res = await signIn(
        buildListingApp({ allowedAccess: listingAccounts }),
      );

      expect(res.headers.get("location")).toBe("/?error=github-unavailable");
      expect(await countRows(harness, "auth_session")).toBe(0);
      expect(listTokenDeletes(fetchFn)).toHaveLength(1);
    });
  });

  describe("a token rotation re-asks who may use the instance", () => {
    const LISTED_ACCOUNT = 9919;
    const listing = {
      allowedAccess: {
        users: new Set<bigint>(),
        accounts: new Set([BigInt(LISTED_ACCOUNT)]),
      },
    };

    async function rotate(
      policy: Pick<AppDeps, "allowedAccess" | "operatorIds"> = listing,
    ): Promise<boolean> {
      const { cookieHash } = await seedSignIn(harness.handle, kp);
      const resolved = await createSessionAuth(harness.handle).findSession(
        cookieHash,
      );
      if (resolved === undefined) {
        throw new Error("seeded session not found");
      }
      const result = await refreshSessionToken(
        { handle: harness.handle, auth: buildAuthDeps(kp), ...policy },
        derivePrincipalFromSession(resolved),
        testLogger(),
      );
      return result.ok;
    }

    it("ends every sign-in of an account no longer listed", async () => {
      const fetchFn = stubGitHub({
        token: makeTokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH),
        installations: [],
      });

      expect(await rotate()).toBe(false);

      expect(await countRows(harness, "auth_session")).toBe(0);
      const urls = fetchFn.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("/token"))).toBe(true);
    });

    it("keeps a viewer whose account is still listed", async () => {
      stubGitHub({
        token: makeTokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH),
        installations: [{ id: INSTALLATION_ID, accountId: LISTED_ACCOUNT }],
      });

      expect(await rotate()).toBe(true);

      expect(await countRows(harness, "auth_session")).toBe(1);
    });

    it("destroys nothing when the config names nobody", async () => {
      const fetchFn = stubGitHub({
        token: makeTokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH),
        installations: [],
      });

      expect(await rotate({})).toBe(true);

      expect(await countRows(harness, "auth_session")).toBe(1);
      const urls = fetchFn.mock.calls.map((call) => String(call[0]));
      expect(urls.filter((url) => url.includes("/user/installations"))).toEqual(
        [],
      );
    });

    it("keeps the session when GitHub cannot answer the read", async () => {
      stubGitHub({
        token: makeTokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH),
        installationsStatus: 502,
      });

      expect(await rotate()).toBe(true);

      expect(await countRows(harness, "auth_session")).toBe(1);
    });
  });

  it("logout deletes the session and its orphaned grant, clearing the cookie", async () => {
    stubTokenDelete(204);
    const { cookie: token } = await seedSignIn(harness.handle, kp);
    expect(await countRows(harness, "auth_session")).toBe(1);

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${token}`,
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
    expect(await countRows(harness, "auth_session")).toBe(0);
    // Last-referent lifecycle: the grant died with its only referent.
    expect(await countRows(harness, "github_grant")).toBe(0);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith("__Host-mergebrief_session=")).toBe(true);
    expect(setCookie).toContain("Secure");
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it("logout from a foreign origin answers 403 and keeps the session", async () => {
    const { cookie } = await seedSignIn(harness.handle, kp);
    const capture = testLogging();
    const loggedApp = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
    });

    // A foreign Origin rides along so the last assertion can catch it.
    const res = await loggedApp.request("/api/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `__Host-mergebrief_session=${cookie}`,
        "sec-fetch-site": "cross-site",
        origin: "https://evil.example.test",
      },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("forbidden");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await countRows(harness, "auth_session")).toBe(1);
    // The refusal is as visible as the layer's: the access decision and one
    // warn line, never the Origin value itself.
    const lines = capture.lines();
    const access = lines.find((line) => line["evt"] === "api.access");
    expect(access?.["decision"]).toBe("403-cross-origin");
    const warned = lines.find((line) => line["level"] === "warn");
    expect(warned?.["msg"]).toBe(
      "cookie mutation refused: origin is not this instance",
    );
    expect(JSON.stringify(lines)).not.toContain("evil.example.test");
  });

  it("logout from a sibling subdomain answers 403", async () => {
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `__Host-mergebrief_session=${cookie}`,
        "sec-fetch-site": "same-site",
        origin: "https://evil.example.test",
      },
    });

    expect(res.status).toBe(403);
    expect(await countRows(harness, "auth_session")).toBe(1);
  });

  it("logout with the instance's own Origin goes through", async () => {
    stubTokenDelete(204);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `__Host-mergebrief_session=${cookie}`,
        origin: "https://app.example.test",
      },
    });

    expect(res.status).toBe(204);
    expect(await countRows(harness, "auth_session")).toBe(0);
  });

  it("logout revokes the last session's token at GitHub", async () => {
    const fetchFn = stubTokenDelete(204);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await logOut(app, cookie);

    expect(res.status).toBe(204);
    expect(readTokenDeleteCalls(fetchFn)).toEqual([
      {
        url: "https://api.github.com/applications/Iv1.test-client-id/token",
        method: "DELETE",
        body: { access_token: ACCESS_TOKEN },
      },
    ]);
  });

  it("logout keeps the GitHub token while a CLI token rides the grant", async () => {
    const fetchFn = stubTokenDelete(204);
    const signIn = await seedSignIn(harness.handle, kp);
    await makeTokenOnGrant(signIn.grantId);

    const res = await logOut(app, signIn.cookie);

    expect(res.status).toBe(204);
    expect(readTokenDeleteCalls(fetchFn)).toEqual([]);
    expect(await countRows(harness, "github_grant")).toBe(1);
  });

  it("logout revokes at GitHub when the grant's only CLI token is revoked", async () => {
    const fetchFn = stubTokenDelete(204);
    const signIn = await seedSignIn(harness.handle, kp);
    const tokens = createTokenAuth(harness.handle);
    const minted = await tokens.mintToken({
      scope: AccessLevels.READ,
      userId: brandReviewerId(BigInt(REVIEWER_ID)),
      name: "revoked-first",
      tokenHash: hashSha256Hex(randomBytes(32).toString("base64url")),
      grantId: signIn.grantId,
      expiresAt: null,
    });
    await tokens.revokeToken(signIn.reviewerId, minted.id, new Date());

    const res = await logOut(app, signIn.cookie);

    expect(res.status).toBe(204);
    expect(readTokenDeleteCalls(fetchFn)).toHaveLength(1);
  });

  it("logout revokes at GitHub when the grant's only CLI token expired", async () => {
    const fetchFn = stubTokenDelete(204);
    const signIn = await seedSignIn(harness.handle, kp);
    await createTokenAuth(harness.handle).mintToken({
      scope: AccessLevels.READ,
      userId: brandReviewerId(BigInt(REVIEWER_ID)),
      name: "expired",
      tokenHash: hashSha256Hex(randomBytes(32).toString("base64url")),
      grantId: signIn.grantId,
      expiresAt: new Date("2000-01-01T00:00:00Z"),
    });

    const res = await logOut(app, signIn.cookie);

    expect(res.status).toBe(204);
    expect(readTokenDeleteCalls(fetchFn)).toHaveLength(1);
  });

  it("logout still answers 204 when GitHub refuses the token delete", async () => {
    stubTokenDelete(500);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const capture = testLogging();
    const loggedApp = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
    });

    const res = await logOut(loggedApp, cookie);

    expect(res.status).toBe(204);
    expect(await countRows(harness, "auth_session")).toBe(0);
    expect(await countRows(harness, "github_grant")).toBe(0);
    const line = capture
      .lines()
      .find((entry) => entry["evt"] === "grant.revoke.fail");
    expect(line?.["level"]).toBe("warn");
    expect(line?.["code"]).toBe("token-delete-failed");
    expect(JSON.stringify(capture.lines())).not.toContain(ACCESS_TOKEN);
  });

  it("logout still answers 204 when the token delete hangs", async () => {
    vi.stubGlobal("fetch", vi.fn(stubHangingFetch));
    const { cookie } = await seedSignIn(harness.handle, kp);
    const capture = testLogging();
    const boundedApp = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: { ...buildAuthDeps(kp), oauthRequestTimeoutMs: SHORT_TIMEOUT_MS },
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
    });

    const res = await logOut(boundedApp, cookie);

    expect(res.status).toBe(204);
    expect(
      capture.lines().some((entry) => entry["evt"] === "grant.revoke.fail"),
    ).toBe(true);
  });

  it("an expired session's grant is revoked at GitHub on its 401", async () => {
    const fetchFn = stubTokenDelete(204);
    const { cookie } = await seedSignIn(harness.handle, kp, {
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.request("/api/version", {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });

    expect(res.status).toBe(401);
    expect(readTokenDeleteCalls(fetchFn)).toHaveLength(1);
  });

  it("a token copied into another grant's row answers 500 and is never used", async () => {
    const fetchFn = stubTokenDelete(204);
    const victimToken = "ghu_VICTIM_TOKEN_PLAINTEXT";
    const victim = await seedSignIn(harness.handle, kp, {
      accessToken: victimToken,
    });
    const target = await seedSignIn(harness.handle, kp, {
      reviewer: { id: brandReviewerId(556n), login: "mallory" },
    });
    await harness.raw(
      "update github_grant set gh_token_ciphertext = (select gh_token_ciphertext from github_grant where id = $1) where id = $2",
      [victim.grantId, target.grantId],
    );
    const capture = testLogging();
    const capturedApp = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
    });

    const res = await capturedApp.request("/api/repos", {
      headers: { Cookie: `__Host-mergebrief_session=${target.cookie}` },
    });

    expect(res.status).toBe(500);
    const sessions = await harness.raw(
      "select id from auth_session where session_token_hash = $1",
      [target.cookieHash],
    );
    expect(sessions).toHaveLength(1);
    expect(JSON.stringify(fetchFn.mock.calls)).not.toContain(victimToken);
    const decryptFailures = capture
      .lines()
      .filter((entry) => entry["evt"] === "token.decrypt.fail");
    expect(decryptFailures).toHaveLength(1);
  });

  it("GET /api/auth/session without a cookie answers 401", async () => {
    const res = await app.request("/api/auth/session");
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/session with a live session answers the viewer", async () => {
    const { cookie: token } = await seedSignIn(harness.handle, kp);

    const res = await app.request("/api/auth/session", {
      headers: { cookie: `__Host-mergebrief_session=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      viewer: {
        login: "octocat",
        avatarUrl: expect.stringMatching(
          /^https:\/\/avatars\.githubusercontent\.com\/u\/\d+$/,
        ),
      },
      operator: false,
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("GET /api/auth/session marks a viewer the config lists as an Operator", async () => {
    const { cookie: token, reviewerId } = await seedSignIn(harness.handle, kp);
    const operatorApp = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      operatorIds: new Set([reviewerId]),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
    });

    const res = await operatorApp.request("/api/auth/session", {
      headers: { cookie: `__Host-mergebrief_session=${token}` },
    });

    expect(await res.json()).toMatchObject({ operator: true });
  });

  it("refresh rotates both ciphertexts and returns the fresh access token", async () => {
    stubGitHub({ token: makeTokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH) });
    // The observed access ciphertext still matches the stored row (no concurrent
    // rotation), so the compare-and-swap guard lets a real refresh proceed.
    const { cookieHash: hash } = await seedSignIn(harness.handle, kp, {
      expiresAt: new Date("2000-01-01T00:00:00Z"),
    });
    const before = await harness.raw(
      "select gh_token_ciphertext from github_grant",
    );
    const beforeCipher = String(before[0]?.["gh_token_ciphertext"]);

    const resolved = await createSessionAuth(harness.handle).findSession(hash);
    if (resolved === undefined) {
      throw new Error("seeded session not found");
    }
    const result = await refreshSessionToken(
      {
        handle: harness.handle,
        auth: buildAuthDeps(kp),
        ...LISTED_REVIEWER_DEPS,
      },
      derivePrincipalFromSession(resolved),
      testLogger(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.accessToken).toBe(ROTATED_ACCESS);

    // The rotation lands on the GRANT row; the session row mirrors the
    // rotated refresh-token lifetime onto its own expires_at.
    const after = await harness.raw(
      "select gh_token_ciphertext, gh_refresh_token_ciphertext from github_grant",
    );
    const afterAccessCipher = String(after[0]?.["gh_token_ciphertext"]);
    expect(afterAccessCipher).not.toBe(beforeCipher);
    // The rotated access ciphertext decrypts back to the rotated plaintext.
    const grantId = resolved.grant.id;
    const decrypted = await decryptToken(kp, KEY_REF, afterAccessCipher, {
      grantId,
      column: GrantSealedColumns.ACCESS_TOKEN,
    });
    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) {
      throw new Error("unreachable");
    }
    expect(decrypted.value).toBe(ROTATED_ACCESS);
    // Rotated refresh ciphertext decrypts to the rotated refresh plaintext.
    const decryptedR = await decryptToken(
      kp,
      KEY_REF,
      String(after[0]?.["gh_refresh_token_ciphertext"]),
      { grantId, column: GrantSealedColumns.REFRESH_TOKEN },
    );
    if (!decryptedR.ok) {
      throw new Error("unreachable");
    }
    expect(decryptedR.value).toBe(ROTATED_REFRESH);
    // Session expiry mirrored forward to the new refresh-token expiry.
    const sessionRow = await harness.raw("select expires_at from auth_session");
    expect(epochMs(sessionRow[0]?.["expires_at"])).toBeGreaterThan(Date.now());
  });

  async function makeTokenOnGrant(
    grantId: GithubGrantRow["id"],
  ): Promise<string> {
    const tokenHash = hashSha256Hex(randomBytes(32).toString("base64url"));
    await createTokenAuth(harness.handle).mintToken({
      scope: AccessLevels.EXTERNAL_WRITE,
      userId: brandReviewerId(BigInt(REVIEWER_ID)),
      name: "rides-the-grant",
      tokenHash,
      grantId,
      expiresAt: null,
    });
    return tokenHash;
  }

  async function makeCookiePrincipal(
    cookieHash: string,
  ): Promise<ViewerPrincipal> {
    const resolved = await createSessionAuth(harness.handle).findSession(
      cookieHash,
    );
    if (resolved === undefined) {
      throw new Error("seeded session not found");
    }
    return derivePrincipalFromSession(resolved);
  }

  async function makeBearerPrincipal(
    tokenHash: string,
  ): Promise<ViewerPrincipal> {
    const live = await createTokenAuth(harness.handle).resolveByHash(
      tokenHash,
      new Date(),
    );
    if (live === undefined) {
      throw new Error("seeded token did not resolve");
    }
    return derivePrincipalFromApiToken(live);
  }

  async function readRevokedAt(): Promise<unknown[]> {
    const rows = await harness.raw("select revoked_at from api_token");
    return rows.map((row) => row["revoked_at"]);
  }

  it("retires the grant when GitHub rejects the cookie's refresh token", async () => {
    stubGitHub({ token: BAD_REFRESH_TOKEN_BODY });
    const signIn = await seedSignIn(harness.handle, kp, { expiresAt: PAST });
    await makeTokenOnGrant(signIn.grantId);
    const principal = await makeCookiePrincipal(signIn.cookieHash);
    const capture = testLogging();

    const result = await refreshSessionToken(
      {
        handle: harness.handle,
        auth: buildAuthDeps(kp),
        ...LISTED_REVIEWER_DEPS,
      },
      principal,
      capture.logger,
    );

    expect(readRefreshErrorCode(result)).toBe(RefreshErrorCodes.GRANT_DEAD);
    expect(await countRows(harness, "auth_session")).toBe(0);
    expect(await readRevokedAt()).toEqual([expect.any(Date)]);
    const line = capture.lines().find((l) => l["evt"] === "token.refresh.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["reviewerId"]).toBe(String(principal.reviewerId));
  });

  it("retires the grant when GitHub rejects a Bearer token's refresh", async () => {
    stubGitHub({ token: BAD_REFRESH_TOKEN_BODY });
    const signIn = await seedSignIn(harness.handle, kp);
    const tokenHash = await makeTokenOnGrant(signIn.grantId);
    const principal = await makeBearerPrincipal(tokenHash);

    const result = await refreshSessionToken(
      {
        handle: harness.handle,
        auth: buildAuthDeps(kp),
        ...LISTED_REVIEWER_DEPS,
      },
      principal,
      testLogger(),
    );

    expect(readRefreshErrorCode(result)).toBe(RefreshErrorCodes.GRANT_DEAD);
    expect(await countRows(harness, "auth_session")).toBe(0);
    expect(await readRevokedAt()).toEqual([expect.any(Date)]);
  });

  it("keeps the session and tokens when GitHub answers the refresh 502", async () => {
    stubGitHub({
      token: makeTokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH),
      tokenStatus: 502,
    });
    const signIn = await seedSignIn(harness.handle, kp);
    await makeTokenOnGrant(signIn.grantId);
    const principal = await makeCookiePrincipal(signIn.cookieHash);
    const capture = testLogging();

    const result = await refreshSessionToken(
      {
        handle: harness.handle,
        auth: buildAuthDeps(kp),
        ...LISTED_REVIEWER_DEPS,
      },
      principal,
      capture.logger,
    );

    expect(readRefreshErrorCode(result)).toBe(RefreshErrorCodes.UNAVAILABLE);
    expect(await countRows(harness, "auth_session")).toBe(1);
    expect(await readRevokedAt()).toEqual([null]);
    const line = capture
      .lines()
      .find((l) => l["evt"] === "token.refresh.unavailable");
    expect(line?.["level"]).toBe("warn");
  });

  it("answers unavailable once a hung refresh passes the request bound", async () => {
    vi.stubGlobal("fetch", vi.fn(stubHangingFetch));
    const signIn = await seedSignIn(harness.handle, kp);
    const principal = await makeCookiePrincipal(signIn.cookieHash);

    const result = await refreshSessionToken(
      {
        handle: harness.handle,
        auth: { ...buildAuthDeps(kp), oauthRequestTimeoutMs: SHORT_TIMEOUT_MS },
      },
      principal,
      testLogger(),
    );

    expect(readRefreshErrorCode(result)).toBe(RefreshErrorCodes.UNAVAILABLE);
    expect(await countRows(harness, "auth_session")).toBe(1);
  });

  it("keeps the session when the session key cannot open the grant", async () => {
    const fetchFn = stubGitHub({
      token: makeTokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH),
    });
    const signIn = await seedSignIn(harness.handle, kp);
    const principal = await makeCookiePrincipal(signIn.cookieHash);
    const capture = testLogging();

    const result = await refreshSessionToken(
      { handle: harness.handle, auth: buildAuthDeps(createKeyProvider()) },
      principal,
      capture.logger,
    );

    expect(readRefreshErrorCode(result)).toBe(RefreshErrorCodes.CRYPTO_FAILED);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await countRows(harness, "auth_session")).toBe(1);
    expect(await countRows(harness, "github_grant")).toBe(1);
    const line = capture.lines().find((l) => l["evt"] === "token.decrypt.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["reviewerId"]).toBe(String(principal.reviewerId));
    expect(
      capture.lines().find((l) => l["evt"] === "token.refresh.fail"),
    ).toBeUndefined();
  });

  it("keeps the session when the rotated tokens cannot be sealed", async () => {
    stubGitHub({ token: makeTokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH) });
    const signIn = await seedSignIn(harness.handle, kp);
    const principal = await makeCookiePrincipal(signIn.cookieHash);
    const capture = testLogging();

    const result = await refreshSessionToken(
      {
        handle: harness.handle,
        auth: { ...buildAuthDeps(kp), sessionKeyRef: "SESSION_KEY_UNSET" },
      },
      principal,
      capture.logger,
    );

    expect(readRefreshErrorCode(result)).toBe(RefreshErrorCodes.CRYPTO_FAILED);
    expect(await countRows(harness, "auth_session")).toBe(1);
    const line = capture.lines().find((l) => l["evt"] === "token.refresh.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["kind"]).toBe("seal-failed");
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
    const { cookieHash: hash } = await seedSignIn(harness.handle, kp, {
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    const stale = await createSessionAuth(harness.handle).findSession(hash);
    if (stale === undefined) {
      throw new Error("seeded session not found");
    }

    // Another channel wins the rotation while our principal is in flight.
    const rotatedExpiry = new Date("2027-09-01T00:00:00Z");
    const sealedAccess = await encryptToken(kp, KEY_REF, ROTATED_ACCESS, {
      grantId: stale.grant.id,
      column: GrantSealedColumns.ACCESS_TOKEN,
    });
    const sealedRefresh = await encryptToken(kp, KEY_REF, ROTATED_REFRESH, {
      grantId: stale.grant.id,
      column: GrantSealedColumns.REFRESH_TOKEN,
    });
    if (!sealedAccess.ok || !sealedRefresh.ok) {
      throw new Error("seed encrypt failed");
    }
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
    if (!rotated.ok) {
      throw new Error("out-of-band rotation failed");
    }

    const result = await refreshSessionToken(
      {
        handle: harness.handle,
        auth: buildAuthDeps(kp),
        ...LISTED_REVIEWER_DEPS,
      },
      derivePrincipalFromSession(stale), // still carries the PRE-rotation ciphertext
      testLogger(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
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
    stubGitHub({ token: makeTokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH) });
    const { cookieHash: hash } = await seedSignIn(harness.handle, kp, {
      expiresAt: new Date("2000-01-01T00:00:00Z"),
    });
    const resolved = await createSessionAuth(harness.handle).findSession(hash);
    if (resolved === undefined) {
      throw new Error("seeded session not found");
    }
    // A minted token shares the grant, so the grant SURVIVES the logout and
    // the rotation proceeds, only the session-expiry mirror can notice.
    await createTokenAuth(harness.handle).mintToken({
      scope: AccessLevels.EXTERNAL_WRITE,
      userId: brandReviewerId(BigInt(REVIEWER_ID)),
      name: "shares-the-grant",
      tokenHash: hashSha256Hex(randomBytes(32).toString("base64url")),
      grantId: resolved.session.grantId,
      expiresAt: null,
    });
    // Logout lands between resolution and refresh.
    await createSessionAuth(harness.handle).deleteSession(hash);

    const result = await refreshSessionToken(
      {
        handle: harness.handle,
        auth: buildAuthDeps(kp),
        ...LISTED_REVIEWER_DEPS,
      },
      derivePrincipalFromSession(resolved),
      testLogger(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe("not-found");
    // The rotation itself stood, it benefits the surviving token referent.
    const grantRow = await harness.raw(
      "select gh_token_ciphertext from github_grant",
    );
    const decrypted = await decryptToken(
      kp,
      KEY_REF,
      String(grantRow[0]?.["gh_token_ciphertext"]),
      { grantId: resolved.grant.id, column: GrantSealedColumns.ACCESS_TOKEN },
    );
    if (!decrypted.ok) {
      throw new Error("unreachable");
    }
    expect(decrypted.value).toBe(ROTATED_ACCESS);
  });

  it("bearer refresh denies a token revoked mid-rotation and keeps the row", async () => {
    stubGitHub({ token: makeTokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH) });
    const grant = await seedGrant(harness.handle, {
      userId: brandReviewerId(BigInt(REVIEWER_ID)),
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      keyProvider: kp,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    const bearerHash = hashSha256Hex(randomBytes(32).toString("base64url"));
    const minted = await createTokenAuth(harness.handle).mintToken({
      scope: AccessLevels.EXTERNAL_WRITE,
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
    if (live === undefined) {
      throw new Error("seeded token did not resolve");
    }
    const principal = derivePrincipalFromApiToken(live);
    // The owner revokes while the request is in flight.
    const revoked = await createTokenAuth(harness.handle).revokeToken(
      brandReviewerId(BigInt(REVIEWER_ID)),
      minted.id,
      new Date(),
    );
    if (revoked === undefined) {
      throw new Error("revoke failed");
    }

    const capture = testLogging();
    const result = await refreshSessionToken(
      {
        handle: harness.handle,
        auth: buildAuthDeps(kp),
        ...LISTED_REVIEWER_DEPS,
      },
      principal,
      capture.logger,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
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

const PAST = new Date("2000-01-01T00:00:00Z");
const SHORT_TIMEOUT_MS = 20;

function readRefreshErrorCode(
  result: Awaited<ReturnType<typeof refreshSessionToken>>,
): string {
  if (result.ok) {
    throw new Error("expected the refresh to fail");
  }
  return result.error.code;
}

/** GitHub's token-delete endpoint answering `status`, every call recorded. */
function stubTokenDelete(status: number): ReturnType<typeof vi.fn> {
  const fetchFn = vi.fn(async () => {
    if (status === 204) {
      return new Response(null, { status });
    }
    return jsonResponse({ message: "refused" }, status);
  });
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

interface TokenDeleteCall {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: unknown;
}

function readTokenDeleteCalls(
  fetchFn: ReturnType<typeof vi.fn>,
): TokenDeleteCall[] {
  return fetchFn.mock.calls
    .map((call) => {
      const [input, init] = call as [string | URL | Request, RequestInit?];
      return {
        url: getRequestUrl(input),
        method: init?.method,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
    })
    .filter((call) => call.url.includes("/applications/"));
}

async function logOut(app: ApiApp, cookie: string): Promise<Response> {
  return app.request("/api/auth/logout", {
    method: "POST",
    headers: {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `__Host-mergebrief_session=${cookie}`,
    },
  });
}

/** A GitHub that never answers: only the request's abort signal ends it. */
function stubHangingFetch(
  _input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(init.signal?.reason);
    });
  });
}

function epochMs(cell: unknown): number {
  if (cell instanceof Date) {
    return cell.getTime();
  }
  if (typeof cell === "string") {
    return new Date(cell).getTime();
  }
  throw new Error(`expected a timestamp cell, got ${typeof cell}`);
}

async function countRows(
  harness: SharedPglite,
  table: string,
): Promise<number> {
  const rows = await harness.raw(`select count(*)::int as n from ${table}`);
  const n = rows[0]?.["n"];
  if (typeof n !== "number") {
    throw new Error(`unexpected count result for ${table}`);
  }
  return n;
}
