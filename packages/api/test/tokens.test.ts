// BRIEF-17 PR 2 — API tokens as a second presentation channel (ADR 0016 #4 as
// amended 2026-07-09). Two surfaces, one auth model:
//   1. Bearer presentation: `Authorization: Bearer mergebrief_...` resolves
//      through `tokenAuth` into the SAME principal shape a cookie session
//      yields, on `/api/*` only. Miss/expired/revoked/garbage → hint-free 401.
//      Refresh-once mid-request rides the same spendRefresh machinery; the
//      token's own expiry never moves.
//   2. `/auth/tokens` mint/list/revoke: cookie-authed ONLY (Bearer on /auth/*
//      is ignored), mint validates the installation against the viewer's LIVE
//      accessible set, token material is returned exactly once.
// Same harness as installations.test.ts: `app.request()` over PGlite, GitHub
// stubbed at the global-fetch seam.
import { createHash, randomBytes } from "node:crypto";
import type { Hono } from "hono";
import {
  encryptToken,
  envKeyProvider,
  forTenant,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrState,
  tokenAuth,
  type AppDatabase,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type AuthDeps } from "../src/lib";

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_A = 42001;

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

function brand<T extends bigint>(guard: (v: bigint) => v is T, value: number): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) throw new Error("bad branded id");
  return asBigInt;
}

const CTX: TenantContext = { installationId: brand(isInstallationId, INSTALLATION_ID) };
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
    headers: { "content-type": "application/json; charset=utf-8", date: new Date().toUTCString() },
  });
}

/** `GET /user/installations/{id}/repositories` (the /api/pulls allowed set). */
function installationReposOk(
  repos: ReadonlyArray<{ id: number; full_name: string }>,
): Response {
  return jsonResponse({ total_count: repos.length, repositories: repos });
}

/** `GET /user/installations` (the live accessible set for minting). */
function userInstallationsOk(items: ReadonlyArray<{ id: number; login: string }>): Response {
  return jsonResponse({
    total_count: items.length,
    installations: items.map((i) => ({ id: i.id, account: { login: i.login } })),
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
  const counts: StubCounts = { installationRepos: 0, userInstallations: 0, token: 0 };
  const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/login/oauth/access_token")) {
      const i = counts.token++;
      return cfg.token ? cfg.token(i) : jsonResponse({ error: "unexpected_token" }, 500);
    }
    if (url.includes("/user/installations/") && url.includes("/repositories")) {
      const i = counts.installationRepos++;
      return cfg.installationRepos ? cfg.installationRepos(i) : jsonResponse({ message: "nope" }, 500);
    }
    if (url.includes("/user/installations")) {
      const i = counts.userInstallations++;
      return cfg.userInstallations ? cfg.userInstallations(i) : jsonResponse({ message: "nope" }, 500);
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
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
  if (!sealedAccess.ok || !sealedRefresh.ok) throw new Error("seed encrypt failed");
  const minted = await tokenAuth(handle).mintToken({
    installationId: CTX.installationId,
    userId: REVIEWER,
    userLogin: "octocat",
    name: "ci-token",
    tokenHash: sha256Hex(plaintext),
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    expiresAt: overrides.expiresAt === undefined ? new Date("2027-01-01T00:00:00Z") : overrides.expiresAt,
  });
  if (overrides.revoke === true) {
    const revoked = await tokenAuth(handle).revokeToken(REVIEWER, minted.id, new Date());
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
};

describe("Bearer presentation on /api/*", () => {
  let harness: PgliteHarness;
  let app: Hono;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = keyProvider();
    app = createApp({
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

  async function getWithBearer(path: string, bearer: string): Promise<Response> {
    return app.request(path, { headers: { Authorization: `Bearer ${bearer}` } });
  }

  it("authenticates a valid token through the full gate to a real read", async () => {
    stubGitHub({
      installationRepos: () => installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
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
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("ignores Bearer on /auth/* — the browser-only surface never resolves tokens", async () => {
    stubGitHub({
      userInstallations: () => userInstallationsOk([{ id: INSTALLATION_ID, login: "octo" }]),
    });
    const bearer = await seedApiToken(harness.handle, kp);
    const res = await app.request("/auth/installations", {
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
    const before = await harness.raw(
      "select gh_token_ciphertext, expires_at from api_token limit 1",
    );

    const res = await getWithBearer("/api/pulls", bearer);
    expect(res.status).toBe(200);
    expect(counts.token).toBe(1);
    expect(counts.installationRepos).toBe(2);

    const after = await harness.raw(
      "select gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref, expires_at from api_token limit 1",
    );
    // Credentials rotated in the api_token row (not reviewer_session)...
    expect(after[0]?.["gh_token_ciphertext"]).not.toBe(before[0]?.["gh_token_ciphertext"]);
    // ...and the rotated ciphertext decrypts to the rotated access token.
    // The mint-chosen expiry is untouched by GitHub rotation.
    expect(after[0]?.["expires_at"]).toEqual(before[0]?.["expires_at"]);
    expect(await harness.raw("select count(*)::int as n from reviewer_session")).toEqual([
      { n: 0 },
    ]);
  });

  it("touches last_used_at on use, throttled within the window", async () => {
    stubGitHub({
      installationRepos: () => installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
    });
    await seedPr(harness.handle);
    const bearer = await seedApiToken(harness.handle, kp);

    expect((await getWithBearer("/api/pulls", bearer)).status).toBe(200);
    // The touch is fire-and-forget (never awaited on the request path) — poll.
    await vi.waitFor(async () => {
      const touched = await harness.raw("select last_used_at from api_token limit 1");
      expect(touched[0]?.["last_used_at"]).not.toBeNull();
    });

    // Clear the stamp out-of-band: a second request inside the throttle window
    // must NOT re-touch (the throttle, not the DB write, is under test).
    await harness.raw("update api_token set last_used_at = null");
    expect((await getWithBearer("/api/pulls", bearer)).status).toBe(200);
    const throttled = await harness.raw("select last_used_at from api_token limit 1");
    expect(throttled[0]?.["last_used_at"]).toBeNull();
  });
});
