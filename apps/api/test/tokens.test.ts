// Bearer /api/* access yields the same principal as cookies and hint-free 401s on invalid tokens.
// Refresh-once must not extend token expiry. Mint/list/revoke stay cookie-only.
// Mint checks live installation access and returns token material exactly once.
import { randomBytes } from "node:crypto";
import {
  encryptToken,
  createTenantRepository,
  createGrantAuth,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrStates,
  createTokenAuth,
  WriteClassifications,
  type AppDatabase,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
  type WriteClassification,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger, testLogging } from "./logging";
import {
  INSTALLATION_ID,
  KEY_REF,
  REVIEWER_ID,
  SECRET,
  buildAuthDeps,
  createKeyProvider,
  hashSha256Hex,
  getRequestUrl,
} from "./fixtures";

const REPO_A = 42001;
const REPO_B = 42002;
const OTHER_INSTALLATION_ID = 111222;

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
const OTHER_CTX: TenantContext = {
  installationId: brand(isInstallationId, OTHER_INSTALLATION_ID),
};
const REVIEWER: ReviewerId = brand(isReviewerId, REVIEWER_ID);

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
  readonly installationRepos?: (call: number, url: string) => Response;
  /** `GET /user/installations` responses per call. */
  readonly userInstallations?: (call: number) => Response;
  /** `GET /repositories/{id}`, the gate's access check, per call. */
  readonly repositories?: (call: number, url: string) => Response;
  /** OAuth token endpoint (refresh) responses per call. */
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  installationRepos: number;
  userInstallations: number;
  repositories: number;
  token: number;
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = {
    installationRepos: 0,
    userInstallations: 0,
    repositories: 0,
    token: 0,
  };
  const fetchFn = vi.fn(
    async (input: string | URL | Request): Promise<Response> => {
      const url = getRequestUrl(input);
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
          ? cfg.installationRepos(i, url)
          : jsonResponse({ message: "nope" }, 500);
      }
      if (url.includes("/user/installations")) {
        const i = counts.userInstallations++;
        return cfg.userInstallations
          ? cfg.userInstallations(i)
          : jsonResponse({ message: "nope" }, 500);
      }
      if (cfg.repositories !== undefined && url.includes("/repositories/")) {
        const i = counts.repositories++;
        return cfg.repositories(i, url);
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

/** Seed an api_token row directly; returns the Bearer plaintext. */
async function seedApiToken(
  handle: AppDatabase,
  kp: KeyProvider,
  overrides: {
    expiresAt?: Date | null;
    revoke?: boolean;
    scope?: WriteClassification;
  } = {},
): Promise<string> {
  const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok)
    throw new Error("seed encrypt failed");
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  const minted = await createTokenAuth(handle).mintToken({
    scope: overrides.scope ?? WriteClassifications.EXTERNAL_WRITE,
    userId: REVIEWER,
    userLogin: "octocat",
    name: "ci-token",
    tokenHash: hashSha256Hex(plaintext),
    grantId: grant.id,
    expiresAt:
      overrides.expiresAt === undefined
        ? new Date("2027-01-01T00:00:00Z")
        : overrides.expiresAt,
  });
  if (overrides.revoke === true) {
    const revoked = await createTokenAuth(handle).revokeToken(
      REVIEWER,
      minted.id,
      new Date(),
    );
    if (!revoked.ok) throw new Error("seed revoke failed");
  }
  return plaintext;
}

async function seedPr(handle: AppDatabase): Promise<void> {
  await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brand(isRepoId, REPO_A),
    prNumber: 7,
    repoSlug: "octo/hello",
    title: "PR 7",
    state: PrStates.OPEN,
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
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
      installationRepos: () =>
        installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
      repositories: () =>
        jsonResponse({
          id: REPO_A,
          full_name: "octo/hello",
          private: true,
          permissions: { push: true },
        }),
    });
    await seedPr(harness.handle);
    const bearer = await seedApiToken(harness.handle, kp);

    const res = await getWithBearer(`/api/repos/${REPO_A}/pulls/7`, bearer);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ title: "PR 7" });
  });

  it("reads rows in two installations with one token", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([
          { id: INSTALLATION_ID, login: "octo" },
          { id: OTHER_INSTALLATION_ID, login: "acme" },
        ]),
      installationRepos: (_call, url) =>
        url.includes(`/user/installations/${INSTALLATION_ID}/`)
          ? installationReposOk([{ id: REPO_A, full_name: "octo/hello" }])
          : installationReposOk([{ id: REPO_B, full_name: "acme/other" }]),
      repositories: (_call, url) =>
        url.endsWith(`/repositories/${REPO_B}`)
          ? jsonResponse({
              id: REPO_B,
              full_name: "acme/other",
              private: true,
              permissions: { push: true },
            })
          : jsonResponse({
              id: REPO_A,
              full_name: "octo/hello",
              private: true,
              permissions: { push: true },
            }),
    });
    await seedPr(harness.handle);
    await createTenantRepository(harness.handle, OTHER_CTX).pullRequests.upsert(
      {
        repoId: brand(isRepoId, REPO_B),
        prNumber: 3,
        repoSlug: "acme/other",
        title: "PR 3",
        state: PrStates.OPEN,
      },
    );
    const bearer = await seedApiToken(harness.handle, kp);

    const first = await getWithBearer(`/api/repos/${REPO_A}/pulls/7`, bearer);
    const other = await getWithBearer(`/api/repos/${REPO_B}/pulls/3`, bearer);

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ title: "PR 7" });
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({ title: "PR 3" });
  });

  it("denies writes when the Bearer token carries read scope", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
      installationRepos: () =>
        installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
    });
    await seedPr(harness.handle);
    const readOnly = await seedApiToken(harness.handle, kp, {
      scope: WriteClassifications.READ,
    });

    // The same credential reads fine…
    expect((await getWithBearer("/api/inbox", readOnly)).status).toBe(200);
    // …and is refused at the private-write rung, before the handler runs.
    const res = await app.request("/api/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${readOnly}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://github.com/octo/hello/pull/7" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "this credential's scope does not allow this operation",
      code: "scope-exceeded",
    });
  });

  it("401s all invalid token forms with the same hint-free body", async () => {
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
      const res = await getWithBearer("/api/inbox", bearer);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "unauthorized",
        code: "unauthorized",
      });
    }
  });

  it("ignores Bearer tokens on browser-only /api/auth/* routes", async () => {
    const bearer = await seedApiToken(harness.handle, kp);
    const res = await app.request("/api/auth/tokens", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(res.status).toBe(401);
  });

  it("refreshes GitHub access once without extending token expiry", async () => {
    const counts = stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
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

    const res = await getWithBearer("/api/inbox", bearer);
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

  it("emits token.refresh.fail for rejected Bearer-channel rotations", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
      // Every data call 401s (expired access token) and the rotation itself
      // is rejected, the refresh orchestrator's bearer-channel hard failure.
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
      auth: buildAuthDeps(kp),
      github: unusedConversationPort,
    });
    const bearer = await seedApiToken(harness.handle, kp);

    const res = await captureApp.request("/api/inbox", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(res.status).toBe(401);
    // Alert contract: the bearer fork emits the same evt as the
    // cookie flow, operators key alerts off token.refresh.fail.
    const line = capture.lines().find((l) => l["evt"] === "token.refresh.fail");
    expect(line?.["level"]).toBe("error");
    expect(typeof line?.["reviewerId"]).toBe("string");
    // The api_token row is NOT deleted on failure, user-managed credential.
    expect(
      await harness.raw("select count(*)::int as n from api_token"),
    ).toEqual([{ n: 1 }]);
  });

  it("touches last_used_at on use, throttled within the window", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
      installationRepos: () =>
        installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
    });
    await seedPr(harness.handle);
    const bearer = await seedApiToken(harness.handle, kp);

    expect((await getWithBearer("/api/inbox", bearer)).status).toBe(200);
    // The touch is fire-and-forget (never awaited on the request path), poll.
    await vi.waitFor(async () => {
      const touched = await harness.raw(
        "select last_used_at from api_token limit 1",
      );
      expect(touched[0]?.["last_used_at"]).not.toBeNull();
    });

    // Clear the stamp out-of-band: a second request inside the throttle window
    // must NOT re-touch (the throttle, not the DB write, is under test).
    await harness.raw("update api_token set last_used_at = null");
    expect((await getWithBearer("/api/inbox", bearer)).status).toBe(200);
    const throttled = await harness.raw(
      "select last_used_at from api_token limit 1",
    );
    expect(throttled[0]?.["last_used_at"]).toBeNull();
  });
});

describe("cookie-only /api/auth/tokens mint, list and revoke", () => {
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

  /** Seed a cookie session; returns the cookie plaintext. */
  async function seedSession(): Promise<string> {
    const cookie = randomBytes(32).toString("base64url");
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
    await createTenantRepository(harness.handle, CTX).sessions.create({
      sessionTokenHash: hashSha256Hex(cookie),
      reviewerId: REVIEWER,
      reviewerLogin: "octocat",
      grantId: grant.id,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    return cookie;
  }

  async function mint(body: unknown, cookie?: string): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (cookie !== undefined)
      headers["Cookie"] = `__Host-mergebrief_session=${cookie}`;

    return app.request("/api/auth/tokens", {
      method: "POST",
      headers,
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
      {
        name: "ci-token",
        scope: "external-write",
      },
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
    expect(rows[0]?.["token_hash"]).toBe(hashSha256Hex(body.token));

    // Link-never-copy: mint linked the SESSION's grant, one physical
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
    const read = await app.request("/api/inbox", {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(read.status).toBe(200);

    // The list never re-surfaces token material.
    const list = await app.request("/api/auth/tokens", {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      tokens: Array<Record<string, unknown>>;
    };
    expect(listed.tokens).toHaveLength(1);
    const entry = listed.tokens[0];
    expect(entry?.["name"]).toBe("ci-token");
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
      {
        name: "forever",
        scope: "external-write",
        expiresInDays: null,
      },
      cookie,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as MintedBody;
    expect(body.apiToken.expiresAt).toBeNull();
  });

  it("is cookie-only: no cookie → 401; a Bearer token cannot mint or list", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
    });
    const bearer = await seedApiToken(harness.handle, kp);

    expect(
      (
        await mint({
          name: "x",
          scope: "external-write",
        })
      ).status,
    ).toBe(401);
    const viaBearerMint = await app.request("/api/auth/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        name: "x",
        scope: "external-write",
      }),
    });
    expect(viaBearerMint.status).toBe(401);
    const viaBearerList = await app.request("/api/auth/tokens", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(viaBearerList.status).toBe(401);
    // Exactly the seeded row, nothing minted through either path.
    expect(
      await harness.raw("select count(*)::int as n from api_token"),
    ).toEqual([{ n: 1 }]);
  });

  it("mints at the chosen scope, and refuses a mint that names none", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
    });
    const cookie = await seedSession();

    const narrowed = await mint({ name: "read-only", scope: "read" }, cookie);
    expect(narrowed.status).toBe(201);
    expect(await narrowed.json()).toMatchObject({
      apiToken: { scope: "read" },
    });

    const widest = await mint(
      {
        name: "full",
        scope: "external-write",
      },
      cookie,
    );
    expect(widest.status).toBe(201);
    expect(await widest.json()).toMatchObject({
      apiToken: { scope: "external-write" },
    });

    // No scope is NOT a default, the reach a token carries is always chosen.
    const unchosen = await mint({ name: "unstated" }, cookie);
    expect(unchosen.status).toBe(400);

    // The list surface shows it too, the scope is how a reader tells the two
    // credentials apart.
    const list = await app.request("/api/auth/tokens", {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    const listed = (await list.json()) as {
      tokens: Array<Record<string, unknown>>;
    };
    expect(
      listed.tokens
        .map((token) => String(token["scope"]))
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["external-write", "read"]);
  });

  it("rejects malformed bodies deterministically", async () => {
    stubGitHub({});
    const cookie = await seedSession();
    for (const bad of [
      {},
      { name: "ok" },
      { name: "", scope: "read" },
      { name: "x".repeat(101), scope: "read" },
      {
        name: "ok",
        scope: "read",
        expiresInDays: 0,
      },
      {
        name: "ok",
        scope: "read",
        expiresInDays: -3,
      },
      { name: "ok", scope: "admin" },
    ]) {
      const res = await mint(bad, cookie);
      expect(res.status).toBe(400);
    }
  });

  it("revokes idempotently, records revocation and 404s foreign token ids", async () => {
    stubGitHub({
      userInstallations: () =>
        userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
      installationRepos: () =>
        installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
    });
    await seedPr(harness.handle);
    const cookie = await seedSession();
    const minted = (await (
      await mint(
        {
          name: "doomed",
          scope: "external-write",
        },
        cookie,
      )
    ).json()) as MintedBody;

    // Works before revocation.
    expect(
      (
        await app.request("/api/inbox", {
          headers: { Authorization: `Bearer ${minted.token}` },
        })
      ).status,
    ).toBe(200);

    const revoke = await app.request(`/api/auth/tokens/${minted.apiToken.id}`, {
      method: "DELETE",
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(revoke.status).toBe(200);

    // Bearer is dead immediately (liveness is checked per request, uncached).
    expect(
      (
        await app.request("/api/inbox", {
          headers: { Authorization: `Bearer ${minted.token}` },
        })
      ).status,
    ).toBe(401);

    const list = await app.request("/api/auth/tokens", {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
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
          headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/api/auth/tokens/999999", {
          method: "DELETE",
          headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
        })
      ).status,
    ).toBe(404);
  });
});
