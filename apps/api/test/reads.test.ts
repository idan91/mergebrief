// Exercise authz and diff caching through app.request over PGlite. The gate's
// repository read and the OAuth refresh run over a fetch stub; the span diff
// reaches the `github/testing` fake through the reviewer binding.
import { randomBytes } from "node:crypto";
import { FakeFailures, makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createArtifactStore,
  decryptToken,
  createTenantRepository,
  createSessionAuth,
  createTokenAuth,
  WriteClassifications,
  type AppDatabase,
  type KeyProvider,
  type BriefWriteInput,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import { spyPullRequestLookups } from "./pull-request-lookups";
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
  createKeyProvider,
  hashSha256Hex,
  getRequestUrl,
  answerInstallationRepositories,
} from "./fixtures";
import {
  ROTATED_ACCESS_TOKEN,
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  listFakeCallTokens,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";

// ---------------------------------------------------------------------------
// Fixtures + deps.
// ---------------------------------------------------------------------------

const REPO_ID = 424242;

const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

const BRIEF_BODY = JSON.stringify({ summary: "the brief", findings: [] });
const DIFF_TEXT = "diff --git a/f b/f\n@@ -1 +1 @@\n-old\n+new\n";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };
const REPO = { owner: "octo", repo: "hello" };

// ---------------------------------------------------------------------------
// The gate's GitHub over a global fetch stub, counting calls per family.
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
interface StubConfig {
  readonly repositories?: (call: number) => Response;
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  repositories: number;
  token: number;
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = { repositories: 0, token: 0 };
  const fetchFn = vi.fn(
    async (input: string | URL | Request): Promise<Response> => {
      const url = getRequestUrl(input);
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
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

// ---------------------------------------------------------------------------
// Seeding helpers.
// ---------------------------------------------------------------------------

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
): Promise<void> {
  const pr = await createTenantRepository(handle, CTX).pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) {
    throw new Error("seedBrief: pr missing");
  }
  const store = createArtifactStore(handle, CTX);
  const prior = await store.briefs.listForPullRequest(pr.id);
  const write: BriefWriteInput = {
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

  const written = await store.briefs.write(write);
  if (!written.ok) {
    throw new Error(`seedBrief: write failed ${written.error.code}`);
  }
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

describe("reviewer read API + authz gate", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;
  let fake: FakeGitHub;

  beforeEach(async () => {
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffsetMs);
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
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
    const { cookie } = await seedSignIn(harness.handle, kp);
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
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPullRequest(harness.handle);
    const res = await app.request(briefPath("b", "h"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(404);
  });

  it("answers a rate-limited access check 502 and never caches it", async () => {
    const counts = stubGitHub({
      repositories: () =>
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 403,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-ratelimit-remaining": "0",
            date: new Date().toUTCString(),
          },
        }),
    });
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const first = await app.request(briefPath("b", "h"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ code: "github-unavailable" });

    const second = await app.request(briefPath("b", "h"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(second.status).toBe(502);
    expect(counts.repositories).toBe(2);
  });

  it("answers 401 when the access check still 401s after a refresh", async () => {
    const counts = stubGitHub({
      repositories: () => repoStatus(401),
      token: () =>
        jsonResponse(tokenSuccess(ROTATED_ACCESS_TOKEN, ROTATED_REFRESH)),
    });
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPullRequest(harness.handle);

    const res = await app.request(briefPath("b", "h"), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(2);
    expect(counts.token).toBe(1);
    // The refresh succeeded, so the session it rotated stays.
    const rows = await harness.raw(
      "select count(*)::int as n from auth_session",
    );
    expect(rows[0]?.["n"]).toBe(1);
  });

  it("checks access once for two authorized reads inside the TTL", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSignIn(harness.handle, kp);
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
    const { cookie } = await seedSignIn(harness.handle, kp);
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
      token: () =>
        jsonResponse(tokenSuccess(ROTATED_ACCESS_TOKEN, ROTATED_REFRESH)),
    });
    const { cookie, cookieHash } = await seedSignIn(harness.handle, kp);
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
      [cookieHash],
    );
    expect(rows).toHaveLength(1);
    const decrypted = await decryptToken(
      kp,
      KEY_REF,
      String(rows[0]?.["gh_token_ciphertext"]),
    );
    if (!decrypted.ok) {
      throw new Error("stored grant ciphertext unreadable");
    }
    expect(decrypted.value).toBe(ROTATED_ACCESS_TOKEN);
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
      token: () =>
        jsonResponse(tokenSuccess(ROTATED_ACCESS_TOKEN, ROTATED_REFRESH)),
    });
    const { cookie, cookieHash } = await seedSignIn(harness.handle, kp);
    await seedPullRequest(harness.handle);
    await seedBrief(harness.handle, "base1", "head1");

    // Mint a Bearer token LINKED to the session's grant, the route's exact
    // link-never-copy semantics (tokens.ts passes currentSession.grantId).
    const resolved = await createSessionAuth(harness.handle).findSession(
      cookieHash,
    );
    if (resolved === undefined) {
      throw new Error("seeded session not found");
    }
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
    const { cookie } = await seedSignIn(harness.handle, kp);
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
    const { cookie } = await seedSignIn(harness.handle, kp, {
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

  describe("span diff proxy", () => {
    async function signInWithRow(): Promise<string> {
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      return cookie;
    }

    function readDiff(cookie: string, base: string, head: string) {
      return app.request(diffPath(base, head), {
        headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
      });
    }

    function listDiffCalls() {
      return fake.listCalls("fetchCompareDiff");
    }

    it("proxies the requested base...head diff rather than the whole PR", async () => {
      stubGitHub({ repositories: () => repoOk() });
      fake.addCompare(
        REPO,
        { base: "base1", head: "head1" },
        { diff: DIFF_TEXT },
      );
      const cookie = await signInWithRow();
      const lookups = spyPullRequestLookups(harness);

      const res = await readDiff(cookie, "base1", "head1");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe(DIFF_TEXT);
      expect(listDiffCalls().map((call) => call.input)).toEqual([
        { ...REPO, base: "base1", head: "head1" },
      ]);
      expect(lookups.count()).toBe(1);
    });

    it("serves repeated diff reads from the per-session cache", async () => {
      stubGitHub({ repositories: () => repoOk() });
      fake.addCompare(
        REPO,
        { base: "base1", head: "head1" },
        { diff: DIFF_TEXT },
      );
      const cookie = await signInWithRow();

      const first = await readDiff(cookie, "base1", "head1");
      const second = await readDiff(cookie, "base1", "head1");

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await second.text()).toBe(DIFF_TEXT);
      expect(listDiffCalls()).toHaveLength(1);
    });

    it("serves oversized diffs without caching them", async () => {
      const big = "x".repeat(1_000_001);
      stubGitHub({ repositories: () => repoOk() });
      fake.addCompare(REPO, { base: "b", head: "h" }, { diff: big });
      const cookie = await signInWithRow();

      const first = await readDiff(cookie, "b", "h");
      expect((await first.text()).length).toBe(big.length);
      const second = await readDiff(cookie, "b", "h");

      expect(second.status).toBe(200);
      expect(listDiffCalls()).toHaveLength(2);
    });

    it("targets the GitHub-verified repo name, not the stored slug", async () => {
      stubGitHub({
        repositories: () =>
          jsonResponse({
            id: REPO_ID,
            full_name: "octo/renamed",
            private: true,
          }),
      });
      const renamed = { owner: "octo", repo: "renamed" };
      fake.addCompare(
        renamed,
        { base: "base1", head: "head1" },
        { diff: DIFF_TEXT },
      );
      const cookie = await signInWithRow();

      const res = await readDiff(cookie, "base1", "head1");

      expect(res.status).toBe(200);
      expect(listDiffCalls().map((call) => call.input)).toEqual([
        { ...renamed, base: "base1", head: "head1" },
      ]);
    });

    it("400s cross-repo diff refs without calling GitHub", async () => {
      stubGitHub({ repositories: () => repoOk() });
      const cookie = await signInWithRow();

      const res = await readDiff(cookie, "otherowner:sha", "head1");

      expect(res.status).toBe(400);
      expect(fake.calls).toEqual([]);
    });

    const collapsed = [
      ["403", FakeFailures.FORBIDDEN],
      ["404", FakeFailures.NOT_FOUND],
    ] as const;

    it.each(collapsed)(
      "collapses a %s span diff to 404",
      async (_label, failure) => {
        stubGitHub({ repositories: () => repoOk() });
        fake.failOn("fetchCompareDiff", failure);
        const cookie = await signInWithRow();

        const res = await readDiff(cookie, "base1", "head1");

        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: "not-found" });
      },
    );

    it("maps GitHub's oversized-diff 406 to 413", async () => {
      stubGitHub({ repositories: () => repoOk() });
      fake.failOn("fetchCompareDiff", FakeFailures.NOT_ACCEPTABLE);
      const cookie = await signInWithRow();

      const res = await readDiff(cookie, "b", "h");

      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ code: "diff-too-large" });
    });

    it("answers a diff GitHub cannot serve 502", async () => {
      stubGitHub({ repositories: () => repoOk() });
      fake.failOn("fetchCompareDiff", FakeFailures.SERVER_ERROR);
      const cookie = await signInWithRow();

      const res = await readDiff(cookie, "b", "h");

      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ code: "github-unavailable" });
    });

    it("refreshes expired tokens on cached-authz diff reads and retries", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        token: () =>
          jsonResponse(tokenSuccess(ROTATED_ACCESS_TOKEN, ROTATED_REFRESH)),
      });
      fake.addCompare(
        REPO,
        { base: "base1", head: "head1" },
        { diff: DIFF_TEXT },
      );
      fake.addCompare(
        REPO,
        { base: "base2", head: "head2" },
        { diff: DIFF_TEXT },
      );
      const cookie = await signInWithRow();

      const first = await readDiff(cookie, "base1", "head1");
      fake.rejectToken(ACCESS_TOKEN);
      const second = await readDiff(cookie, "base2", "head2");

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await second.text()).toBe(DIFF_TEXT);
      expect(counts.repositories).toBe(1);
      expect(counts.token).toBe(1);
      expect(listFakeCallTokens(fake)).toEqual([
        ACCESS_TOKEN,
        ACCESS_TOKEN,
        ROTATED_ACCESS_TOKEN,
      ]);
    });

    it("answers 401 when the diff still 401s after a good refresh", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        token: () =>
          jsonResponse(tokenSuccess(ROTATED_ACCESS_TOKEN, ROTATED_REFRESH)),
      });
      fake.rejectToken(ACCESS_TOKEN);
      fake.rejectToken(ROTATED_ACCESS_TOKEN);
      const cookie = await signInWithRow();

      const res = await readDiff(cookie, "b", "h");

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "unauthorized" });
      expect(counts.token).toBe(1);
      expect(listDiffCalls()).toHaveLength(2);
    });

    it("answers 401 when the diff 401s and the refresh fails", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        token: () => jsonResponse({ error: "bad_refresh_token" }),
      });
      fake.rejectToken(ACCESS_TOKEN);
      const cookie = await signInWithRow();

      const res = await readDiff(cookie, "b", "h");

      expect(res.status).toBe(401);
      expect(counts.token).toBe(1);
      expect(listDiffCalls()).toHaveLength(1);
    });

    it("401s an unreadable token behind a cached gate pass", async () => {
      stubGitHub({ repositories: () => repoOk() });
      fake.addCompare(
        REPO,
        { base: "base1", head: "head1" },
        { diff: DIFF_TEXT },
      );
      const { cookie, cookieHash } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      expect((await readDiff(cookie, "base1", "head1")).status).toBe(200);
      await harness.raw(
        "update github_grant set gh_token_ciphertext = 'sealed'",
      );

      const res = await readDiff(cookie, "base2", "head2");

      expect(res.status).toBe(401);
      expect(listDiffCalls()).toHaveLength(1);
      const sessions = await harness.raw(
        "select id from auth_session where session_token_hash = $1",
        [cookieHash],
      );
      expect(sessions).toEqual([]);
    });
  });
});
