// Conversation-read integration tests (BRIEF-25): `app.request()` against
// `createApp` over the PGlite harness. The installation-token GraphQL read
// enters through the injected `ConversationGitHubPort` (stubbed here — the
// wire→domain mapping is the github package's suite); the gate's access
// check hits the global-fetch stub (same pattern as reads.test.ts). Covers:
// gate posture (401/404), the 60s per-PR positive cache (one port call per
// TTL, shared across viewers), and 404-collapse/502 on port failures.
import { createHash, randomBytes } from "node:crypto";
import type { Hono } from "hono";
import type { FetchPullRequestConversationInput, PrConversation } from "github";
import {
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
import { createApp, type AuthDeps, type ConversationGitHubPort } from "../src/lib";

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_ID = 424242;
const REPO_SLUG = "octo/hello";
const PR_NUMBER = 7;
const ROOT_COMMENT_ID = 3_538_588_388;

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";

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
// Conversation port stub — canned domain fixtures, call log for cache asserts.
// ---------------------------------------------------------------------------

function conversationFixture(): PrConversation {
  return {
    threads: [
      {
        rootCommentId: ROOT_COMMENT_ID,
        path: "src/a.ts",
        line: 12,
        side: "RIGHT",
        subjectType: "LINE",
        isResolved: false,
        isOutdated: false,
        anchorSha: "a".repeat(40),
        comments: [
          {
            commentId: ROOT_COMMENT_ID,
            author: { login: "alice", isBot: false },
            body: "human note",
            createdAt: "2026-07-01T10:00:00Z",
            url: "https://github.com/octo/hello/pull/7#discussion_r1",
            reviewId: 4_647_663_464,
          },
        ],
        hasMoreComments: false,
      },
      {
        rootCommentId: 3_538_700_000,
        path: "src/b.ts",
        subjectType: "LINE",
        isResolved: true,
        isOutdated: true,
        comments: [
          {
            commentId: 3_538_700_000,
            author: { login: "coderabbitai", isBot: true },
            body: "bot note",
            createdAt: "2026-07-01T11:00:00Z",
            url: "https://github.com/octo/hello/pull/7#discussion_r2",
          },
        ],
        hasMoreComments: false,
      },
    ],
    reviews: [
      {
        reviewId: 4_647_663_464,
        author: { login: "alice", isBot: false },
        state: "CHANGES_REQUESTED",
        body: "needs work",
        submittedAt: "2026-07-01T10:00:00Z",
        url: "https://github.com/octo/hello/pull/7#pullrequestreview-1",
      },
    ],
    prComments: [
      {
        commentId: 9001,
        author: { login: "carol", isBot: false },
        body: "PR-level remark",
        createdAt: "2026-07-02T09:00:00Z",
        url: "https://github.com/octo/hello/pull/7#issuecomment-9001",
      },
    ],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

interface PortLog {
  readonly calls: Array<{ installationId: InstallationId; input: FetchPullRequestConversationInput }>;
}

function stubPort(
  results: Array<Awaited<ReturnType<ConversationGitHubPort["fetchPullRequestConversation"]>>>,
): { port: ConversationGitHubPort; log: PortLog } {
  const log: PortLog = { calls: [] };
  let call = 0;
  return {
    log,
    port: {
      async fetchPullRequestConversation(installationId, input) {
        log.calls.push({ installationId, input });
        const result = results[Math.min(call, results.length - 1)];
        call += 1;
        if (result === undefined) throw new Error("port stub exhausted");
        return result;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch) — gate access check, reply POST, token.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", date: new Date().toUTCString() },
  });
}

function repoOk(): Response {
  return jsonResponse({ id: REPO_ID, full_name: REPO_SLUG, private: true });
}
function repoStatus(status: number): Response {
  return jsonResponse({ message: "denied" }, status);
}

interface StubConfig {
  readonly repositories?: (call: number) => Response;
}
interface StubCounts {
  repositories: number;
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = { repositories: 0 };
  const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/repositories/")) {
      const i = counts.repositories++;
      return cfg.repositories ? cfg.repositories(i) : repoStatus(404);
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

// ---------------------------------------------------------------------------
// Seeding + request helpers.
// ---------------------------------------------------------------------------

async function seedSession(handle: AppDatabase, kp: KeyProvider): Promise<{ cookie: string }> {
  const cookie = randomBytes(32).toString("base64url");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok) throw new Error("seed encrypt failed");
  await forTenant(handle, CTX).sessions.create({
    sessionTokenHash: sha256Hex(cookie),
    reviewerId: brandReviewer(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return { cookie };
}

async function seedPullRequest(handle: AppDatabase): Promise<void> {
  await forTenant(handle, CTX).pullRequests.upsert({
    repoId: brandRepo(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrState.OPEN,
  });
}

const CONVERSATION_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/conversation`;


async function getConversation(app: Hono, cookie: string | undefined, path = CONVERSATION_PATH): Promise<Response> {
  return await app.request(path, {
    headers: cookie === undefined ? {} : { cookie: `rs_session=${cookie}` },
  });
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

describe("conversation surface", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = keyProvider();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  function makeApp(port: ConversationGitHubPort): Hono {
    return createApp({
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: authDeps(kp),
      github: port,
    });
  }

  const okResult = () => ({ ok: true as const, value: conversationFixture() });

  describe("GET conversation", () => {
    it("401s without a session cookie and never calls the port", async () => {
      const { port, log } = stubPort([okResult()]);
      stubGitHub({});
      const res = await getConversation(makeApp(port), undefined);
      expect(res.status).toBe(401);
      // Gate denials are per-viewer state too — the no-store contract covers
      // EVERY response of a gated route, middleware denials included.
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(log.calls).toHaveLength(0);
    });

    it("404s when the viewer has no repo access (gate collapse), port untouched", async () => {
      const { port, log } = stubPort([okResult()]);
      stubGitHub({ repositories: () => repoStatus(404) });
      const { cookie } = await seedSession(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const res = await getConversation(makeApp(port), cookie);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(log.calls).toHaveLength(0);
    });

    it("returns the conversation with no-store, fetched on the installation token", async () => {
      const { port, log } = stubPort([okResult()]);
      stubGitHub({ repositories: () => repoOk() });
      const { cookie } = await seedSession(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const res = await getConversation(makeApp(port), cookie);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = (await res.json()) as PrConversation;
      expect(body.threads).toHaveLength(2);
      expect(body.threads[0]?.rootCommentId).toBe(ROOT_COMMENT_ID);
      expect(body.threads[1]?.comments[0]?.author.isBot).toBe(true);
      expect(body.reviews[0]?.state).toBe("CHANGES_REQUESTED");
      expect(body.prComments[0]?.commentId).toBe(9001);
      // The port received the tenant installation and the verified repo slug.
      expect(log.calls).toHaveLength(1);
      expect(log.calls[0]?.installationId).toBe(CTX.installationId);
      expect(log.calls[0]?.input).toEqual({ owner: "octo", repo: "hello", prNumber: PR_NUMBER });
    });

    it("serves the second read from the per-PR cache (one port call inside the TTL)", async () => {
      const { port, log } = stubPort([okResult()]);
      stubGitHub({ repositories: () => repoOk() });
      const { cookie } = await seedSession(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const app = makeApp(port);
      const first = await getConversation(app, cookie);
      expect(first.status).toBe(200);
      const second = await getConversation(app, cookie);
      expect(second.status).toBe(200);
      expect(log.calls).toHaveLength(1);
      // The cache is per PR, not per viewer: a SECOND session shares the entry.
      const other = await seedSession(harness.handle, kp);
      const third = await getConversation(app, other.cookie);
      expect(third.status).toBe(200);
      expect(log.calls).toHaveLength(1);
    });

    it("collapses a port not-found to 404 and other failures to 502 (no fallback tier)", async () => {
      const notFound = {
        ok: false as const,
        error: { code: "not-found" as const, message: "failed to fetch pull request conversation: pull request not found" },
      };
      const rateLimited = {
        ok: false as const,
        error: { code: "rate-limited" as const, message: "failed to fetch pull request conversation: GitHub GraphQL query failed" },
      };
      stubGitHub({ repositories: () => repoOk() });
      const { cookie } = await seedSession(harness.handle, kp);
      await seedPullRequest(harness.handle);

      const first = stubPort([notFound]);
      const notFoundRes = await getConversation(makeApp(first.port), cookie);
      expect(notFoundRes.status).toBe(404);

      // Failures are never cached: ONE app instance (one cache), a failed
      // fill followed by a retry must hit the port twice.
      const second = stubPort([rateLimited, okResult()]);
      const app = makeApp(second.port);
      const limitedRes = await getConversation(app, cookie);
      expect(limitedRes.status).toBe(502);
      expect(limitedRes.headers.get("cache-control")).toBe("no-store");
      const retry = await getConversation(app, cookie);
      expect(retry.status).toBe(200);
      expect(second.log.calls).toHaveLength(2);
    });

    it("404s an unknown PR number without touching the port", async () => {
      const { port, log } = stubPort([okResult()]);
      stubGitHub({ repositories: () => repoOk() });
      const { cookie } = await seedSession(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const res = await getConversation(
        makeApp(port),
        cookie,
        `/api/repos/${REPO_ID}/pulls/999/conversation`,
      );
      expect(res.status).toBe(404);
      expect(log.calls).toHaveLength(0);
    });
  });

});

describe("appConversationPort", () => {
  it("maps an installation-client mint rejection to a sanitized Result error", async () => {
    const { appConversationPort } = await import("../src/routes/conversation");
    const app = {
      getInstallationOctokit: async () => {
        throw new Error("mint failed: token endpoint unreachable ghs_SECRET");
      },
    } as unknown as Parameters<typeof appConversationPort>[0];
    const port = appConversationPort(app);
    const result = await port.fetchPullRequestConversation(CTX.installationId, {
      owner: "o",
      repo: "r",
      prNumber: 7,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("request-failed");
    expect(JSON.stringify(result.error)).not.toContain("ghs_SECRET");
  });
});
