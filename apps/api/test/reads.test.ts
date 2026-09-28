// Exercise authz and diff caching through app.request over PGlite and the HTTP stub.
// The stub covers repository access, span diffs and OAuth refresh; counts expose caching.
import { randomBytes } from "node:crypto";
import {
  createArtifactStore,
  encryptToken,
  decryptToken,
  createTenantRepository,
  createGrantAuth,
  PrStates,
  createSessionAuth,
  createTokenAuth,
  WriteClassifications,
  type AppDatabase,
  type KeyProvider,
  type BriefWriteInput,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Mutable } from "types/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  KEY_REF,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  buildAuthDeps,
  createKeyProvider,
  hashSha256Hex,
  getRequestUrl,
  answerInstallationRepositories,
} from "./fixtures";

// ---------------------------------------------------------------------------
// Fixtures + deps.
// ---------------------------------------------------------------------------

const REPO_ID = 424242;

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

const BRIEF_BODY = JSON.stringify({ summary: "the brief", findings: [] });
const DIFF_TEXT = "diff --git a/f b/f\n@@ -1 +1 @@\n-old\n+new\n";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch), dispatches on URL, counts calls per family.
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
  /** Every fetched URL, in order, lets a test assert the requested diff span. */
  readonly urls: string[];
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = { repositories: 0, diff: 0, token: 0, urls: [] };
  const fetchFn = vi.fn(
    async (input: string | URL | Request): Promise<Response> => {
      const url = getRequestUrl(input);
      counts.urls.push(url);
      if (url.includes("/login/oauth/access_token")) {
        const i = counts.token++;
        return cfg.token
          ? cfg.token(i)
          : jsonResponse({ error: "unexpected_token" }, 500);
      }
      const membership = answerInstallationRepositories(url, [REPO_ID]);
      if (membership !== undefined) {
        return membership;
      }
      if (url.includes("/repositories/")) {
        const i = counts.repositories++;
        return cfg.repositories ? cfg.repositories(i) : repoStatus(404);
      }
      if (url.includes("/compare/")) {
        const i = counts.diff++;
        return cfg.diff
          ? cfg.diff(i)
          : jsonResponse({ message: "not found" }, 404);
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
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
  opts?: {
    accessPlaintext?: string;
    refreshPlaintext?: string;
    expiresAt?: Date;
  },
): Promise<{ cookie: string; hash: string }> {
  const cookie = randomBytes(32).toString("base64url");
  const hash = hashSha256Hex(cookie);
  const sealedAccess = await encryptToken(
    kp,
    KEY_REF,
    opts?.accessPlaintext ?? ACCESS_TOKEN,
  );
  const sealedRefresh = await encryptToken(
    kp,
    KEY_REF,
    opts?.refreshPlaintext ?? REFRESH_TOKEN,
  );
  if (!sealedAccess.ok || !sealedRefresh.ok)
    throw new Error("seed encrypt failed");
  const expiresAt = opts?.expiresAt ?? new Date("2027-01-01T00:00:00Z");
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: expiresAt,
  });
  await createTenantRepository(handle, CTX).sessions.create({
    sessionTokenHash: hash,
    reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt,
  });
  return { cookie, hash };
}

/** Seed the tenant PR row; returns its branded row id. */
async function seedPullRequest(handle: AppDatabase): Promise<void> {
  await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

async function seedBrief(
  handle: AppDatabase,
  base: string,
  head: string,
  repoConfig?: string,
): Promise<void> {
  const pr = await createTenantRepository(handle, CTX).pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) throw new Error("seedBrief: pr missing");
  const store = createArtifactStore(handle, CTX);
  const prior = await store.briefs.listForPullRequest(pr.id);
  const write: Mutable<BriefWriteInput> = {
    pullRequestId: pr.id,
    baseSha: base,
    headSha: head,
    headIndex: (prior.at(-1)?.headIndex ?? 0) + 1,
    commitCount: 3,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: BRIEF_BODY,
  };

  if (repoConfig !== undefined) write.repoConfig = repoConfig;

  const written = await store.briefs.write(write);
  if (!written.ok) {
    throw new Error(`seedBrief: write failed ${written.error.code}`);
  }
}

function briefContextPath(base: string, head: string): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/brief-context?base=${base}&head=${head}`;
}

const DELTA_BODY = JSON.stringify({ summary: "the delta", changes: [] });

async function seedDelta(
  handle: AppDatabase,
  baseline: string,
  head: string,
): Promise<void> {
  const pr = await createTenantRepository(handle, CTX).pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) throw new Error("seedDelta: pr missing");
  const written = await createArtifactStore(handle, CTX).deltas.write({
    pullRequestId: pr.id,
    baselineSha: baseline,
    headSha: head,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: DELTA_BODY,
  });
  if (!written.ok)
    throw new Error(`seedDelta: write failed ${written.error.code}`);
}

function deltaPath(baseline: string, head: string): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/delta?baseline=${baseline}&head=${head}`;
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

// Use a forward-only Date.now offset for TTL tests. Octokit shares Bottleneck groups
// across the file; freezing or rewinding time can poison later calls with a 61s wait.
// Never restore an earlier clock while those groups survive.
const realNow = Date.now.bind(Date);
let clockOffsetMs = 0;

// Conversation port stub: a call here is a test bug.
const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
  commitAttachment: async () => {
    throw new Error("attachment port must not be called in this suite");
  },
  deleteAttachmentBranch: async () => {
    throw new Error("attachment port must not be called in this suite");
  },
};

describe("reviewer read API + authz gate", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;

  beforeEach(async () => {
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffsetMs);
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
    vi.restoreAllMocks();
    await harness.close();
  });

  it("401s absent session cookies without calling GitHub", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const res = await app.request(briefPath("base", "head"));
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(0);
  });

  it("401s unknown session cookies without calling GitHub", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const res = await app.request(briefPath("base", "head"), {
      headers: {
        Cookie: `__Host-mergebrief_session=${randomBytes(32).toString("base64url")}`,
      },
    });
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(0);
  });

  it("404s repo denial without an audit row or negative cache entry", async () => {
    const counts = stubGitHub({ repositories: () => repoStatus(404) });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const first = await app.request(briefPath("b", "h"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(first.status).toBe(404);

    // Reads are never audited, a denied one included. The refusal is
    // visible on the `api.access` line, not in the ledger.
    const auditRows = await harness.raw("select operation from audit_log");
    expect(auditRows).toHaveLength(0);

    // Negative is not cached: a second request calls GitHub again.
    const second = await app.request(briefPath("b", "h"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(second.status).toBe(404);
    expect(counts.repositories).toBe(2);
  });

  it("collapses GitHub 403 to a uniform 404", async () => {
    stubGitHub({ repositories: () => repoStatus(403) });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    const res = await app.request(briefPath("b", "h"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(404);
  });

  it("returns authorized stored briefs and 404s missing spans", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    await seedBrief(harness.handle, "base1", "head1");

    const res = await app.request(briefPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.text()).toBe(BRIEF_BODY);

    const missing = await app.request(briefPath("base1", "nope"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(missing.status).toBe(404);
  });

  it("returns snapshots, null for legacy rows, and 404 for missing rows", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    const snapshot = '{"files":[],"collisions":[],"policy":null}';
    await seedBrief(harness.handle, "base1", "head1", snapshot);
    await seedBrief(harness.handle, "base1", "head2"); // no snapshot column

    const withConfig = await app.request(briefContextPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(withConfig.status).toBe(200);
    expect(withConfig.headers.get("cache-control")).toBe("no-store");
    expect(await withConfig.text()).toBe(`{"repoConfig":${snapshot}}`);

    const nullConfig = await app.request(briefContextPath("base1", "head2"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(nullConfig.status).toBe(200);
    expect(await nullConfig.text()).toBe('{"repoConfig":null}');

    const missing = await app.request(briefContextPath("base1", "nope"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code?: string }).code).toBe(
      "not-found",
    );

    const malformed = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/brief-context?base=only`,
      { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { code?: string }).code).toBe(
      "invalid-request",
    );
  });

  it("returns authorized stored deltas and 404s missing spans", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    await seedDelta(harness.handle, "cp-1", "head-2");

    const res = await app.request(deltaPath("cp-1", "head-2"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(DELTA_BODY);

    const missing = await app.request(deltaPath("cp-1", "nope"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(missing.status).toBe(404);
    // Positive authz cache: one access check covered both reads.
    expect(counts.repositories).toBe(1);
  });

  it("400s delta queries with cross-repo refs or missing parameters", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const crossRepo = await app.request(deltaPath("evil:main", "head-2"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(crossRepo.status).toBe(400);

    const missingHead = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/delta?baseline=only`,
      { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );
    expect(missingHead.status).toBe(400);
  });

  it("400s queries missing head", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    const res = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/brief?base=only`,
      {
        headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
      },
    );
    expect(res.status).toBe(400);
  });

  it("checks access once for two authorized reads inside the TTL", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    await seedBrief(harness.handle, "base1", "head1");

    const a = await app.request(briefPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    const b = await app.request(briefPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(counts.repositories).toBe(1);
  });

  it("denies revoked grants after the positive-cache TTL expires", async () => {
    const counts = stubGitHub({
      repositories: (call) => (call === 0 ? repoOk() : repoStatus(404)),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    await seedBrief(harness.handle, "base1", "head1");

    const a = await app.request(briefPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(a.status).toBe(200);

    // Advance the virtual clock past the TTL (forward-only, see the offset
    // note above). The gate re-checks GitHub, which now denies → 404.
    clockOffsetMs += 61_000;
    const b = await app.request(briefPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
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
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BRIEF_BODY);
    expect(counts.repositories).toBe(2); // 401 then 200
    expect(counts.token).toBe(1); // one refresh

    // The linked grant's access ciphertext rotated to the refreshed token,
    // decrypt and compare, an existence check alone proves nothing.
    const rows = await harness.raw(
      "select g.gh_token_ciphertext from auth_session s join github_grant g on g.id = s.grant_id where s.session_token_hash = $1",
      [hash],
    );
    expect(rows).toHaveLength(1);
    const decrypted = await decryptToken(
      kp,
      KEY_REF,
      String(rows[0]?.["gh_token_ciphertext"]),
    );
    if (!decrypted.ok) throw new Error("stored grant ciphertext unreadable");
    expect(decrypted.value).toBe(ROTATED_ACCESS);
  });

  it("keeps Bearer access working after browser-triggered grant rotation", async () => {
    // The bug this pins: mint copied the session's pair, the browser's
    // refresh consumed the single-use refresh token, and the CLI token died on
    // its own next refresh. Now both channels share ONE grant row, so the
    // browser's rotation is the CLI's rotation.
    const counts = stubGitHub({
      // First access check 401s (expired access token); every later check,
      // including the Bearer channel's own, made with the ROTATED token, 200s.
      repositories: (call) => (call === 0 ? repoStatus(401) : repoOk()),
      token: () => jsonResponse(tokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH)),
    });
    const { cookie, hash } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
    await seedBrief(harness.handle, "base1", "head1");

    // Mint a Bearer token LINKED to the session's grant, the route's exact
    // link-never-copy semantics (tokens.ts passes currentSession.grantId).
    const resolved = await createSessionAuth(harness.handle).findSession(hash);
    if (resolved === undefined) throw new Error("seeded session not found");
    const bearer = `mergebrief_${randomBytes(32).toString("base64url")}`;
    await createTokenAuth(harness.handle).mintToken({
      scope: WriteClassifications.EXTERNAL_WRITE,
      userId: brandReviewerId(BigInt(REVIEWER_ID)),
      name: "cli-agent",
      tokenHash: hashSha256Hex(bearer),
      grantId: resolved.session.grantId,
      expiresAt: null,
    });

    // 1. Browser request: 401 → refresh (consumes the single-use refresh
    //    token) → retry succeeds. Exactly one exchange.
    const viaCookie = await app.request(briefPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(viaCookie.status).toBe(200);
    expect(counts.token).toBe(1);

    // 2. CLI request afterwards: its authz gate runs a FRESH GitHub check
    //    (different session-hash cache key) with the grant's ROTATED access
    //    token, it succeeds with NO second exchange. This is
    //    the request that silently died.
    const viaBearer = await app.request(briefPath("base1", "head1"), {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(viaBearer.status).toBe(200);
    expect(await viaBearer.text()).toBe(BRIEF_BODY);
    expect(counts.token).toBe(1); // STILL one, no second refresh spent
    expect(counts.repositories).toBe(3); // 401, cookie-retry 200, bearer 200
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
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(401);
    const rows = await harness.raw(
      "select count(*)::int as n from auth_session",
    );
    expect(rows[0]?.["n"]).toBe(0);
  });

  it("401s expired sessions with dead refresh tokens and deletes them", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp, {
      expiresAt: new Date(Date.now() - 1000),
    });
    await seedPullRequest(harness.handle);

    const res = await app.request(briefPath("b", "h"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(401);
    // Rejected before the access check, no GitHub call at all.
    expect(counts.repositories).toBe(0);
    // The dead session is burned.
    const rows = await harness.raw(
      "select count(*)::int as n from auth_session",
    );
    expect(rows[0]?.["n"]).toBe(0);
  });

  it("400s cross-repo diff refs without calling GitHub", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      diff: () => diffOk(),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const res = await app.request(diffPath("otherowner:sha", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(400);
    // Rejected at the Zod boundary, the compare endpoint is never reached.
    expect(counts.diff).toBe(0);
  });

  it("proxies the requested base...head diff rather than the whole PR", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      diff: () => diffOk(),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const res = await app.request(diffPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    // The compare request carried the exact requested span.
    expect(counts.urls.some((u) => u.includes("/compare/base1...head1"))).toBe(
      true,
    );
  });

  it("refreshes expired tokens on cached-authz diff reads and retries", async () => {
    // span1: diff ok (warms authz + diff cache). span2: diff 401 → refresh → ok.
    const counts = stubGitHub({
      repositories: () => repoOk(),
      diff: (call) => (call === 1 ? diffStatus(401) : diffOk()),
      token: () => jsonResponse(tokenSuccess(ROTATED_ACCESS, ROTATED_REFRESH)),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const a = await app.request(diffPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(a.status).toBe(200);
    expect(counts.repositories).toBe(1);

    // Different span → authz-cache hit (no new access check), but the lazily
    // decrypted token 401s the compare fetch → the route refreshes and retries.
    const b = await app.request(diffPath("base2", "head2"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(b.status).toBe(200);
    expect(await b.text()).toBe(DIFF_TEXT);
    expect(counts.repositories).toBe(1); // still cached, no second access check
    expect(counts.token).toBe(1); // diff-route refresh fired
    expect(counts.diff).toBe(3); // span1 ok, span2 401 + retry ok
  });

  // Long timeout: octokit's retry plugin retries a 406 (not in its doNotRetry
  // list) with backoff before the sanitized error surfaces.
  it(
    "maps GitHub's oversized-diff 406 to 413",
    { timeout: 20_000 },
    async () => {
      stubGitHub({ repositories: () => repoOk(), diff: () => diffStatus(406) });
      const { cookie } = await seedSession(harness.handle, kp);
      await seedPullRequest(harness.handle);

      const res = await app.request(diffPath("b", "h"), {
        headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
      });
      expect(res.status).toBe(413);
      expect(((await res.json()) as { code?: string }).code).toBe(
        "diff-too-large",
      );
    },
  );

  it("diff proxy targets the GitHub-verified repo name, not the stored slug", async () => {
    // The access check reports the repo under a NEW name (renamed since our
    // last webhook write). The compare call must follow the verified name.
    const counts = stubGitHub({
      repositories: () =>
        jsonResponse({ id: REPO_ID, full_name: "octo/renamed", private: true }),
      diff: () => diffOk(),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle); // stored slug: octo/hello

    const res = await app.request(diffPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(
      counts.urls.some((u) => u.includes("/repos/octo/renamed/compare/")),
    ).toBe(true);
    expect(counts.urls.some((u) => u.includes("/repos/octo/hello/"))).toBe(
      false,
    );
  });

  it("serves oversized diffs without caching them", async () => {
    const big = "x".repeat(1_000_001); // just over the 1 MB per-entry cap
    const counts = stubGitHub({
      repositories: () => repoOk(),
      diff: () => diffOk(big),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const first = await app.request(diffPath("b", "h"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(first.status).toBe(200);
    expect((await first.text()).length).toBe(big.length);
    expect(counts.diff).toBe(1);

    const second = await app.request(diffPath("b", "h"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(second.status).toBe(200);
    // Not cached (too large) → GitHub was hit again.
    expect(counts.diff).toBe(2);
  });

  it("serves repeated diff reads from the per-session cache", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      diff: () => diffOk(),
    });
    const { cookie } = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const first = await app.request(diffPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("text/plain");
    expect(await first.text()).toBe(DIFF_TEXT);
    expect(counts.diff).toBe(1);

    const second = await app.request(diffPath("base1", "head1"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(DIFF_TEXT);
    // Second read hit the diff cache → no second GitHub diff fetch.
    expect(counts.diff).toBe(1);
  });
});
