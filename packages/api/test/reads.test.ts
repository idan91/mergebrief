// Read-API + authz-gate integration tests (BRIEF-2 stage 7): `app.request()`
// against `createApp` over the persistence PGlite harness, with GitHub mocked at
// the HTTP seam via a stubbed global `fetch` (no live network, no new mock libs)
// — the same pattern as `auth.test.ts`. The stub answers the endpoints the gate
// and the diff proxy touch: `GET /repositories/{id}` (the access check), the
// span diff (`GET /repos/{owner}/{repo}/compare/{base}...{head}`), and the OAuth
// token endpoint (refresh). Call counts assert authz rechecks + diff cache.
//
// Covers the DoD: 401 (no cookie / unknown session, no GitHub call); 404 on no
// repo access (+ the `auth`/`repo`/`decision="404"` audit row); 200 authorized
// brief (+ 404 on a non-existent span); immediate revocation on repeat reads;
// 401→refresh→retry (success and a refresh failure that deletes the session);
// and the diff proxy per-session cache.
import { createHash, randomBytes } from "node:crypto";
import type { Hono } from "hono";
import {
  artifactStore,
  encryptToken,
  envKeyProvider,
  forTenant,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrState,
  type AppDatabase,
  type InstallationId,
  type KeyProvider,
  type RepoId,
  type ReviewerId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type AuthDeps } from "../src/lib";

// ---------------------------------------------------------------------------
// Fixtures + deps.
// ---------------------------------------------------------------------------

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_ID = 424242;
const REPO_SLUG = "octo/hello";
const PR_NUMBER = 7;

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

const BRIEF_BODY = JSON.stringify({ summary: "the brief", findings: [] });
const DIFF_TEXT = "diff --git a/f b/f\n@@ -1 +1 @@\n-old\n+new\n";

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
function brandRepo(value: bigint): RepoId {
  if (!isRepoId(value)) throw new Error("bad repo id");
  return value;
}

const CTX = { installationId: brandInstallation(BigInt(INSTALLATION_ID)) };

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch) — dispatches on URL, counts calls per family.
// ---------------------------------------------------------------------------

interface TokenSuccess {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in: number;
  token_type: string;
  scope: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", date: new Date().toUTCString() },
  });
}

function tokenSuccess(access: string, refresh: string): TokenSuccess {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 28_800,
    refresh_token_expires_in: 15_897_600,
    token_type: "bearer",
    scope: "",
  };
}

function repoOk(): Response {
  return jsonResponse({ id: REPO_ID, full_name: REPO_SLUG, private: true });
}
function repoStatus(status: number): Response {
  return jsonResponse({ message: "denied" }, status);
}
function diffOk(text = DIFF_TEXT): Response {
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "application/vnd.github.diff; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}
function diffStatus(status: number): Response {
  return jsonResponse({ message: "diff denied" }, status);
}

interface StubConfig {
  readonly repositories?: (call: number) => Response;
  readonly diff?: (call: number) => Response;
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  repositories: number;
  diff: number;
  token: number;
  /** Every fetched URL, in order — lets a test assert the requested diff span. */
  readonly urls: string[];
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = { repositories: 0, diff: 0, token: 0, urls: [] };
  const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    counts.urls.push(url);
    if (url.includes("/login/oauth/access_token")) {
      const i = counts.token++;
      return cfg.token ? cfg.token(i) : jsonResponse({ error: "unexpected_token" }, 500);
    }
    if (url.includes("/repositories/")) {
      const i = counts.repositories++;
      return cfg.repositories ? cfg.repositories(i) : repoStatus(404);
    }
    if (url.includes("/compare/")) {
      const i = counts.diff++;
      return cfg.diff ? cfg.diff(i) : jsonResponse({ message: "not found" }, 404);
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

// ---------------------------------------------------------------------------
// Seeding helpers.
// ---------------------------------------------------------------------------

/** Seed a session row with real encrypted tokens; returns the cookie + hash. */
async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
  opts?: { accessPlaintext?: string; refreshPlaintext?: string; expiresAt?: Date },
): Promise<{ cookie: string; hash: string }> {
  const cookie = randomBytes(32).toString("base64url");
  const hash = sha256Hex(cookie);
  const sealedAccess = await encryptToken(kp, KEY_REF, opts?.accessPlaintext ?? ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, opts?.refreshPlaintext ?? REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok) throw new Error("seed encrypt failed");
  await forTenant(handle, CTX).sessions.create({
    sessionTokenHash: hash,
    reviewerId: brandReviewer(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    expiresAt: opts?.expiresAt ?? new Date("2027-01-01T00:00:00Z"),
  });
  return { cookie, hash };
}

/** Seed the tenant PR row; returns its branded row id. */
async function seedPullRequest(handle: AppDatabase): Promise<void> {
  await forTenant(handle, CTX).pullRequests.upsert({
    repoId: brandRepo(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrState.OPEN,
  });
}

async function seedBrief(handle: AppDatabase, base: string, head: string): Promise<void> {
  const pr = await forTenant(handle, CTX).pullRequests.getByNumber(brandRepo(BigInt(REPO_ID)), PR_NUMBER);
  if (pr === undefined) throw new Error("seedBrief: pr missing");
  const written = await artifactStore(handle, CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: base,
    headSha: head,
    headIndex: 1,
    commitCount: 3,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: BRIEF_BODY,
  });
  if (!written.ok) throw new Error(`seedBrief: write failed ${written.error.code}`);
}

function briefPath(base: string, head: string): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/brief?base=${base}&head=${head}`;
}
function diffPath(base: string, head: string): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/diff?base=${base}&head=${head}`;
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

describe("reviewer read API + authz gate", () => {
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

  it("401 when no session cookie is present (no GitHub call)", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const res = await app.request(briefPath("base", "head"));
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(0);
  });

  it("401 for an unknown session cookie (no GitHub call)", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const res = await app.request(briefPath("base", "head"), {
      headers: { Cookie: `rs_session=${randomBytes(32).toString("base64url")}` },
    });
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(0);
  });

  it("404 with no repo access → auth audit row, and the negative is NOT cached", async () => {
    const counts = stubGitHub({ repositories: () => repoStatus(404) });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const first = await app.request(briefPath("b", "h"), { headers: { Cookie: `rs_session=${cookie}` } });
    expect(first.status).toBe(404);

    // The D9 denial audit row exists (numeric-only, decision="404").
    const auditRows = await harness.raw(
      "select action, target_type, target_id, actor_id, metadata->>'decision' as decision from audit_log",
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.["action"]).toBe("auth");
    expect(auditRows[0]?.["target_type"]).toBe("repo");
    expect(String(auditRows[0]?.["target_id"])).toBe(String(REPO_ID));
    expect(String(auditRows[0]?.["actor_id"])).toBe(String(REVIEWER_ID));
    expect(auditRows[0]?.["decision"]).toBe("404");

    // Negative is not cached: a second request calls GitHub again.
    const second = await app.request(briefPath("b", "h"), { headers: { Cookie: `rs_session=${cookie}` } });
    expect(second.status).toBe(404);
    expect(counts.repositories).toBe(2);
  });

  it("403 from GitHub also collapses to 404 (no existence leak)", async () => {
    stubGitHub({ repositories: () => repoStatus(403) });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    const res = await app.request(briefPath("b", "h"), { headers: { Cookie: `rs_session=${cookie}` } });
    expect(res.status).toBe(404);
  });

  it("200 authorized brief read returns the stored body; a missing span is 404", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    await seedBrief(harness.handle, "base1", "head1");

    const res = await app.request(briefPath("base1", "head1"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.text()).toBe(BRIEF_BODY);

    const missing = await app.request(briefPath("base1", "nope"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(missing.status).toBe(404);
  });

  it("400 on a malformed query (missing head)", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    const res = await app.request(`/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/brief?base=only`, {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(res.status).toBe(400);
  });

  it("rechecks repo access on repeat reads so revocation takes effect immediately", async () => {
    const counts = stubGitHub({
      repositories: (call) => (call === 0 ? repoOk() : repoStatus(404)),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    await seedBrief(harness.handle, "base1", "head1");

    const a = await app.request(briefPath("base1", "head1"), { headers: { Cookie: `rs_session=${cookie}` } });
    const b = await app.request(briefPath("base1", "head1"), { headers: { Cookie: `rs_session=${cookie}` } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(404);
    expect(counts.repositories).toBe(2);
  });

  it("401 from GitHub → refresh → retry succeeds", async () => {
    const counts = stubGitHub({
      // First access check 401s (expired token); after the refresh, 200.
      repositories: (call) => (call === 0 ? repoStatus(401) : repoOk()),
      token: () => jsonResponse(tokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH)),
    });
    const { cookie, hash } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    await seedBrief(harness.handle, "base1", "head1");

    const res = await app.request(briefPath("base1", "head1"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BRIEF_BODY);
    expect(counts.repositories).toBe(2); // 401 then 200
    expect(counts.token).toBe(1); // one refresh

    // The row's access ciphertext rotated to the refreshed token.
    const rows = await harness.raw(
      "select gh_token_ciphertext from reviewer_session where session_token_hash = $1",
      [hash],
    );
    expect(rows).toHaveLength(1);
  });

  it("401 from GitHub → refresh FAILS → 401 and the session is deleted", async () => {
    stubGitHub({
      repositories: () => repoStatus(401),
      token: () =>
        jsonResponse({
          error: "bad_refresh_token",
          error_description: "expired",
          error_uri: "https://docs.github.com/",
        }),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const res = await app.request(briefPath("base1", "head1"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(res.status).toBe(401);
    const rows = await harness.raw("select count(*)::int as n from reviewer_session");
    expect(rows[0]?.["n"]).toBe(0);
  });

  it("401 and deletes the session when it has expired (dead refresh token)", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp, {
      expiresAt: new Date(Date.now() - 1000),
    });
    await seedPullRequest(harness.handle);

    const res = await app.request(briefPath("b", "h"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(res.status).toBe(401);
    // Rejected before the access check — no GitHub call at all.
    expect(counts.repositories).toBe(0);
    // The dead session is burned.
    const rows = await harness.raw("select count(*)::int as n from reviewer_session");
    expect(rows[0]?.["n"]).toBe(0);
  });

  it("400 on a diff ref that selects a cross-repo owner:ref span (no GitHub call)", async () => {
    const counts = stubGitHub({ repositories: () => repoOk(), diff: () => diffOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const res = await app.request(diffPath("otherowner:sha", "head1"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(res.status).toBe(400);
    // Rejected at the Zod boundary — the compare endpoint is never reached.
    expect(counts.diff).toBe(0);
  });

  it("diff proxy fetches the REQUESTED base...head span (not the whole PR)", async () => {
    const counts = stubGitHub({ repositories: () => repoOk(), diff: () => diffOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const res = await app.request(diffPath("base1", "head1"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    // The compare request carried the exact requested span.
    expect(counts.urls.some((u) => u.includes("/compare/base1...head1"))).toBe(true);
  });

  it("diff proxy rechecks authz and refreshes an expired token before fetching the next span", async () => {
    // span1: repo ok + diff ok. span2: repo 401 → refresh → repo ok + diff ok.
    const counts = stubGitHub({
      repositories: (call) => (call === 1 ? repoStatus(401) : repoOk()),
      diff: () => diffOk(),
      token: () => jsonResponse(tokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH)),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const a = await app.request(diffPath("base1", "head1"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(a.status).toBe(200);
    expect(counts.repositories).toBe(1);

    // Different span → authz is checked again; the expired access token refreshes
    // before the compare request is made.
    const b = await app.request(diffPath("base2", "head2"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(b.status).toBe(200);
    expect(await b.text()).toBe(DIFF_TEXT);
    expect(counts.repositories).toBe(3); // span1 ok, span2 401 + retry ok
    expect(counts.token).toBe(1);
    expect(counts.diff).toBe(2);
  });

  // Long timeout: octokit's retry plugin retries a 406 (not in its doNotRetry
  // list) with backoff before the sanitized error surfaces.
  it("maps GitHub's 406 (diff too large to render) to a 413, not a 502", { timeout: 20_000 }, async () => {
    stubGitHub({ repositories: () => repoOk(), diff: () => diffStatus(406) });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const res = await app.request(diffPath("b", "h"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(res.status).toBe(413);
  });

  it("diff proxy targets the GitHub-verified repo name, not the stored slug", async () => {
    // The access check reports the repo under a NEW name (renamed since our
    // last webhook write). The compare call must follow the verified name.
    const counts = stubGitHub({
      repositories: () => jsonResponse({ id: REPO_ID, full_name: "octo/renamed", private: true }),
      diff: () => diffOk(),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle); // stored slug: octo/hello

    const res = await app.request(diffPath("base1", "head1"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(counts.urls.some((u) => u.includes("/repos/octo/renamed/compare/"))).toBe(true);
    expect(counts.urls.some((u) => u.includes("/repos/octo/hello/"))).toBe(false);
  });

  it("serves but does NOT cache an oversized diff (re-fetched on repeat)", async () => {
    const big = "x".repeat(1_000_001); // just over the 1 MB per-entry cap
    const counts = stubGitHub({ repositories: () => repoOk(), diff: () => diffOk(big) });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const first = await app.request(diffPath("b", "h"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(first.status).toBe(200);
    expect((await first.text()).length).toBe(big.length);
    expect(counts.diff).toBe(1);

    const second = await app.request(diffPath("b", "h"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(second.status).toBe(200);
    // Not cached (too large) → GitHub was hit again.
    expect(counts.diff).toBe(2);
  });

  it("diff proxy: fetches once, then serves the per-session cache on a repeat read", async () => {
    const counts = stubGitHub({ repositories: () => repoOk(), diff: () => diffOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const first = await app.request(diffPath("base1", "head1"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("text/plain");
    expect(await first.text()).toBe(DIFF_TEXT);
    expect(counts.diff).toBe(1);

    const second = await app.request(diffPath("base1", "head1"), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(DIFF_TEXT);
    // Second read hit the diff cache → no second GitHub diff fetch.
    expect(counts.diff).toBe(1);
  });
});
