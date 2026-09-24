// Thread-resolution route tests: `app.request()` against `createApp` over the
// PGlite harness, GitHub stubbed at the global-fetch boundary
// (mark-ready.test.ts pattern).
import { randomBytes } from "node:crypto";
import {
  encryptToken,
  createTenantRepository,
  createGrantAuth,
  PrStates,
  type AppDatabase,
  type InstallationId,
  type KeyProvider,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FetchPullRequestConversationInput,
  GitHubApiError,
  PrConversation,
} from "github";
import type { Result } from "types/utils";
import { createApp, type ApiApp } from "../src/index";
import { testLogger, testLogging } from "./logging";
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

// Every case drives a full request over the PGlite harness; the slowest
// measures 3.0s, cold snapshot cache included.
vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const ROOT_COMMENT_ID = 91001;
const THREAD_NODE_ID = "PRRT_kwDOTHREAD";

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch), REST /repositories/:id + the GraphQL POST.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

function repoOk(): Response {
  return jsonResponse({ id: REPO_ID, full_name: REPO_SLUG, private: true });
}
function repoStatus(status: number): Response {
  return jsonResponse({ message: "denied" }, status);
}

/** One walk page holding a single thread whose root is `rootId`. */
function walkGraphql(
  isResolved: boolean,
  rootId = String(ROOT_COMMENT_ID),
): Response {
  return jsonResponse({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: THREAD_NODE_ID,
                isResolved,
                comments: { nodes: [{ fullDatabaseId: rootId }] },
              },
            ],
          },
        },
      },
    },
  });
}
function resolveMutationGraphql(): Response {
  return jsonResponse({
    data: { resolveReviewThread: { thread: { isResolved: true } } },
  });
}
function unresolveMutationGraphql(): Response {
  return jsonResponse({
    data: { unresolveReviewThread: { thread: { isResolved: false } } },
  });
}
function forbiddenGraphql(): Response {
  return jsonResponse({
    data: null,
    errors: [
      { type: "FORBIDDEN", message: "Resource not accessible by integration" },
    ],
  });
}
function graphqlError(): Response {
  return jsonResponse({
    data: null,
    errors: [{ type: "INTERNAL", message: "boom" }],
  });
}
function graphqlUnauthorized(): Response {
  return jsonResponse({ message: "Bad credentials" }, 401);
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
  readonly graphql?: (call: number) => Response;
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  repositories: number;
  graphql: number;
  token: number;
  readonly graphqlBodies: Array<Record<string, unknown>>;
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = {
    repositories: 0,
    graphql: 0,
    token: 0,
    graphqlBodies: [],
  };
  const fetchFn = vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
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
      if (url.endsWith("/graphql")) {
        const i = counts.graphql++;
        const raw =
          init?.body ??
          (input instanceof Request ? await input.text() : undefined);
        if (typeof raw === "string") {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === "object" && parsed !== null) {
            counts.graphqlBodies.push({ ...parsed });
          }
        }
        return cfg.graphql ? cfg.graphql(i) : jsonResponse({ data: null }, 500);
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

// ---------------------------------------------------------------------------
// Seeding + helpers.
// ---------------------------------------------------------------------------

async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<{ cookie: string }> {
  const cookie = randomBytes(32).toString("base64url");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok)
    throw new Error("seed encrypt failed");
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  await createTenantRepository(handle, CTX).sessions.create({
    sessionTokenHash: hashSha256Hex(cookie),
    reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return { cookie };
}

async function seedPr(handle: AppDatabase): Promise<void> {
  await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

async function auditCount(
  harness: PgliteHarness,
  action: string,
): Promise<number> {
  const rows = await harness.raw(
    // Successful flips only: the choke point also records refusals, and what
    // these cases pin is whether the flip itself was recorded.
    `select count(*)::int as n from audit_log where operation = '${action}' and outcome = 'ok'`,
  );
  const n = rows[0]?.["n"];
  if (typeof n !== "number") throw new Error("unexpected count result");
  return n;
}

const RESOLVE_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/comments/${ROOT_COMMENT_ID}/resolve`;
const UNRESOLVE_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/comments/${ROOT_COMMENT_ID}/unresolve`;

async function post(
  app: ApiApp,
  cookie: string | undefined,
  path: string,
): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers:
      cookie === undefined
        ? {}
        : { cookie: `__Host-mergebrief_session=${cookie}` },
  });
}

/** A minimal empty conversation, enough for the cache-eviction probes. */
const EMPTY_CONVERSATION: PrConversation = {
  threads: [],
  reviews: [],
  prComments: [],
  hasMoreThreads: false,
  hasMoreReviews: false,
  hasMorePrComments: false,
};

function countingConversationPort(): {
  port: {
    fetchPullRequestConversation(
      installationId: InstallationId,
      input: FetchPullRequestConversationInput,
    ): Promise<Result<PrConversation, GitHubApiError>>;
    listRepoCollaborators(): Promise<never>;
  };
  calls: () => number;
} {
  let calls = 0;
  return {
    port: {
      fetchPullRequestConversation: async () => {
        calls += 1;
        return { ok: true, value: EMPTY_CONVERSATION };
      },
      listRepoCollaborators: async () => {
        throw new Error("collaborators port must not be called in this suite");
      },
    },
    calls: () => calls,
  };
}

describe("thread resolve and unresolve routes", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;
  let conversationCalls: () => number;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    const counting = countingConversationPort();
    conversationCalls = counting.calls;
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: counting.port,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  it("401 without a session cookie and no GitHub call", async () => {
    const counts = stubGitHub({});
    const res = await post(app, undefined, RESOLVE_PATH);
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(0);
    expect(counts.graphql).toBe(0);
  });

  it("404 collapse when the viewer has no access to the repo", async () => {
    const counts = stubGitHub({ repositories: () => repoStatus(403) });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(404);
    expect(counts.graphql).toBe(0);
  });

  it("404 when the PR is outside the tenant, with no GraphQL call", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(404);
    expect(counts.graphql).toBe(0);
  });

  it("400 on a malformed comment id or PR number, with no mutation", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const badComment = await post(
      app,
      cookie,
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/comments/nope/resolve`,
    );
    expect(badComment.status).toBe(400);
    const badPr = await post(
      app,
      cookie,
      `/api/repos/${REPO_ID}/pulls/nope/comments/${ROOT_COMMENT_ID}/resolve`,
    );
    expect(badPr.status).toBe(400);
    expect(counts.graphql).toBe(0);
  });

  it("200 resolve walks, mutates, audits and answers no-store", async () => {
    const counts = stubGitHub({
      repositories: (i) =>
        i === 0
          ? repoOk() // the gate's access check
          : jsonResponse({
              id: REPO_ID,
              full_name: "octo/renamed",
              private: true,
            }),
      graphql: (i) => (i === 0 ? walkGraphql(false) : resolveMutationGraphql()),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      resolved: true,
      alreadyInTargetState: false,
    });
    // Gate check + the route's own fresh re-resolve.
    expect(counts.repositories).toBe(2);
    // The walk must target the FRESHLY resolved owner/name, never the gate's
    // cached slug (mutating-route rule).
    expect(counts.graphqlBodies[0]).toMatchObject({
      variables: { owner: "octo", repo: "renamed", prNumber: PR_NUMBER },
    });
    // The mutation carries the thread node id, never the PR number.
    expect(counts.graphqlBodies[1]).toMatchObject({
      variables: { threadId: THREAD_NODE_ID },
    });
    expect(await auditCount(harness, "resolve-thread")).toBe(1);
    expect(await auditCount(harness, "unresolve-thread")).toBe(0);
  });

  it("200 unresolve happy path with its own audit action", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) =>
        i === 0 ? walkGraphql(true) : unresolveMutationGraphql(),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await post(app, cookie, UNRESOLVE_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resolved: false,
      alreadyInTargetState: false,
    });
    expect(await auditCount(harness, "unresolve-thread")).toBe(1);
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("200 converges without a mutation when already in the target state", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      graphql: () => walkGraphql(true), // already resolved
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const conversationPath = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/conversation`;
    const cookieHeader = { cookie: `__Host-mergebrief_session=${cookie}` };

    // Prime the conversation cache first: convergence means SOMEONE ELSE
    // flipped the thread inside the TTL, so the cached conversation is stale
    // and the eviction must run on this path too.
    expect(
      (await app.request(conversationPath, { headers: cookieHeader })).status,
    ).toBe(200);
    expect(conversationCalls()).toBe(1);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resolved: true,
      alreadyInTargetState: true,
    });
    // Walk only, the read-time state short-circuits the mutation.
    expect(counts.graphql).toBe(1);
    expect(await auditCount(harness, "resolve-thread")).toBe(1);

    // Converged is still a success: the next read must fetch fresh.
    expect(
      (await app.request(conversationPath, { headers: cookieHeader })).status,
    ).toBe(200);
    expect(conversationCalls()).toBe(2);
  });

  it("200 converges on the unresolve direction without a mutation", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      graphql: () => walkGraphql(false), // already unresolved
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await post(app, cookie, UNRESOLVE_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resolved: false,
      alreadyInTargetState: true,
    });
    expect(counts.graphql).toBe(1);
    expect(await auditCount(harness, "unresolve-thread")).toBe(1);
  });

  it("keeps the landed flip and logs audit.fail when the audit write fails", async () => {
    const capture = testLogging();
    const counting = countingConversationPort();
    const captureApp = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: counting.port,
    });
    stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) => (i === 0 ? walkGraphql(false) : resolveMutationGraphql()),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    // Poison ONLY the audit write: the GitHub flip has already committed by
    // the time the audit insert runs, so the response must stay a 200 (an
    // error here would invite the FE to retry a done action).
    await harness.raw("alter table audit_log rename to audit_log_poisoned");

    const res = await post(captureApp, cookie, RESOLVE_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resolved: true,
      alreadyInTargetState: false,
    });
    const line = capture.lines().find((l) => l["evt"] === "audit.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["operation"]).toBe("resolve-thread");
    expect(line?.["err"]).toBeDefined();
  });

  it("404 when the walk exhausts without matching the comment id", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      graphql: () => walkGraphql(false, "777777"), // some other thread
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(404);
    expect(counts.graphql).toBe(1);
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("404 collapse when the in-route fresh repo resolve is denied", async () => {
    const counts = stubGitHub({
      repositories: (i) => (i === 0 ? repoOk() : repoStatus(403)),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(404);
    expect(counts.graphql).toBe(0);
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("403 github-permission on a mutation-stage FORBIDDEN", async () => {
    // Gate + fresh re-resolve both succeeded, the viewer has proven repo
    // access this request, so a mutation-stage FORBIDDEN (raced revocation /
    // read-only viewer) surfaces honestly instead of hiding existence.
    const counts = stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) => (i === 0 ? walkGraphql(false) : forbiddenGraphql()),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "github-permission",
      code: "github-permission",
    });
    expect(counts.graphql).toBe(2);
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("502 on a hard GraphQL failure, no audit", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) => (i === 0 ? walkGraphql(false) : graphqlError()),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("refreshes the token once when a GraphQL call 401s, then succeeds", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      graphql: (call) => {
        if (call === 0) return graphqlUnauthorized();
        if (call === 1) return walkGraphql(false);
        return resolveMutationGraphql();
      },
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(200);
    expect(counts.token).toBe(1);
    expect(counts.graphql).toBe(3);
  });

  it("401 when a second GitHub 401 lands after the one refresh", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      graphql: () => graphqlUnauthorized(),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(401);
    expect(counts.token).toBe(1);
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("busts the PR's conversation cache so a refetch reflects the write", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) => (i === 0 ? walkGraphql(false) : resolveMutationGraphql()),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const conversationPath = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/conversation`;

    // Prime the conversation cache, then verify a second read is served from it.
    const cookieHeader = { cookie: `__Host-mergebrief_session=${cookie}` };
    expect(
      (await app.request(conversationPath, { headers: cookieHeader })).status,
    ).toBe(200);
    expect(
      (await app.request(conversationPath, { headers: cookieHeader })).status,
    ).toBe(200);
    expect(conversationCalls()).toBe(1);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(200);

    // The write evicted the entry: the next read fetches fresh.
    expect(
      (await app.request(conversationPath, { headers: cookieHeader })).status,
    ).toBe(200);
    expect(conversationCalls()).toBe(2);
  });

  it("does NOT bust the conversation cache on a failed mutation", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) => (i === 0 ? walkGraphql(false) : graphqlError()),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const conversationPath = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/conversation`;
    const cookieHeader = { cookie: `__Host-mergebrief_session=${cookie}` };

    expect(
      (await app.request(conversationPath, { headers: cookieHeader })).status,
    ).toBe(200);
    expect(conversationCalls()).toBe(1);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(502);

    // Entry still cached, no refetch.
    expect(
      (await app.request(conversationPath, { headers: cookieHeader })).status,
    ).toBe(200);
    expect(conversationCalls()).toBe(1);
  });
});
