// BRIEF-19 PR 1.2 endpoint tests: the session-scoped PR list (`GET /api/pulls`)
// and the per-PR meta endpoint (`GET /api/repos/:repoId/pulls/:prNumber`).
// Same harness as reads.test.ts: `app.request()` over PGlite, GitHub stubbed at
// the global-fetch seam. The list's allowed-repo set comes from
// `GET /user/installations/{id}/repositories` with the viewer's token — a
// GitHub failure must fail the list (401/502), NEVER degrade to a DB-only
// (leaky) listing.
import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import {
  artifactStore,
  encryptToken,
  envKeyProvider,
  forTenant,
  generationProjection,
  GenerationKind,
  GenerationStatus,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrState,
  type AppDatabase,
  type KeyProvider,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type AuthDeps } from "../src/lib";

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const OTHER_INSTALLATION_ID = 111222;
const REVIEWER_ID = 555;
const REPO_A = 424242;
const REPO_B = 535353;

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
const OTHER_CTX: TenantContext = { installationId: brand(isInstallationId, OTHER_INSTALLATION_ID) };

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

function installationsOk(repos: ReadonlyArray<{ id: number; full_name: string }>): Response {
  return jsonResponse({ total_count: repos.length, repositories: repos });
}

interface StubConfig {
  readonly installations?: (call: number) => Response;
  readonly repositories?: (call: number) => Response;
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  installations: number;
  repositories: number;
  token: number;
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = { installations: 0, repositories: 0, token: 0 };
  const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/login/oauth/access_token")) {
      const i = counts.token++;
      return cfg.token ? cfg.token(i) : jsonResponse({ error: "unexpected_token" }, 500);
    }
    if (url.includes("/user/installations/")) {
      const i = counts.installations++;
      return cfg.installations ? cfg.installations(i) : jsonResponse({ message: "nope" }, 500);
    }
    if (url.includes("/repositories/")) {
      const i = counts.repositories++;
      return cfg.repositories ? cfg.repositories(i) : jsonResponse({ message: "denied" }, 404);
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

async function seedSession(handle: AppDatabase, kp: KeyProvider): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(cookie).digest("hex");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok) throw new Error("seed encrypt failed");
  await forTenant(handle, CTX).sessions.create({
    sessionTokenHash: hash,
    reviewerId: brand(isReviewerId, REVIEWER_ID),
    reviewerLogin: "octocat",
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return cookie;
}

interface SeedPrInput {
  readonly ctx?: TenantContext;
  readonly repoId: number;
  readonly prNumber: number;
  readonly title?: string;
  readonly slug?: string;
}

async function seedPr(handle: AppDatabase, input: SeedPrInput) {
  const ctx = input.ctx ?? CTX;
  return forTenant(handle, ctx).pullRequests.upsert({
    repoId: brand(isRepoId, input.repoId),
    prNumber: input.prNumber,
    repoSlug: input.slug ?? "octo/hello",
    title: input.title ?? `PR ${input.prNumber}`,
    state: PrState.OPEN,
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

describe("GET /api/pulls + GET /api/repos/:repoId/pulls/:prNumber", () => {
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

  // ------------------------------------------------------------------ list

  it("list: 401 without a session (no GitHub call)", async () => {
    const counts = stubGitHub({ installations: () => installationsOk([]) });
    const res = await get("/api/pulls");
    expect(res.status).toBe(401);
    expect(counts.installations).toBe(0);
  });

  it("list: only ctx-tenant rows in the viewer's allowed repos, newest first, verified names", async () => {
    stubGitHub({
      installations: () => installationsOk([{ id: REPO_A, full_name: "octo/verified-a" }]),
    });
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 1, title: "first" });
    await new Promise((r) => setTimeout(r, 5));
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 2, title: "second" });
    // Same tenant, repo NOT in the allowed set → filtered out.
    await seedPr(harness.handle, { repoId: REPO_B, prNumber: 3 });
    // Another tenant, SAME repo id → never visible.
    await seedPr(harness.handle, { ctx: OTHER_CTX, repoId: REPO_A, prNumber: 9 });

    const res = await get("/api/pulls", cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pulls: Array<Record<string, unknown>> };
    expect(body.pulls.map((p) => p["prNumber"])).toEqual([2, 1]);
    expect(body.pulls[0]).toMatchObject({
      repoId: String(REPO_A),
      repoSlug: "octo/verified-a", // GitHub-verified, not the stored slug
      title: "second",
      state: "open",
      briefAvailable: false,
      generation: null,
    });
  });

  it("list: current-span enrichment — generation summary + briefAvailable per row", async () => {
    stubGitHub({
      installations: () => installationsOk([{ id: REPO_A, full_name: "octo/a" }]),
    });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 1 });
    const gen = generationProjection(harness.handle, CTX);
    const store = artifactStore(harness.handle, CTX);

    // Brief generated for head-1, then a new push queued head-2 → the CURRENT
    // span has no brief yet: briefAvailable=false, headSha=head-2, base=null.
    await gen.upsertQueued({ pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-1", baselineSha: null });
    await store.briefs.write({
      pullRequestId: pr.id, baseSha: "base-1", headSha: "head-1", headIndex: 1,
      commitCount: 1, provider: "anthropic", model: "claude", effort: "high", body: "{}",
    });
    await gen.markSucceeded({ pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-1", baselineSha: null });
    await new Promise((r) => setTimeout(r, 5));
    await gen.upsertQueued({ pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-2", baselineSha: null });

    const waiting = await get("/api/pulls", cookie);
    const waitingBody = (await waiting.json()) as { pulls: Array<Record<string, unknown>> };
    expect(waitingBody.pulls[0]).toMatchObject({
      headSha: "head-2",
      baseSha: null,
      briefAvailable: false,
      generation: { status: GenerationStatus.QUEUED, phase: null, attempts: 0, error: null },
    });

    // The brief for head-2 lands → available, span filled from the brief row.
    await store.briefs.write({
      pullRequestId: pr.id, baseSha: "base-2", headSha: "head-2", headIndex: 2,
      commitCount: 2, provider: "anthropic", model: "claude", effort: "high", body: "{}",
    });
    const ready = await get("/api/pulls", cookie);
    const readyBody = (await ready.json()) as { pulls: Array<Record<string, unknown>> };
    expect(readyBody.pulls[0]).toMatchObject({
      headSha: "head-2",
      baseSha: "base-2",
      briefAvailable: true,
    });
  });

  it("list: allowed-set cache — two calls, one installations fetch", async () => {
    const counts = stubGitHub({
      installations: () => installationsOk([{ id: REPO_A, full_name: "octo/a" }]),
    });
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 1 });

    expect((await get("/api/pulls", cookie)).status).toBe(200);
    expect((await get("/api/pulls", cookie)).status).toBe(200);
    expect(counts.installations).toBe(1);
  });

  it("list: limit caps rows; an out-of-range or malformed limit is a 400", async () => {
    stubGitHub({
      installations: () => installationsOk([{ id: REPO_A, full_name: "octo/a" }]),
    });
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 1 });
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 2 });

    const limited = await get("/api/pulls?limit=1", cookie);
    const body = (await limited.json()) as { pulls: unknown[] };
    expect(body.pulls).toHaveLength(1);

    expect((await get("/api/pulls?limit=101", cookie)).status).toBe(400);
    expect((await get("/api/pulls?limit=abc", cookie)).status).toBe(400);
  });

  // Long timeout: octokit's retry plugin retries the 500 with backoff before
  // the sanitized error surfaces (same as reads.test.ts's 406 case).
  it("list: GitHub failure → 502, NEVER a DB-only listing", { timeout: 20_000 }, async () => {
    stubGitHub({ installations: () => jsonResponse({ message: "boom" }, 500) });
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 1 });

    const res = await get("/api/pulls", cookie);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("prNumber"); // no rows leak on failure
  });

  it("list: 401 from GitHub → refresh → retry succeeds", async () => {
    const counts = stubGitHub({
      installations: (call) =>
        call === 0
          ? jsonResponse({ message: "expired" }, 401)
          : installationsOk([{ id: REPO_A, full_name: "octo/a" }]),
      token: () => jsonResponse(TOKEN_SUCCESS),
    });
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 1 });

    const res = await get("/api/pulls", cookie);
    expect(res.status).toBe(200);
    expect(counts.token).toBe(1);
    expect(counts.installations).toBe(2);
  });

  it("list: refresh failure → 401 (session burned)", async () => {
    stubGitHub({
      installations: () => jsonResponse({ message: "expired" }, 401),
      token: () =>
        jsonResponse({
          error: "bad_refresh_token",
          error_description: "expired",
          error_uri: "https://docs.github.com/",
        }),
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await get("/api/pulls", cookie);
    expect(res.status).toBe(401);
    const rows = await harness.raw("select count(*)::int as n from reviewer_session");
    expect(rows[0]?.["n"]).toBe(0);
  });

  // --------------------------------------------------------------- PR meta

  function repoOk(): Response {
    return jsonResponse({ id: REPO_A, full_name: "octo/verified-a", private: true });
  }

  it("meta: 404 posture identical to artifact GETs (no access / unknown PR / bad number)", async () => {
    stubGitHub({ repositories: () => jsonResponse({ message: "denied" }, 404) });
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 1 });

    expect((await get(`/api/repos/${REPO_A}/pulls/1`)).status).toBe(401); // no cookie
    expect((await get(`/api/repos/${REPO_A}/pulls/1`, cookie)).status).toBe(404); // no repo access

    stubGitHub({ repositories: () => repoOk() });
    expect((await get(`/api/repos/${REPO_A}/pulls/999`, cookie)).status).toBe(404); // unknown PR
    expect((await get(`/api/repos/${REPO_A}/pulls/nope`, cookie)).status).toBe(400); // bad number
  });

  it("meta: returns the PR row, current span, briefAvailable, and generation summary", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7, title: "the pr" });
    const gen = generationProjection(harness.handle, CTX);
    await gen.upsertQueued({ pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-1", baselineSha: null });

    const waiting = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(waiting.status).toBe(200);
    expect(waiting.headers.get("cache-control")).toBe("no-store");
    const waitingBody = (await waiting.json()) as Record<string, unknown>;
    expect(waitingBody).toMatchObject({
      repoId: String(REPO_A),
      repoSlug: "octo/verified-a",
      prNumber: 7,
      title: "the pr",
      state: "open",
      headSha: "head-1",
      baseSha: null,
      briefAvailable: false,
      generation: { status: GenerationStatus.QUEUED, attempts: 0 },
    });

    await artifactStore(harness.handle, CTX).briefs.write({
      pullRequestId: pr.id, baseSha: "base-1", headSha: "head-1", headIndex: 1,
      commitCount: 1, provider: "anthropic", model: "claude", effort: "high", body: "{}",
    });
    await gen.markSucceeded({ pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-1", baselineSha: null });

    const ready = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    const readyBody = (await ready.json()) as Record<string, unknown>;
    expect(readyBody).toMatchObject({
      headSha: "head-1",
      baseSha: "base-1",
      briefAvailable: true,
      generation: { status: GenerationStatus.SUCCEEDED, phase: null },
    });
  });
});
