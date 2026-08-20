// API tokens as a second presentation channel. Two surfaces, one auth model:
//   1. Bearer presentation: `Authorization: Bearer mergebrief_...` resolves
//      through `tokenAuth` into the SAME principal shape a cookie session
//      yields, on `/api/*` only. Miss/expired/revoked/garbage → hint-free 401.
//      Refresh-once mid-request rides the same spendRefresh machinery; the
//      token's own expiry never moves.
//   2. `/api/auth/tokens` mint/list/revoke: cookie-authed ONLY (Bearer on /api/auth/*
//      is ignored), mint validates the installation against the viewer's LIVE
//      accessible set, token material is returned exactly once.
// Same harness as installations.test.ts: `app.request()` over PGlite, GitHub
// stubbed at the global-fetch boundary.
import { createHash, randomBytes } from "node:crypto";
import {
  encryptToken,
  envKeyProvider,
  forTenant,
  grantAuth,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrState,
  tokenAuth,
  WriteClassification,
  type AppDatabase,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { testLogger, testLogging } from "./logging";

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_A = 42001;

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

function brand<T extends bigint>(
  guard: (v: bigint) => v is T,
  value: number,
): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) throw new Error("bad branded id");
  return asBigInt;
}

const CTX: TenantContext = {
  installationId: brand(isInstallationId, INSTALLATION_ID),
};
const REVIEWER: ReviewerId = brand(isReviewerId, REVIEWER_ID);

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

/** `GET /user/installations/{id}/repositories` (the /api/pulls allowed set). */
function installationReposOk(
  repos: ReadonlyArray<{ id: number; full_name: string }>,
): Response {
  return jsonResponse({ total_count: repos.length, repositories: repos });
}

/** `GET /user/installations` (the live accessible set for minting). */
function userInstallationsOk(
  items: ReadonlyArray<{ id: number; login: string }>,
): Response {
  return jsonResponse({
    total_count: items.length,
    installations: items.map((i) => ({
      id: i.id,
      account: { login: i.login },
    })),
  });
}

const TOKEN_SUCCESS = {
  access_token: ROTATED_ACCESS,
  refresh_token: ROTATED_REFRESH,
  expires_in: 28_800,
  refresh_token_expires_in: 15_897_600,
  token_type: "bearer",
  scope: "",
};

interface StubConfig {
  /** `GET /user/installations/{id}/repositories` responses per call. */
  readonly installationRepos?: (call: number) => Response;
  /** `GET /user/installations` responses per call. */
  readonly userInstallations?: (call: number) => Response;
  /** OAuth token endpoint (refresh) responses per call. */
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  installationRepos: number;
  userInstallations: number;
  token: number;
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = {
    installationRepos: 0,
    userInstallations: 0,
    token: 0,
  };
  const fetchFn = vi.fn(
    async (input: string | URL | Request): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/login/oauth/access_token")) {
        const i = counts.token++;
        return cfg.token
          ? cfg.token(i)
          : jsonResponse({ error: "unexpected_token" }, 500);
      }
      if (
        url.includes("/user/installations/") &&
        url.includes("/repositories")
      ) {
        const i = counts.installationRepos++;
        return cfg.installationRepos
          ? cfg.installationRepos(i)
          : jsonResponse({ message: "nope" }, 500);
      }
      if (url.includes("/user/installations")) {
        const i = counts.userInstallations++;
        return cfg.userInstallations
          ? cfg.userInstallations(i)
          : jsonResponse({ message: "nope" }, 500);
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Seed an api_token row directly; returns the Bearer plaintext. */
async function seedApiToken(
  handle: AppDatabase,
  kp: KeyProvider,
  overrides: { expiresAt?: Date | null; revoke?: boolean } = {},
): Promise<string> {
  const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok)
    throw new Error("seed encrypt failed");
  const grant = await grantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  const minted = await tokenAuth(handle).mintToken({
    scope: WriteClassification.EXTERNAL_WRITE,
    installationId: CTX.installationId,
    userId: REVIEWER,
    userLogin: "octocat",
    name: "ci-token",
    tokenHash: sha256Hex(plaintext),
    grantId: grant.id,
    expiresAt:
      overrides.expiresAt === undefined
        ? new Date("2027-01-01T00:00:00Z")
        : overrides.expiresAt,
  });
  if (overrides.revoke === true) {
    const revoked = await tokenAuth(handle).revokeToken(
      REVIEWER,
      minted.id,
      new Date(),
    );
    if (!revoked.ok) throw new Error("seed revoke failed");
  }
  return plaintext;
}

async function seedPr(handle: AppDatabase): Promise<void> {
  await forTenant(handle, CTX).pullRequests.upsert({
    repoId: brand(isRepoId, REPO_A),
    prNumber: 7,
    repoSlug: "octo/hello",
    title: "PR 7",
    state: PrState.OPEN,
  });
}

// Conversation port stub: these tests never exercise the conversation read.
const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
};

describe("Bearer presentation on /api/*", () => {
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

  async function getWithBearer(
    path: string,
    bearer: string,
  ): Promise<Response> {
    return app.request(path, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
  }

  it("authenticates a valid token through the full gate to a real read", async () => {
    stubGitHub({
      installationRepos: () =>
        installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
    });
    await seedPr(harness.handle);
    const bearer = await seedApiToken(harness.handle, kp);

    const res = await getWithBearer("/api/pulls", bearer);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { pulls: Array<{ prNumber: number }> };
    expect(body.pulls).toHaveLength(1);
    expect(body.pulls[0]?.prNumber).toBe(7);
  });

  it("401s garbage, unknown, expired, and revoked tokens with the same hint-free body", async () => {
    stubGitHub({});
    const expired = await seedApiToken(harness.handle, kp, {
      expiresAt: new Date("2020-01-01T00:00:00Z"),
    });
    // Distinct plaintexts so the revoked seed does not collide on token_hash.
    const revoked = await seedApiToken(harness.handle, kp, { revoke: true });

    for (const bearer of [
      "not-even-prefixed",
      `mergebrief_${randomBytes(32).toString("base64url")}`, // unknown
      expired,
      revoked,
    ]) {
      const res = await getWithBearer("/api/pulls", bearer);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "unauthorized",
        code: "unauthorized",
      });
    }
  });

  it("ignores Bearer on /api/auth/* — the browser-only surface never resolves tokens", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
    });
    const bearer = await seedApiToken(harness.handle, kp);
    const res = await app.request("/api/auth/installations", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(res.status).toBe(401);
  });

  it("refreshes ONCE mid-request on an expired GitHub access token, without moving the token's own expiry", async () => {
    const counts = stubGitHub({
      installationRepos: (call) =>
        call === 0
          ? jsonResponse({ message: "Bad credentials" }, 401)
          : installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
      token: () => jsonResponse(TOKEN_SUCCESS),
    });
    await seedPr(harness.handle);
    const bearer = await seedApiToken(harness.handle, kp);
    const beforeGrant = await harness.raw(
      "select gh_token_ciphertext from github_grant limit 1",
    );
    const beforeToken = await harness.raw(
      "select expires_at from api_token limit 1",
    );

    const res = await getWithBearer("/api/pulls", bearer);
    expect(res.status).toBe(200);
    expect(counts.token).toBe(1);
    expect(counts.installationRepos).toBe(2);

    const afterGrant = await harness.raw(
      "select gh_token_ciphertext from github_grant limit 1",
    );
    const afterToken = await harness.raw(
      "select expires_at from api_token limit 1",
    );
    // Credentials rotated on the grant row the api_token references...
    expect(afterGrant[0]?.["gh_token_ciphertext"]).not.toBe(
      beforeGrant[0]?.["gh_token_ciphertext"],
    );
    // ...while the mint-chosen expiry is untouched by GitHub rotation.
    expect(afterToken[0]?.["expires_at"]).toEqual(
      beforeToken[0]?.["expires_at"],
    );
    expect(
      await harness.raw("select count(*)::int as n from auth_session"),
    ).toEqual([{ n: 0 }]);
  });

  it("emits token.refresh.fail on the bearer channel when GitHub rejects the rotation", async () => {
    stubGitHub({
      // Every data call 401s (expired access token) and the rotation itself
      // is rejected — the refresh orchestrator's bearer-channel hard failure.
      installationRepos: () =>
        jsonResponse({ message: "Bad credentials" }, 401),
      token: () =>
        jsonResponse({
          error: "bad_refresh_token",
          error_description: "The refresh token is expired",
          error_uri: "https://docs.github.com/",
        }),
    });
    await seedPr(harness.handle);
    const capture = testLogging();
    const captureApp = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: authDeps(kp),
      github: unusedConversationPort,
    });
    const bearer = await seedApiToken(harness.handle, kp);

    const res = await captureApp.request("/api/pulls", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(res.status).toBe(401);
    // Alert contract: the bearer fork emits the same evt as the
    // cookie flow — operators key alerts off token.refresh.fail.
    const line = capture.lines().find((l) => l["evt"] === "token.refresh.fail");
    expect(line?.["level"]).toBe("error");
    expect(typeof line?.["reviewerId"]).toBe("string");
    // The api_token row is NOT deleted on failure — user-managed credential.
    expect(
      await harness.raw("select count(*)::int as n from api_token"),
    ).toEqual([{ n: 1 }]);
  });

  it("touches last_used_at on use, throttled within the window", async () => {
    stubGitHub({
      installationRepos: () =>
        installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
    });
    await seedPr(harness.handle);
    const bearer = await seedApiToken(harness.handle, kp);

    expect((await getWithBearer("/api/pulls", bearer)).status).toBe(200);
    // The touch is fire-and-forget (never awaited on the request path) — poll.
    await vi.waitFor(async () => {
      const touched = await harness.raw(
        "select last_used_at from api_token limit 1",
      );
      expect(touched[0]?.["last_used_at"]).not.toBeNull();
    });

    // Clear the stamp out-of-band: a second request inside the throttle window
    // must NOT re-touch (the throttle, not the DB write, is under test).
    await harness.raw("update api_token set last_used_at = null");
    expect((await getWithBearer("/api/pulls", bearer)).status).toBe(200);
    const throttled = await harness.raw(
      "select last_used_at from api_token limit 1",
    );
    expect(throttled[0]?.["last_used_at"]).toBeNull();
  });
});

describe("/api/auth/tokens mint / list / revoke (cookie-only)", () => {
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

  /** Seed a cookie session; returns the cookie plaintext. */
  async function seedSession(): Promise<string> {
    const cookie = randomBytes(32).toString("base64url");
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
    await forTenant(harness.handle, CTX).sessions.create({
      sessionTokenHash: sha256Hex(cookie),
      reviewerId: REVIEWER,
      reviewerLogin: "octocat",
      grantId: grant.id,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    return cookie;
  }

  async function mint(body: unknown, cookie?: string): Promise<Response> {
    return app.request("/api/auth/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie === undefined ? {} : { Cookie: `rs_session=${cookie}` }),
      },
      body: JSON.stringify(body),
    });
  }

  interface MintedBody {
    readonly token: string;
    readonly apiToken: {
      readonly id: string;
      readonly expiresAt: string | null;
    };
  }

  it("mints a token shown exactly once, stored hash-only, usable as Bearer", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
      installationRepos: () =>
        installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
    });
    await seedPr(harness.handle);
    const cookie = await seedSession();

    const res = await mint(
      { name: "ci-token", installationId: INSTALLATION_ID },
      cookie,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as MintedBody;
    expect(body.token.startsWith("mergebrief_")).toBe(true);

    // Hash-only storage: the DB row carries sha256(token), never the token.
    const rows = await harness.raw(
      "select token_hash, grant_id from api_token",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["token_hash"]).toBe(sha256Hex(body.token));

    // Link-never-copy: mint linked the SESSION's grant — one physical
    // pair exists after the mint, and the token row points at it.
    const grantRows = await harness.raw("select id from github_grant");
    expect(grantRows).toHaveLength(1);
    expect(String(rows[0]?.["grant_id"])).toBe(String(grantRows[0]?.["id"]));
    const sessionRows = await harness.raw("select grant_id from auth_session");
    expect(String(sessionRows[0]?.["grant_id"])).toBe(
      String(grantRows[0]?.["id"]),
    );

    // Default expiry ≈ 90 days out.
    const expiresAt = body.apiToken.expiresAt;
    if (expiresAt === null) throw new Error("expected a default expiry");
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);

    // The minted token authenticates on /api/* immediately.
    const read = await app.request("/api/pulls", {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(read.status).toBe(200);

    // The list never re-surfaces token material.
    const list = await app.request("/api/auth/tokens", {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      tokens: Array<Record<string, unknown>>;
    };
    expect(listed.tokens).toHaveLength(1);
    const entry = listed.tokens[0];
    expect(entry?.["name"]).toBe("ci-token");
    expect(entry?.["installationId"]).toBe(String(INSTALLATION_ID));
    expect(JSON.stringify(listed)).not.toContain(body.token);
    expect(JSON.stringify(listed)).not.toContain("tokenHash");
    expect(JSON.stringify(listed)).not.toContain("Ciphertext");
  });

  it("supports the no-expiry choice", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
    });
    const cookie = await seedSession();
    const res = await mint(
      { name: "forever", installationId: INSTALLATION_ID, expiresInDays: null },
      cookie,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as MintedBody;
    expect(body.apiToken.expiresAt).toBeNull();
  });

  it("validates the installation against the viewer's LIVE set — 403, nothing minted", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
    });
    const cookie = await seedSession();
    const res = await mint({ name: "sneaky", installationId: 424242 }, cookie);
    expect(res.status).toBe(403);
    expect(
      await harness.raw("select count(*)::int as n from api_token"),
    ).toEqual([{ n: 0 }]);
  });

  it("returns the wire error contract when the live installation lookup fails", async () => {
    stubGitHub({
      userInstallations: () => jsonResponse({ message: "forbidden" }, 403),
    });
    const cookie = await seedSession();
    const res = await mint(
      { name: "blocked", installationId: INSTALLATION_ID },
      cookie,
    );
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "upstream error",
      code: "github-unavailable",
    });
  }, 10_000);

  it("is cookie-only: no cookie → 401; a Bearer token cannot mint or list", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
    });
    const bearer = await seedApiToken(harness.handle, kp);

    expect(
      (await mint({ name: "x", installationId: INSTALLATION_ID })).status,
    ).toBe(401);
    const viaBearerMint = await app.request("/api/auth/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ name: "x", installationId: INSTALLATION_ID }),
    });
    expect(viaBearerMint.status).toBe(401);
    const viaBearerList = await app.request("/api/auth/tokens", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(viaBearerList.status).toBe(401);
    // Exactly the seeded row — nothing minted through either path.
    expect(
      await harness.raw("select count(*)::int as n from api_token"),
    ).toEqual([{ n: 1 }]);
  });

  it("rejects malformed bodies deterministically", async () => {
    stubGitHub({});
    const cookie = await seedSession();
    for (const bad of [
      {},
      { name: "", installationId: INSTALLATION_ID },
      { name: "x".repeat(101), installationId: INSTALLATION_ID },
      { name: "ok", installationId: "not-a-number" },
      { name: "ok", installationId: INSTALLATION_ID, expiresInDays: 0 },
      { name: "ok", installationId: INSTALLATION_ID, expiresInDays: -3 },
    ]) {
      const res = await mint(bad, cookie);
      expect(res.status).toBe(400);
    }
  });

  it("revokes: Bearer dies, list shows revoked_at, repeat revoke is idempotent, foreign id is 404", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
      installationRepos: () =>
        installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
    });
    await seedPr(harness.handle);
    const cookie = await seedSession();
    const minted = (await (
      await mint({ name: "doomed", installationId: INSTALLATION_ID }, cookie)
    ).json()) as MintedBody;

    // Works before revocation.
    expect(
      (
        await app.request("/api/pulls", {
          headers: { Authorization: `Bearer ${minted.token}` },
        })
      ).status,
    ).toBe(200);

    const revoke = await app.request(`/api/auth/tokens/${minted.apiToken.id}`, {
      method: "DELETE",
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(revoke.status).toBe(200);

    // Bearer is dead immediately (liveness is checked per request, uncached).
    expect(
      (
        await app.request("/api/pulls", {
          headers: { Authorization: `Bearer ${minted.token}` },
        })
      ).status,
    ).toBe(401);

    const list = await app.request("/api/auth/tokens", {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    const listed = (await list.json()) as {
      tokens: Array<Record<string, unknown>>;
    };
    expect(listed.tokens[0]?.["revokedAt"]).not.toBeNull();

    // Idempotent repeat; foreign/unknown id is an indistinguishable 404.
    expect(
      (
        await app.request(`/api/auth/tokens/${minted.apiToken.id}`, {
          method: "DELETE",
          headers: { Cookie: `rs_session=${cookie}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/api/auth/tokens/999999", {
          method: "DELETE",
          headers: { Cookie: `rs_session=${cookie}` },
        })
      ).status,
    ).toBe(404);
  });
});
