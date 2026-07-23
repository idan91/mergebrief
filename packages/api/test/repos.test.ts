// BRIEF-17 PR 3 — `GET /api/repos` (the CLI's owner/name → repoId
// resolution, ADR 0028 consequence). The locked contract (plan decision 3):
// the installation∩user-access intersection from the pulls.ts allowed-set
// machinery and its 60s cache (SHARED instance — one GitHub fetch serves
// both endpoints inside the TTL); stringified repoIds; flat, unpaginated;
// `no-store`; a GitHub failure is a 401/502, NEVER a DB-only fallback.
// Bearer and cookie both authenticate (it lives under /api/*).
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
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AuthDeps } from "../src/lib";
import { testLogger } from "./logging";

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_A = 42001;
const REPO_B = 42002;

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";

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

function installationReposOk(
  repos: ReadonlyArray<{ id: number; full_name: string }>,
): Response {
  return jsonResponse({ total_count: repos.length, repositories: repos });
}

interface StubConfig {
  readonly installationRepos?: (call: number) => Response;
}
interface StubCounts {
  installationRepos: number;
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = { installationRepos: 0 };
  const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/user/installations/") && url.includes("/repositories")) {
      const i = counts.installationRepos++;
      return cfg.installationRepos ? cfg.installationRepos(i) : jsonResponse({ message: "nope" }, 500);
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Conversation port stub: never exercised here.
const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
};

describe("GET /api/repos", () => {
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

  async function seedSession(): Promise<string> {
    const cookie = randomBytes(32).toString("base64url");
    const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
    const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
    if (!sealedAccess.ok || !sealedRefresh.ok) throw new Error("seed encrypt failed");
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

  async function seedApiToken(): Promise<string> {
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
    const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
    if (!sealedAccess.ok || !sealedRefresh.ok) throw new Error("seed encrypt failed");
    const grant = await grantAuth(harness.handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: KEY_REF,
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await tokenAuth(harness.handle).mintToken({
      installationId: CTX.installationId,
      userId: REVIEWER,
      userLogin: "octocat",
      name: "ci-token",
      tokenHash: sha256Hex(plaintext),
      grantId: grant.id,
      expiresAt: null,
    });
    return plaintext;
  }

  async function getRepos(headers: Record<string, string>): Promise<Response> {
    return app.request("/api/repos", { headers });
  }

  it("returns the flat intersection with stringified ids, no-store", async () => {
    stubGitHub({
      installationRepos: () =>
        installationReposOk([
          { id: REPO_B, full_name: "octo/world" },
          { id: REPO_A, full_name: "octo/hello" },
        ]),
    });
    const cookie = await seedSession();
    const res = await getRepos({ Cookie: `rs_session=${cookie}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { repos: Array<{ repoId: string; fullName: string }> };
    // Deterministic order (fullName ascending); ids are STRINGS.
    expect(body.repos).toEqual([
      { repoId: String(REPO_A), fullName: "octo/hello" },
      { repoId: String(REPO_B), fullName: "octo/world" },
    ]);
  });

  it("authenticates via Bearer too (it lives under /api/*)", async () => {
    stubGitHub({
      installationRepos: () => installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
    });
    const bearer = await seedApiToken();
    const res = await getRepos({ Authorization: `Bearer ${bearer}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repos: Array<{ repoId: string }> };
    expect(body.repos).toHaveLength(1);
  });

  it("SHARES the allowed-set cache with /api/pulls — one GitHub fetch inside the TTL", async () => {
    const counts = stubGitHub({
      installationRepos: () => installationReposOk([{ id: REPO_A, full_name: "octo/hello" }]),
    });
    const cookie = await seedSession();
    expect((await app.request("/api/pulls", { headers: { Cookie: `rs_session=${cookie}` } })).status).toBe(200);
    expect((await getRepos({ Cookie: `rs_session=${cookie}` })).status).toBe(200);
    expect((await getRepos({ Cookie: `rs_session=${cookie}` })).status).toBe(200);
    expect(counts.installationRepos).toBe(1);
  });

  // Long timeout: octokit's retry plugin retries the 500 with backoff before
  // the route sees the failure.
  it("fails closed on GitHub errors — 502, never a DB-derived listing", { timeout: 20_000 }, async () => {
    stubGitHub({
      installationRepos: () => jsonResponse({ message: "kaboom" }, 500),
    });
    // Rows in the DB that a leaky fallback would surface.
    await forTenant(harness.handle, CTX).pullRequests.upsert({
      repoId: brand(isRepoId, REPO_A),
      prNumber: 7,
      repoSlug: "octo/hello",
      state: PrState.OPEN,
    });
    const cookie = await seedSession();
    const res = await getRepos({ Cookie: `rs_session=${cookie}` });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("octo/hello");
    expect(text).not.toContain(String(REPO_A));
  });

  it("401s an unauthenticated request without touching GitHub", async () => {
    const counts = stubGitHub({});
    const res = await getRepos({});
    expect(res.status).toBe(401);
    expect(counts.installationRepos).toBe(0);
  });
});
