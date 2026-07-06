// BRIEF-19 PR 2.1 multi-org endpoint tests: GET /auth/installations and
// POST /auth/installation. Same harness as pulls.test.ts: `app.request()` over
// PGlite, GitHub stubbed at the global-fetch seam. The accessible set is ALWAYS
// re-derived from GitHub (`GET /user/installations`, viewer token) — a switch
// to anything outside it is a 403 with NO session/settings mutation (D14).
import { randomBytes, createHash } from "node:crypto";
import type { Hono } from "hono";
import {
  encryptToken,
  envKeyProvider,
  forTenant,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrState,
  userSettingsStore,
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
const OTHER_INSTALLATION_ID = 111222;
const UNREACHABLE_INSTALLATION_ID = 999999;
const REVIEWER_ID = 555;

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

function installationsOk(items: ReadonlyArray<{ id: number; login: string }>): Response {
  return jsonResponse({
    total_count: items.length,
    installations: items.map((i) => ({ id: i.id, account: { login: i.login } })),
  });
}

interface StubConfig {
  readonly installations?: (call: number) => Response;
  /** `GET /user/installations/{id}/repositories` — the list endpoint's set. */
  readonly installationRepos?: (call: number, url: string) => Response;
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  installations: number;
  installationRepos: number;
  token: number;
  /** URLs of installation-repositories fetches, in order. */
  readonly installationRepoUrls: string[];
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = {
    installations: 0,
    installationRepos: 0,
    token: 0,
    installationRepoUrls: [],
  };
  const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/login/oauth/access_token")) {
      const i = counts.token++;
      return cfg.token ? cfg.token(i) : jsonResponse({ error: "unexpected_token" }, 500);
    }
    if (url.includes("/user/installations/") && url.includes("/repositories")) {
      const i = counts.installationRepos++;
      counts.installationRepoUrls.push(url);
      return cfg.installationRepos
        ? cfg.installationRepos(i, url)
        : jsonResponse({ message: "nope" }, 500);
    }
    if (url.includes("/user/installations")) {
      const i = counts.installations++;
      return cfg.installations ? cfg.installations(i) : jsonResponse({ message: "nope" }, 500);
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

async function seedSession(handle: AppDatabase, kp: KeyProvider): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(cookie).digest("hex");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok) throw new Error("seed encrypt failed");
  await forTenant(handle, CTX).sessions.create({
    sessionTokenHash: hash,
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return cookie;
}

const TOKEN_SUCCESS = {
  access_token: ROTATED_ACCESS,
  refresh_token: ROTATED_REFRESH,
  expires_in: 28_800,
  refresh_token_expires_in: 15_897_600,
  token_type: "bearer",
  scope: "",
};

describe("GET /auth/installations + POST /auth/installation", () => {
  let harness: PgliteHarness;
  let app: Hono;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = keyProvider();
    app = createApp({ handle: harness.handle, webhookSecret: SECRET, auth: authDeps(kp) });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  async function get(path: string, cookie?: string): Promise<Response> {
    return app.request(
      path,
      cookie === undefined ? {} : { headers: { Cookie: `rs_session=${cookie}` } },
    );
  }
  async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
    return app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie === undefined ? {} : { Cookie: `rs_session=${cookie}` }),
      },
      body: JSON.stringify(body),
    });
  }

  async function sessionInstallationId(): Promise<string> {
    const rows = await harness.raw("select installation_id from reviewer_session limit 1");
    return String(rows[0]?.["installation_id"]);
  }

  // ------------------------------------------------------------------- list

  it("list: 401 without a session (no GitHub call)", async () => {
    const counts = stubGitHub({ installations: () => installationsOk([]) });
    const res = await get("/auth/installations");
    expect(res.status).toBe(401);
    expect(counts.installations).toBe(0);
  });

  it("list: accessible set with current + default flags", async () => {
    stubGitHub({
      installations: () =>
        installationsOk([
          { id: INSTALLATION_ID, login: "acme" },
          { id: OTHER_INSTALLATION_ID, login: "octo-org" },
        ]),
    });
    const cookie = await seedSession(harness.handle, kp);
    // A stored default pointing at the OTHER installation.
    await userSettingsStore(harness.handle).setDefaultInstallation(
      REVIEWER,
      brand(isInstallationId, OTHER_INSTALLATION_ID),
    );

    const res = await get("/auth/installations", cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      installations: Array<Record<string, unknown>>;
      currentInstallationId: string;
      defaultInstallationId: string | null;
    };
    expect(body.currentInstallationId).toBe(String(INSTALLATION_ID));
    expect(body.defaultInstallationId).toBe(String(OTHER_INSTALLATION_ID));
    expect(body.installations).toEqual([
      {
        installationId: String(INSTALLATION_ID),
        accountLogin: "acme",
        isCurrent: true,
        isDefault: false,
      },
      {
        installationId: String(OTHER_INSTALLATION_ID),
        accountLogin: "octo-org",
        isCurrent: false,
        isDefault: true,
      },
    ]);
  });

  // ----------------------------------------------------------------- switch

  it("switch: to an accessible installation rebinds the session (200)", async () => {
    stubGitHub({
      installations: () =>
        installationsOk([
          { id: INSTALLATION_ID, login: "acme" },
          { id: OTHER_INSTALLATION_ID, login: "octo-org" },
        ]),
    });
    const cookie = await seedSession(harness.handle, kp);
    expect(await sessionInstallationId()).toBe(String(INSTALLATION_ID));

    const res = await post("/auth/installation", { installationId: String(OTHER_INSTALLATION_ID) }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { currentInstallationId: string; defaultInstallationId: string | null };
    expect(body.currentInstallationId).toBe(String(OTHER_INSTALLATION_ID));
    expect(body.defaultInstallationId).toBeNull(); // setDefault not requested
    // The session row's tenant stamp moved.
    expect(await sessionInstallationId()).toBe(String(OTHER_INSTALLATION_ID));
  });


  it("switch: the next /api/pulls uses the NEW installation's repo set (no stale cache)", async () => {
    const REPO_A = 424242;
    const REPO_B = 535353;
    const counts = stubGitHub({
      installations: () =>
        installationsOk([
          { id: INSTALLATION_ID, login: "acme" },
          { id: OTHER_INSTALLATION_ID, login: "octo-org" },
        ]),
      installationRepos: (_call, url) =>
        url.includes(`/user/installations/${INSTALLATION_ID}/`)
          ? jsonResponse({ total_count: 1, repositories: [{ id: REPO_A, full_name: "acme/a" }] })
          : jsonResponse({ total_count: 1, repositories: [{ id: REPO_B, full_name: "octo/b" }] }),
    });
    const cookie = await seedSession(harness.handle, kp);
    // One PR per tenant; each visible only through its own installation.
    await forTenant(harness.handle, CTX).pullRequests.upsert({
      repoId: brand(isRepoId, REPO_A), prNumber: 1, title: "tenant-a-pr", state: PrState.OPEN,
    });
    const otherCtx: TenantContext = { installationId: brand(isInstallationId, OTHER_INSTALLATION_ID) };
    await forTenant(harness.handle, otherCtx).pullRequests.upsert({
      repoId: brand(isRepoId, REPO_B), prNumber: 2, title: "tenant-b-pr", state: PrState.OPEN,
    });

    // Warm the allowed-set cache under installation A.
    const before = await get("/api/pulls", cookie);
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as { pulls: Array<{ title: string }> };
    expect(beforeBody.pulls.map((row) => row.title)).toEqual(["tenant-a-pr"]);

    const switched = await post(
      "/auth/installation",
      { installationId: String(OTHER_INSTALLATION_ID) },
      cookie,
    );
    expect(switched.status).toBe(200);

    // Immediately after the switch (inside the 60s TTL) the list must resolve
    // the NEW installation's set — never reuse the pre-switch cache entry.
    const after = await get("/api/pulls", cookie);
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as { pulls: Array<{ title: string }> };
    expect(afterBody.pulls.map((row) => row.title)).toEqual(["tenant-b-pr"]);
    expect(counts.installationRepos).toBe(2);
    expect(counts.installationRepoUrls[1]).toContain(`/user/installations/${OTHER_INSTALLATION_ID}/`);
  });

  it("switch: setDefault persists the default in user_settings", async () => {
    stubGitHub({
      installations: () =>
        installationsOk([
          { id: INSTALLATION_ID, login: "acme" },
          { id: OTHER_INSTALLATION_ID, login: "octo-org" },
        ]),
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await post(
      "/auth/installation",
      { installationId: OTHER_INSTALLATION_ID, setDefault: true },
      cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { defaultInstallationId: string | null };
    expect(body.defaultInstallationId).toBe(String(OTHER_INSTALLATION_ID));

    const settings = await userSettingsStore(harness.handle).get(REVIEWER);
    expect(String(settings?.defaultInstallationId)).toBe(String(OTHER_INSTALLATION_ID));
  });

  it("switch: to an inaccessible installation → 403 AND no session/settings mutation", async () => {
    stubGitHub({
      installations: () => installationsOk([{ id: INSTALLATION_ID, login: "acme" }]),
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await post(
      "/auth/installation",
      { installationId: UNREACHABLE_INSTALLATION_ID, setDefault: true },
      cookie,
    );
    expect(res.status).toBe(403);
    // Session tenant stamp unchanged.
    expect(await sessionInstallationId()).toBe(String(INSTALLATION_ID));
    // No default written despite setDefault:true — validation precedes any write.
    expect(await userSettingsStore(harness.handle).get(REVIEWER)).toBeUndefined();
  });

  it("switch: invalid body → 400 with no GitHub call", async () => {
    const counts = stubGitHub({ installations: () => installationsOk([]) });
    const cookie = await seedSession(harness.handle, kp);

    expect((await post("/auth/installation", { setDefault: true }, cookie)).status).toBe(400);
    expect((await post("/auth/installation", { installationId: "not-a-number" }, cookie)).status).toBe(400);
    expect((await post("/auth/installation", { installationId: 0 }, cookie)).status).toBe(400);
    expect(counts.installations).toBe(0);
  });

  it("switch: 401 from GitHub → refresh → retry succeeds", async () => {
    const counts = stubGitHub({
      installations: (call) =>
        call === 0
          ? jsonResponse({ message: "expired" }, 401)
          : installationsOk([{ id: OTHER_INSTALLATION_ID, login: "octo-org" }]),
      token: () => jsonResponse(TOKEN_SUCCESS),
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await post("/auth/installation", { installationId: OTHER_INSTALLATION_ID }, cookie);
    expect(res.status).toBe(200);
    expect(counts.token).toBe(1);
    expect(counts.installations).toBe(2);
    expect(await sessionInstallationId()).toBe(String(OTHER_INSTALLATION_ID));
  });
});
