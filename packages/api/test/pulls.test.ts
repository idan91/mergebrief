// BRIEF-19 PR 1.2 endpoint tests: the session-scoped PR list (`GET /api/pulls`)
// and the per-PR meta endpoint (`GET /api/repos/:repoId/pulls/:prNumber`).
// Same harness as reads.test.ts: `app.request()` over PGlite, GitHub stubbed at
// the global-fetch seam. The list's allowed-repo set comes from
// `GET /user/installations/{id}/repositories` with the viewer's token — a
// GitHub failure must fail the list (401/502), NEVER degrade to a DB-only
// (leaky) listing.
import { randomBytes } from "node:crypto";
import {
  artifactStore,
  encryptToken,
  envKeyProvider,
  forTenant,
  generationProjection,
  GenerationKind,
  GenerationStatus,
  grantAuth,
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
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { testLogger } from "./logging";

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
  const grant = await grantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  await forTenant(handle, CTX).sessions.create({
    sessionTokenHash: hash,
    reviewerId: brand(isReviewerId, REVIEWER_ID),
    reviewerLogin: "octocat",
    grantId: grant.id,
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
  readonly baseSha?: string;
  readonly draft?: boolean;
  readonly authorLogin?: string;
}

async function seedPr(handle: AppDatabase, input: SeedPrInput) {
  const ctx = input.ctx ?? CTX;
  return forTenant(handle, ctx).pullRequests.upsert({
    repoId: brand(isRepoId, input.repoId),
    prNumber: input.prNumber,
    repoSlug: input.slug ?? "octo/hello",
    title: input.title ?? `PR ${input.prNumber}`,
    ...(input.baseSha === undefined ? {} : { baseSha: input.baseSha }),
    ...(input.draft === undefined ? {} : { draft: input.draft }),
    ...(input.authorLogin === undefined ? {} : { authorLogin: input.authorLogin }),
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


// PR-meta `revisions[]` wire shape + runtime guards (BRIEF-24) — the test
// boundary parses, never casts.
interface RevisionEntry {
  readonly headSha: string;
  readonly baseSha: string;
  readonly headIndex: number;
  readonly createdAt: string;
  readonly generatedAt: string;
  readonly comparisons: {
    readonly previousBrief?: Record<string, unknown>;
    readonly lastReview?: Record<string, unknown>;
  };
}

interface MetaRevisionsBody {
  readonly briefAvailable: boolean;
  readonly comparisons?: Record<string, unknown>;
  readonly revisions?: RevisionEntry[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRevisionEntry(value: unknown): value is RevisionEntry {
  if (!isPlainRecord(value)) return false;
  const comparisons = value["comparisons"];
  return (
    typeof value["headSha"] === "string" &&
    typeof value["baseSha"] === "string" &&
    typeof value["headIndex"] === "number" &&
    typeof value["createdAt"] === "string" &&
    typeof value["generatedAt"] === "string" &&
    isPlainRecord(comparisons)
  );
}

function isMetaRevisionsBody(value: unknown): value is MetaRevisionsBody {
  if (!isPlainRecord(value) || typeof value["briefAvailable"] !== "boolean") return false;
  const comparisons = value["comparisons"];
  if (comparisons !== undefined && !isPlainRecord(comparisons)) return false;
  const revisions = value["revisions"];
  return (
    revisions === undefined ||
    (Array.isArray(revisions) && revisions.every((entry) => isRevisionEntry(entry)))
  );
}

// Conversation port stub (BRIEF-25): these tests never exercise the
// conversation read; a hit here is a test bug.
const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
};

describe("GET /api/pulls + GET /api/repos/:repoId/pulls/:prNumber", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = keyProvider();
    app = createApp({ logger: testLogger(), handle: harness.handle, webhookSecret: SECRET, auth: authDeps(kp), github: unusedConversationPort });
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

  it("list: exposes draft + viewerIsAuthor per row, never the author login (BRIEF-43)", async () => {
    stubGitHub({
      installations: () => installationsOk([{ id: REPO_A, full_name: "octo/verified-a" }]),
    });
    // The seeded session's reviewer login is "octocat".
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 1, draft: true, authorLogin: "octocat" });
    await new Promise((r) => setTimeout(r, 5));
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 2, draft: true, authorLogin: "not-octocat" });
    await new Promise((r) => setTimeout(r, 5));
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 3 }); // no author, not draft

    const res = await get("/api/pulls", cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pulls: Array<Record<string, unknown>> };
    expect(body.pulls.map((p) => p["prNumber"])).toEqual([3, 2, 1]);
    // Own draft → true; someone else's draft → false; null author → false.
    expect(body.pulls[2]).toMatchObject({ draft: true, viewerIsAuthor: true });
    expect(body.pulls[1]).toMatchObject({ draft: true, viewerIsAuthor: false });
    expect(body.pulls[0]).toMatchObject({ draft: false, viewerIsAuthor: false });
    // The author login must never cross to the FE — in any casing/shape.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("author_login");
    expect(raw).not.toContain("authorLogin");
    expect(raw).not.toContain("not-octocat");
  });

  it("list: viewerCanResolve derives from authorship ONLY — no per-repo capability on the list path (BRIEF-93)", async () => {
    // The list endpoint's allowed-set intersection carries no permissions
    // block, so push capability is unknown there. Fail closed: the field is
    // authorship-only on list rows; the brief page reads the real capability
    // from PR meta (per-repo gate path).
    stubGitHub({
      installations: () => installationsOk([{ id: REPO_A, full_name: "octo/verified-a" }]),
    });
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 1, authorLogin: "octocat" });
    await new Promise((r) => setTimeout(r, 5));
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 2, authorLogin: "not-octocat" });

    const res = await get("/api/pulls", cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pulls: Array<Record<string, unknown>> };
    expect(body.pulls[1]).toMatchObject({ viewerIsAuthor: true, viewerCanResolve: true });
    expect(body.pulls[0]).toMatchObject({ viewerIsAuthor: false, viewerCanResolve: false });
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

  function repoOk(canPush?: boolean): Response {
    // `canPush` undefined = no permissions block at all (fail-closed parse).
    return jsonResponse({
      id: REPO_A,
      full_name: "octo/verified-a",
      private: true,
      ...(canPush === undefined
        ? {}
        : { permissions: { admin: false, push: canPush, pull: true } }),
    });
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
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7, title: "the pr", baseSha: "base-1" });
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
      // Persisted at ingest — the span is known before any brief (BRIEF-21).
      baseSha: "base-1",
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

  it("meta: exposes draft + viewerIsAuthor=true when the viewer authored the draft (BRIEF-43)", async () => {
    stubGitHub({ repositories: () => repoOk() });
    // The seeded session's reviewer login is "octocat".
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7, draft: true, authorLogin: "octocat" });

    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["draft"]).toBe(true);
    expect(body["viewerIsAuthor"]).toBe(true);
    // The login itself must never cross to the FE.
    expect(JSON.stringify(body)).not.toContain("author_login");
    expect(body["authorLogin"]).toBeUndefined();
  });

  it("meta: carries the instance draftPolicy — default and injected (BRIEF-64)", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7, draft: true, authorLogin: "octocat" });

    // Default app (no draftPolicy dep) → the zero-config policy.
    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["draftPolicy"]).toEqual({ generate: true, debounceSeconds: null });

    // Injected policy is echoed for the FE's copy states.
    const policyApp = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: authDeps(kp),
      github: unusedConversationPort,
      draftPolicy: { generate: false, debounceSeconds: 900 },
    });
    const policyRes = await policyApp.request(`/api/repos/${REPO_A}/pulls/7`, {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(policyRes.status).toBe(200);
    const policyBody = (await policyRes.json()) as Record<string, unknown>;
    expect(policyBody["draftPolicy"]).toEqual({ generate: false, debounceSeconds: 900 });
  });

  it("meta: viewerIsAuthor=false for a non-author viewer and for a null author (BRIEF-43)", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    // Authored by someone else.
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7, draft: true, authorLogin: "not-octocat" });
    const other = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(((await other.json()) as Record<string, unknown>)["viewerIsAuthor"]).toBe(false);

    // No stored author (null) must never match — not even a null viewer login.
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 8 });
    const noAuthor = await get(`/api/repos/${REPO_A}/pulls/8`, cookie);
    const noAuthorBody = (await noAuthor.json()) as Record<string, unknown>;
    expect(noAuthorBody["viewerIsAuthor"]).toBe(false);
    expect(noAuthorBody["draft"]).toBe(false);
  });

  it("meta: viewerCanResolve=true from push permission, and it rides the gate's positive cache (BRIEF-93)", async () => {
    const counts = stubGitHub({ repositories: () => repoOk(true) });
    const cookie = await seedSession(harness.handle, kp);
    // Not the author — capability comes from `permissions.push` alone.
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7, authorLogin: "not-octocat" });

    const first = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody["viewerCanResolve"]).toBe(true);
    expect(firstBody["viewerIsAuthor"]).toBe(false);

    // Second read inside the 60s TTL: NO second GitHub access check — the
    // capability must come from the positive-cache entry, not a re-fetch.
    const second = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(second.status).toBe(200);
    expect(((await second.json()) as Record<string, unknown>)["viewerCanResolve"]).toBe(true);
    expect(counts.repositories).toBe(1);
  });

  it("meta: viewerCanResolve=true for the PR author without push permission (BRIEF-93)", async () => {
    stubGitHub({ repositories: () => repoOk(false) });
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7, authorLogin: "octocat" });

    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["viewerCanResolve"]).toBe(true);
    expect(body["viewerIsAuthor"]).toBe(true);
  });

  it("meta: viewerCanResolve=false without push or authorship; an absent permissions block fails closed (BRIEF-93)", async () => {
    // No permissions block in the repo payload at all — must parse as no
    // capability, never as a grant.
    const counts = stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7, authorLogin: "not-octocat" });

    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["viewerCanResolve"]).toBe(false);

    // The cache-hit path must stay fail-closed too — a second read inside the
    // TTL (no re-fetch) may not invent a capability the check never saw.
    const second = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(second.status).toBe(200);
    expect(((await second.json()) as Record<string, unknown>)["viewerCanResolve"]).toBe(false);
    expect(counts.repositories).toBe(1);
  });

  it("meta: previous-brief comparison availability derives from marks + narrative rows", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = artifactStore(harness.handle, CTX);
    const write = async (head: string, index: number) => {
      const result = await store.briefs.write({
        pullRequestId: pr.id, baseSha: "base", headSha: head, headIndex: index,
        commitCount: index, provider: "anthropic", model: "claude", effort: "high", body: "{}",
      });
      if (!result.ok) throw new Error("brief write failed");
      return result.value;
    };
    await write("head-1", 1);
    const currentBrief = await write("head-2", 2);

    // No marks yet → previousBrief absent (fail closed).
    const before = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    const beforeBody = (await before.json()) as { comparisons?: { previousBrief?: unknown } };
    expect(beforeBody.comparisons?.previousBrief).toBeUndefined();

    // Marks for the previous-brief span → available, narrative not yet.
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-1",
        headSha: "head-2",
        files: [{ file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] }],
      },
    });
    if (!marks.ok) throw new Error("marks write failed");
    const marked = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    const markedBody = (await marked.json()) as { comparisons?: { previousBrief?: unknown } };
    expect(markedBody.comparisons?.previousBrief).toEqual({
      baselineSha: "head-1",
      baselineIndex: 1,
      narrativeAvailable: false,
    });

    // Narrative lands → narrativeAvailable flips.
    const narrative = await store.revisionNarratives.write({
      pullRequestId: pr.id, briefId: currentBrief.id, prevHeadSha: "head-1", headSha: "head-2",
      body: "{}", provider: "anthropic", model: "claude", effort: "high",
    });
    if (!narrative.ok) throw new Error("narrative write failed");
    const full = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    const fullBody = (await full.json()) as { comparisons?: { previousBrief?: unknown } };
    expect(fullBody.comparisons?.previousBrief).toEqual({
      baselineSha: "head-1",
      baselineIndex: 1,
      narrativeAvailable: true,
    });
  });

  // ------------------------------------------- meta: lastReview (BRIEF-21)

  interface MetaComparisons {
    comparisons?: { lastReview?: Record<string, unknown> };
  }

  async function metaLastReview(cookie: string): Promise<Record<string, unknown> | undefined> {
    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetaComparisons;
    return body.comparisons?.lastReview;
  }

  async function seedCheckpoint(
    pullRequestId: Parameters<ReturnType<typeof forTenant>["checkpoints"]["get"]>[0],
    reviewerId: number,
    lastSubmittedSha: string,
    ctx: TenantContext = CTX,
  ): Promise<void> {
    const result = await forTenant(harness.handle, ctx).checkpoints.upsertOnSubmit({
      pullRequestId,
      reviewerId: brand(isReviewerId, reviewerId),
      reviewerLogin: `reviewer-${reviewerId}`,
      lastSubmittedSha,
      submittedAt: new Date("2026-07-01T00:00:00Z"),
    });
    if (!result.ok) throw new Error("checkpoint seed failed");
  }

  async function seedBriefs(pr: { id: Parameters<ReturnType<typeof artifactStore>["briefs"]["listForPullRequest"]>[0] }): Promise<void> {
    const store = artifactStore(harness.handle, CTX);
    for (const [head, index] of [["head-1", 1], ["head-2", 2]] as const) {
      const result = await store.briefs.write({
        pullRequestId: pr.id, baseSha: "base", headSha: head, headIndex: index,
        commitCount: index, provider: "anthropic", model: "claude", effort: "high", body: "{}",
      });
      if (!result.ok) throw new Error("brief write failed");
    }
  }

  it("meta: lastReview absent without a checkpoint; another reviewer's checkpoint never drives it", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);

    expect(await metaLastReview(cookie)).toBeUndefined();

    // A DIFFERENT reviewer submitted — the session reviewer still has nothing.
    await seedCheckpoint(pr.id, 999, "head-1");
    expect(await metaLastReview(cookie)).toBeUndefined();
  });

  it("meta: lastReview available tiers — marks+delta, then marks-only", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-1");
    const store = artifactStore(harness.handle, CTX);

    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-1",
        headSha: "head-2",
        files: [{ file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] }],
      },
    });
    if (!marks.ok) throw new Error("marks write failed");

    // Marks-only: an OFFER with the delta core absent.
    expect(await metaLastReview(cookie)).toEqual({
      deltaAvailable: false,
      baselineSha: "head-1",
      baselineIndex: 1,
    });

    const delta = await store.deltas.write({
      pullRequestId: pr.id, baselineSha: "head-1", headSha: "head-2",
      provider: "anthropic", model: "claude", effort: "high", body: "{}",
    });
    if (!delta.ok) throw new Error("delta write failed");

    expect(await metaLastReview(cookie)).toEqual({
      deltaAvailable: true,
      baselineSha: "head-1",
      baselineIndex: 1,
    });
  });

  it("meta: lastReview unavailable reasons — pending vs baseline-unavailable", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);
    // Checkpoint SHA that was never briefed (rewritten history) — no marks.
    await seedCheckpoint(pr.id, REVIEWER_ID, "gone-sha");

    expect(await metaLastReview(cookie)).toEqual({ unavailable: "baseline-unavailable" });

    // A non-terminal delta generation for the exact span flips it to pending.
    const gen = generationProjection(harness.handle, CTX);
    const queued = await gen.upsertQueued({
      pullRequestId: pr.id, kind: GenerationKind.DELTA, headSha: "head-2", baselineSha: "gone-sha",
    });
    if (!queued.ok) throw new Error("generation seed failed");
    expect(await metaLastReview(cookie)).toEqual({ unavailable: "pending" });

    // Terminal failure → back to baseline-unavailable (nothing is coming).
    const failed = await gen.markFailed(
      { pullRequestId: pr.id, kind: GenerationKind.DELTA, headSha: "head-2", baselineSha: "gone-sha" },
      "span diff unavailable",
    );
    if (!failed.ok) throw new Error("generation transition failed");
    expect(await metaLastReview(cookie)).toEqual({ unavailable: "baseline-unavailable" });
  });

  it("meta: lastReview is pending while the current head's BRIEF generation is warming (codex PR-45 finding)", async () => {
    // Production writes no delta-kind projection rows (warmDeltaCores runs
    // inside the brief job): while that job is non-terminal and marks are
    // absent, the reason must be pending, NOT baseline-unavailable.
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-1");

    const gen = generationProjection(harness.handle, CTX);
    const queued = await gen.upsertQueued({
      pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-2", baselineSha: null,
    });
    if (!queued.ok) throw new Error("generation seed failed");
    expect(await metaLastReview(cookie)).toEqual({ unavailable: "pending" });

    // Brief job finished, still no marks → nothing is coming for this span.
    const done = await gen.markSucceeded({
      pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-2", baselineSha: null,
    });
    if (!done.ok) throw new Error("generation transition failed");
    expect(await metaLastReview(cookie)).toEqual({ unavailable: "baseline-unavailable" });
  });

  it("meta: lastReview absent when the checkpoint IS the current head (empty span)", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-2");
    expect(await metaLastReview(cookie)).toBeUndefined();
  });

  it("meta: lastReview never leaks a cross-tenant checkpoint", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);
    // Same reviewer id, same PR number — but the OTHER tenant's PR row.
    const otherPr = await seedPr(harness.handle, { ctx: OTHER_CTX, repoId: REPO_A, prNumber: 7 });
    await seedCheckpoint(otherPr.id, REVIEWER_ID, "head-1", OTHER_CTX);

    expect(await metaLastReview(cookie)).toBeUndefined();
  });

  // -------------------------------------- meta: revisions[] (BRIEF-24)

  async function metaBody(cookie: string): Promise<MetaRevisionsBody> {
    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const raw: unknown = await res.json();
    if (!isMetaRevisionsBody(raw)) throw new Error("PR-meta body failed the revisions shape guard");
    return raw;
  }

  /** Write a brief with its OWN base (base drift across revisions). */
  async function writeBrief(
    prId: Parameters<ReturnType<typeof artifactStore>["briefs"]["listForPullRequest"]>[0],
    base: string,
    head: string,
    index: number,
  ): Promise<void> {
    const result = await artifactStore(harness.handle, CTX).briefs.write({
      pullRequestId: prId, baseSha: base, headSha: head, headIndex: index,
      commitCount: index, provider: "anthropic", model: "claude", effort: "high", body: "{}",
    });
    if (!result.ok) throw new Error("brief write failed");
  }

  it("meta: revisions absent until a brief exists, then lists every head in headIndex order", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });

    // No brief yet → no revisions key at all.
    const gen = generationProjection(harness.handle, CTX);
    await gen.upsertQueued({ pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-1", baselineSha: null });
    const early = await metaBody(cookie);
    expect(early.briefAvailable).toBe(false);
    expect(early.revisions).toBeUndefined();

    // Three briefed heads, each with its OWN drifting base.
    await writeBrief(pr.id, "base-a", "head-1", 1);
    await writeBrief(pr.id, "base-b", "head-2", 2);
    await writeBrief(pr.id, "base-c", "head-3", 3);
    await gen.upsertQueued({ pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-3", baselineSha: null });

    const body = await metaBody(cookie);
    expect(body.revisions?.map((r) => [r.headIndex, r.headSha, r.baseSha])).toEqual([
      [1, "head-1", "base-a"],
      [2, "head-2", "base-b"],
      [3, "head-3", "base-c"],
    ]);
    // Each entry carries serialized createdAt/generatedAt timestamps.
    for (const rev of body.revisions ?? []) {
      expect(typeof rev.createdAt).toBe("string");
      expect(Number.isNaN(Date.parse(rev.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(rev.generatedAt))).toBe(false);
    }
    // generatedAt is the generation row's created_at (BRIEF-95): head-1 was
    // enqueued BEFORE its brief artifact was written, so its cutoff is never
    // later than the artifact write; head-2 has no projection row and falls
    // back to the artifact's own createdAt.
    const [rev1, rev2] = body.revisions ?? [];
    if (rev1 === undefined || rev2 === undefined) throw new Error("revisions missing");
    expect(Date.parse(rev1.generatedAt)).toBeLessThanOrEqual(Date.parse(rev1.createdAt));
    expect(rev2.generatedAt).toBe(rev2.createdAt);
  });

  it("meta: per-revision previousBrief joins consecutive briefed pairs only", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = artifactStore(harness.handle, CTX);
    await writeBrief(pr.id, "base", "head-1", 1);
    await writeBrief(pr.id, "base", "head-2", 2);
    await writeBrief(pr.id, "base", "head-3", 3);

    // Marks for the (head-2 → head-3) span only.
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-2", headSha: "head-3",
        files: [{ file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] }],
      },
    });
    if (!marks.ok) throw new Error("marks write failed");

    const body = await metaBody(cookie);
    const byHead = new Map((body.revisions ?? []).map((r) => [r.headSha, r]));
    // head-1: no previous head → no previousBrief.
    expect(byHead.get("head-1")?.comparisons.previousBrief).toBeUndefined();
    // head-2: previous = head-1, but no marks → absent (fail closed).
    expect(byHead.get("head-2")?.comparisons.previousBrief).toBeUndefined();
    // head-3: previous = head-2, marks exist → offered, narrative not yet.
    expect(byHead.get("head-3")?.comparisons.previousBrief).toEqual({
      baselineSha: "head-2",
      baselineIndex: 2,
      narrativeAvailable: false,
    });
  });

  it("meta: per-revision lastReview is forward-span only; marks-only tier renders", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = artifactStore(harness.handle, CTX);
    await writeBrief(pr.id, "base", "head-1", 1);
    await writeBrief(pr.id, "base", "head-2", 2);
    await writeBrief(pr.id, "base", "head-3", 3);
    // The reviewer last submitted at head-2.
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-2");

    // Forward marks (head-2 → head-3) exist; the backward span never will.
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-2", headSha: "head-3",
        files: [{ file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] }],
      },
    });
    if (!marks.ok) throw new Error("marks write failed");

    const body = await metaBody(cookie);
    const byHead = new Map((body.revisions ?? []).map((r) => [r.headSha, r]));
    // head-1 is BEFORE the checkpoint (backward span) → no marks → no offer.
    // Historical head with no marks and no active warming → baseline-unavailable.
    expect(byHead.get("head-1")?.comparisons.lastReview).toEqual({
      unavailable: "baseline-unavailable",
    });
    // head-2 IS the checkpoint (empty span) → nothing to explain.
    expect(byHead.get("head-2")?.comparisons.lastReview).toBeUndefined();
    // head-3: forward span with marks, delta core absent → marks-only offer.
    expect(byHead.get("head-3")?.comparisons.lastReview).toEqual({
      deltaAvailable: false,
      baselineSha: "head-2",
      baselineIndex: 2,
    });
  });

  it("meta: top-level comparisons stays byte-compatible with the latest revision's (BRIEF-21 regression)", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = artifactStore(harness.handle, CTX);
    await writeBrief(pr.id, "base", "head-1", 1);
    await writeBrief(pr.id, "base", "head-2", 2);
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-1");

    // Previous-brief marks + last-review marks both land on the latest span.
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-1", headSha: "head-2",
        files: [{ file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] }],
      },
    });
    if (!marks.ok) throw new Error("marks write failed");

    const body = await metaBody(cookie);
    const latest = (body.revisions ?? []).find((r) => r.headSha === "head-2");
    // The top-level envelope IS the latest head's — same keys, same values.
    expect(body.comparisons).toEqual(latest?.comparisons);
    expect(body.comparisons).toEqual({
      previousBrief: { baselineSha: "head-1", baselineIndex: 1, narrativeAvailable: false },
      lastReview: { deltaAvailable: false, baselineSha: "head-1", baselineIndex: 1 },
    });
  });

  it("meta: top-level comparisons track the CURRENT revision when the same head is rebriefed under a drifted base (codex round-1 finding)", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = artifactStore(harness.handle, CTX);

    // head-2 briefed (idx 1), head-3 briefed (idx 2), then a base retarget
    // re-briefs the SAME head-2 under a new base (idx 3) — two revision rows
    // now share headSha "head-2". The current revision is idx 3.
    await writeBrief(pr.id, "base-a", "head-2", 1);
    await writeBrief(pr.id, "base-a", "head-3", 2);
    await writeBrief(pr.id, "base-b", "head-2", 3);

    // Marks for the current revision's previous-brief span (head-3 → head-2).
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-3", headSha: "head-2",
        files: [{ file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] }],
      },
    });
    if (!marks.ok) throw new Error("marks write failed");

    const body = await metaBody(cookie);
    // Both duplicate-head entries are listed, each with its OWN base.
    expect(body.revisions?.map((r) => [r.headIndex, r.headSha, r.baseSha])).toEqual([
      [1, "head-2", "base-a"],
      [2, "head-3", "base-a"],
      [3, "head-2", "base-b"],
    ]);
    // The stale idx-1 entry has no previous head → no previousBrief.
    expect(body.revisions?.[0]?.comparisons.previousBrief).toBeUndefined();
    // The CURRENT (idx 3) entry's previous briefed head is head-3.
    const current = { baselineSha: "head-3", baselineIndex: 2, narrativeAvailable: false };
    expect(body.revisions?.[2]?.comparisons.previousBrief).toEqual(current);
    // Top-level comparisons must be the CURRENT revision's — a headSha-only
    // match would pick the stale idx-1 duplicate and report no previousBrief.
    expect(body.comparisons).toEqual({ previousBrief: current });
  });

  it("meta: duplicate-head revisions share the same lastReview — marks are a pure function of the SHA pair (locked decision, codex round-2)", async () => {
    // Plan decision #3 (BRIEF-24 grill): lastReview at a head is ROW EXISTENCE
    // for (checkpointSha -> head), no special-casing. Two revision entries
    // sharing a headSha (rebriefed under a drifted base) view the SAME commit;
    // the comparison renders identically at both, so both carry the offer —
    // even when the baseline's brief index is higher than the earlier
    // duplicate's own index (accurate metadata, not an error).
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = artifactStore(harness.handle, CTX);

    await writeBrief(pr.id, "base-a", "head-2", 1);
    await writeBrief(pr.id, "base-a", "head-3", 2);
    await writeBrief(pr.id, "base-b", "head-2", 3);
    // The reviewer last submitted at head-3; the worker warmed the forward
    // span (head-3 -> head-2) for the current (rebriefed) revision.
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-3");
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-3", headSha: "head-2",
        files: [{ file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] }],
      },
    });
    if (!marks.ok) throw new Error("marks write failed");

    const body = await metaBody(cookie);
    const expected = { deltaAvailable: false, baselineSha: "head-3", baselineIndex: 2 };
    // Both head-2 entries (idx 1 and idx 3) carry the identical offer.
    expect(body.revisions?.[0]?.comparisons.lastReview).toEqual(expected);
    expect(body.revisions?.[2]?.comparisons.lastReview).toEqual(expected);
    // The head-3 entry IS the checkpoint (empty span) — nothing to explain.
    expect(body.revisions?.[1]?.comparisons.lastReview).toBeUndefined();
  });

  it("meta: duplicate-head revisions agree on PENDING while the current head is warming (codex round-3 finding)", async () => {
    // lastReview is a pure function of (checkpoint, headSha) — including the
    // pending/unavailable distinction. When the current head also exists as an
    // OLDER duplicate row (retarget re-brief) and its brief generation is
    // still non-terminal with no marks yet, BOTH entries must report pending;
    // a row-identity probe gate would split them.
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });

    await writeBrief(pr.id, "base-a", "head-2", 1);
    await writeBrief(pr.id, "base-a", "head-3", 2);
    await writeBrief(pr.id, "base-b", "head-2", 3);
    // Checkpoint SHA with no marks anywhere; the current head's BRIEF
    // generation is still warming (marks land before it succeeds).
    await seedCheckpoint(pr.id, REVIEWER_ID, "gone-sha");
    const gen = generationProjection(harness.handle, CTX);
    const queued = await gen.upsertQueued({
      pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-2", baselineSha: null,
    });
    if (!queued.ok) throw new Error("generation seed failed");

    const warming = await metaBody(cookie);
    // Both head-2 entries (idx 1 and idx 3): identical pending state.
    expect(warming.revisions?.[0]?.comparisons.lastReview).toEqual({ unavailable: "pending" });
    expect(warming.revisions?.[2]?.comparisons.lastReview).toEqual({ unavailable: "pending" });
    // head-3 is historical (not the current head) — never warming.
    expect(warming.revisions?.[1]?.comparisons.lastReview).toEqual({
      unavailable: "baseline-unavailable",
    });

    // Warming over, still no marks → all head-2 entries agree on unavailable.
    const done = await gen.markSucceeded({
      pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-2", baselineSha: null,
    });
    if (!done.ok) throw new Error("generation transition failed");
    const settled = await metaBody(cookie);
    expect(settled.revisions?.[0]?.comparisons.lastReview).toEqual({
      unavailable: "baseline-unavailable",
    });
    expect(settled.revisions?.[2]?.comparisons.lastReview).toEqual({
      unavailable: "baseline-unavailable",
    });
  });

  it("meta: revisions never leak across tenants", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const cookie = await seedSession(harness.handle, kp);
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await writeBrief(pr.id, "base", "head-1", 1);

    // Another tenant's PR (same repo id + number) with its own briefs.
    const otherPr = await seedPr(harness.handle, { ctx: OTHER_CTX, repoId: REPO_A, prNumber: 7 });
    const otherWrite = await artifactStore(harness.handle, OTHER_CTX).briefs.write({
      pullRequestId: otherPr.id, baseSha: "x", headSha: "other-head", headIndex: 9,
      commitCount: 1, provider: "anthropic", model: "claude", effort: "high", body: "{}",
    });
    if (!otherWrite.ok) throw new Error("other brief write failed");

    const body = await metaBody(cookie);
    expect(body.revisions?.map((r) => r.headSha)).toEqual(["head-1"]);
  });
});
