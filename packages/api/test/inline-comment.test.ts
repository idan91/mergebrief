// Inline-comment route integration tests (BRIEF-43 PR 4): `app.request()`
// against `createApp` over the PGlite harness, GitHub stubbed at the
// global-fetch seam (same pattern as mark-ready.test.ts). Covers gate posture
// (401 / 404 collapse), the fresh-repo-resolve write safety, the happy path
// (comment posted + audit emitted + conversation cache evicted), the stale-
// anchor 409, the deterministic-400 set, refresh-once, and no-store.
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
  type AppDatabase,
  type InstallationId,
  type KeyProvider,
  type RepoId,
  type ReviewerId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { testLogger, testLogging } from "./logging";

vi.setConfig({ testTimeout: 20_000 });

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_ID = 424242;
const REPO_SLUG = "octo/hello";
const PR_NUMBER = 7;
const COMMIT_ID = "a".repeat(40);

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

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
// GitHub HTTP stub (global fetch): REST /repositories/:id + the comment POST.
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
function commentOk(): Response {
  return jsonResponse({ id: 999, pull_request_review_id: 555 }, 201);
}
function commentStatus(status: number): Response {
  return jsonResponse({ message: "nope" }, status);
}
function tokenSuccess(): Response {
  return jsonResponse({
    access_token: ROTATED_ACCESS,
    refresh_token: ROTATED_REFRESH,
    expires_in: 28_800,
    refresh_token_expires_in: 15_897_600,
    token_type: "bearer",
    scope: "",
  });
}

interface StubConfig {
  readonly repositories?: (call: number) => Response;
  readonly comments?: (call: number) => Response;
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  repositories: number;
  comments: number;
  token: number;
  readonly commentBodies: Array<Record<string, unknown>>;
  /** Full URL of each comment POST, in order — pins the fresh-slug target. */
  readonly commentUrls: string[];
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = {
    repositories: 0,
    comments: 0,
    token: 0,
    commentBodies: [],
    commentUrls: [],
  };
  const fetchFn = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/login/oauth/access_token")) {
        const i = counts.token++;
        return cfg.token ? cfg.token(i) : jsonResponse({ error: "unexpected_token" }, 500);
      }
      if (url.includes("/repositories/")) {
        const i = counts.repositories++;
        return cfg.repositories ? cfg.repositories(i) : repoStatus(404);
      }
      if (/\/pulls\/\d+\/comments$/.test(url)) {
        const i = counts.comments++;
        counts.commentUrls.push(url);
        const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
        if (typeof raw === "string") {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === "object" && parsed !== null) counts.commentBodies.push({ ...parsed });
        }
        return cfg.comments ? cfg.comments(i) : jsonResponse({ message: "unexpected" }, 500);
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

// ---------------------------------------------------------------------------
// Seeding.
// ---------------------------------------------------------------------------

async function seedSession(handle: AppDatabase, kp: KeyProvider): Promise<{ cookie: string }> {
  const cookie = randomBytes(32).toString("base64url");
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
    sessionTokenHash: sha256Hex(cookie),
    reviewerId: brandReviewer(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return { cookie };
}

async function seedPr(handle: AppDatabase): Promise<void> {
  await forTenant(handle, CTX).pullRequests.upsert({
    repoId: brandRepo(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    draft: true,
    state: PrState.OPEN,
  });
}

async function commentAuditCount(harness: PgliteHarness): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as n from audit_log where target_type = 'review_comment'",
  );
  const n = rows[0]?.["n"];
  if (typeof n !== "number") throw new Error("unexpected count result");
  return n;
}

// ---------------------------------------------------------------------------
// Request helper.
// ---------------------------------------------------------------------------

const PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/comments`;

interface CommentBody {
  commitId?: string;
  path?: string;
  line?: number;
  side?: string;
  startLine?: number;
  startSide?: string;
  body?: string;
}

const VALID_BODY: CommentBody = {
  commitId: COMMIT_ID,
  path: "src/index.ts",
  line: 12,
  side: "RIGHT",
  body: "post now",
};

async function post(
  app: ApiApp,
  cookie: string | undefined,
  body: CommentBody | string,
  path = PATH,
): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie: `rs_session=${cookie}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
};

describe("POST /api/repos/:repoId/pulls/:prNumber/comments", () => {
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
    vi.restoreAllMocks();
    await harness.close();
  });

  it("401 when no session cookie is present (no GitHub call)", async () => {
    const counts = stubGitHub({});
    const res = await post(app, undefined, VALID_BODY);
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(0);
    expect(counts.comments).toBe(0);
  });

  it("404 collapse when the viewer has no access to the repo", async () => {
    const counts = stubGitHub({ repositories: () => repoStatus(403) });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, VALID_BODY);
    expect(res.status).toBe(404);
    expect(counts.comments).toBe(0);
  });

  it("404 when the PR is not in the tenant (no GitHub write)", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, VALID_BODY);
    expect(res.status).toBe(404);
    expect(counts.comments).toBe(0);
  });

  it("201 happy path: posts to the FRESH slug, returns ids, audits, no-store", async () => {
    const counts = stubGitHub({
      // Gate caches octo/hello; the route's own fresh resolve renames it —
      // the comment POST must target the fresh owner/name, never the stale slug.
      repositories: (i) =>
        i === 0 ? repoOk() : jsonResponse({ id: REPO_ID, full_name: "octo/renamed", private: true }),
      comments: () => commentOk(),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await post(app, cookie, {
      ...VALID_BODY,
      startLine: 10,
      startSide: "RIGHT",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ commentId: 999, reviewId: 555 });
    expect(counts.comments).toBe(1);
    // Single-gate pin: exactly the gate's access check + the route's own
    // fresh resolve — a third repositories call would mean a stacked gate.
    expect(counts.repositories).toBe(2);
    // The POST url carried the FRESHLY-resolved repo name, never the gate's
    // cached (renamed-away) slug.
    expect(counts.commentUrls[0]).toContain("/repos/octo/renamed/pulls/");
    expect(counts.commentUrls[0]).not.toContain("octo/hello");
    // Pinned commit + the multi-line anchor on the wire body.
    const body = counts.commentBodies[0];
    expect(body).toMatchObject({
      commit_id: COMMIT_ID,
      path: "src/index.ts",
      line: 12,
      side: "RIGHT",
      start_line: 10,
      start_side: "RIGHT",
      body: "post now",
    });
    expect(await commentAuditCount(harness)).toBe(1);
  });

  it("201 kept and audit.fail logged when the audit write fails after the posted comment", async () => {
    const capture = testLogging();
    const captureApp = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: authDeps(kp),
      github: unusedConversationPort,
    });
    stubGitHub({ repositories: () => repoOk(), comments: () => commentOk() });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    // Poison ONLY the audit write: the GitHub post has already committed by
    // the time the audit insert runs, so the response must stay a 201.
    await harness.raw("alter table audit_log rename to audit_log_poisoned");

    const res = await post(captureApp, cookie, VALID_BODY);
    expect(res.status).toBe(201);
    const line = capture.lines().find((l) => l["evt"] === "audit.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["commentId"]).toBe("999");
    expect(line?.["err"]).toBeDefined();
  });

  it("201 with reviewId omitted when GitHub assigns no wrapping review id", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      comments: () => jsonResponse({ id: 999, pull_request_review_id: null }, 201),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, VALID_BODY);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ commentId: 999 });
  });

  it("409 stale anchor when GitHub 422s (head moved under the pinned commit)", async () => {
    stubGitHub({ repositories: () => repoOk(), comments: () => commentStatus(422) });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, VALID_BODY);
    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await commentAuditCount(harness)).toBe(0);
  });

  it("502 on a hard GitHub failure; no audit row", async () => {
    stubGitHub({ repositories: () => repoOk(), comments: () => commentStatus(500) });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, VALID_BODY);
    expect(res.status).toBe(502);
    expect(await commentAuditCount(harness)).toBe(0);
  });

  it.each([403, 404])(
    "404 collapse when the in-route write is denied (%i) — no existence leak",
    async (denialStatus) => {
      // Both denial statuses must be indistinguishable from a cold gate 404:
      // a FORBIDDEN (revoked access inside the cache TTL) and a NOT_FOUND
      // (comment target gone) exercise separate mapping branches.
      stubGitHub({
        repositories: () => repoOk(),
        comments: () => commentStatus(denialStatus),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      const res = await post(app, cookie, VALID_BODY);
      expect(res.status).toBe(404);
    },
  );

  it("refreshes the token once when the write 401s mid-request, then succeeds", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      comments: (i) => (i === 0 ? commentStatus(401) : commentOk()),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, VALID_BODY);
    expect(res.status).toBe(201);
    expect(counts.token).toBe(1);
    expect(counts.comments).toBe(2);
  });

  it("401 when a second write 401 lands after the one refresh (budget spent)", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      comments: () => commentStatus(401),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, VALID_BODY);
    expect(res.status).toBe(401);
    expect(counts.token).toBe(1);
  });

  it("evicts the PR's cached conversation on a posted comment (app.ts wiring)", async () => {
    // A counting conversation port: the conversation GET caches its body for
    // 60s, so WITHOUT eviction a refetch inside the TTL never reaches the
    // port. Read → read (cache-warm control, port count stays 1) → post →
    // read: the third read reaching the port proves the route's success path
    // evicted the entry through the app.ts wiring.
    let conversationFetches = 0;
    const countingPort = {
      fetchPullRequestConversation: async () => {
        conversationFetches += 1;
        return {
          ok: true as const,
          value: {
            threads: [],
            reviews: [],
            prComments: [],
            hasMoreThreads: false,
            hasMoreReviews: false,
            hasMorePrComments: false,
          },
        };
      },
    };
    const evictionApp = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: authDeps(kp),
      github: countingPort,
    });
    stubGitHub({ repositories: () => repoOk(), comments: () => commentOk() });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const conversationPath = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/conversation`;
    const get = async () =>
      await evictionApp.request(conversationPath, {
        headers: { cookie: `rs_session=${cookie}` },
      });

    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    // Second read served from the cache — the TTL is warm.
    expect(conversationFetches).toBe(1);

    const posted = await post(evictionApp, cookie, VALID_BODY);
    expect(posted.status).toBe(201);

    // The post evicted the entry: the next read reaches the port again.
    expect((await get()).status).toBe(200);
    expect(conversationFetches).toBe(2);
  });

  describe("deterministic 400s (mirrored client-side)", () => {
    it("rejects a non-40-hex commitId", async () => {
      stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      const res = await post(app, cookie, { ...VALID_BODY, commitId: "deadbeef" });
      expect(res.status).toBe(400);
    });
    it("rejects an empty body", async () => {
      stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      const res = await post(app, cookie, { ...VALID_BODY, body: "" });
      expect(res.status).toBe(400);
    });
    it("rejects startLine >= line", async () => {
      stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      const res = await post(app, cookie, { ...VALID_BODY, startLine: 12, startSide: "RIGHT" });
      expect(res.status).toBe(400);
    });
    it("rejects a body over the 65,536 cap", async () => {
      stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      const res = await post(app, cookie, { ...VALID_BODY, body: "x".repeat(65_537) });
      expect(res.status).toBe(400);
    });
    it("rejects a path over the 1,024 cap", async () => {
      // Client mirror: postCommentBlockedReason (apps/web) blocks the same
      // boundary — this pins the server side of that lockstep.
      stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      const res = await post(app, cookie, { ...VALID_BODY, path: "x".repeat(1_025) });
      expect(res.status).toBe(400);
    });
    it("rejects startSide without startLine (would 422 upstream as a fake stale anchor)", async () => {
      stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      const res = await post(app, cookie, { ...VALID_BODY, startSide: "RIGHT" });
      expect(res.status).toBe(400);
    });
    it("rejects a malformed JSON body", async () => {
      stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      const res = await post(app, cookie, "{not json");
      expect(res.status).toBe(400);
    });
  });
});
