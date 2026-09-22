// POST /api/generate route tests: the url-box door end to end over PGlite,
// viewer-token resolve (GitHub stubbed at global fetch), owner-scoped
// upsert, and the enqueued worker job. Harness mirrors installations.test.ts.
import { randomBytes, createHash } from "node:crypto";
import {
  encryptToken,
  createTenantRepository,
  createGrantAuth,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type AppDatabase,
  type KeyProvider,
  type ReviewerId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AppDeps } from "../src/index";
import { testLogger } from "./logging";
import {
  KEY_REF,
  SECRET,
  buildAuthDeps,
  createKeyProvider,
  answerInstallationRepositories,
} from "./fixtures";

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const FALLBACK_PAT = "ghp_OPERATOR_PAT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";
const PR_URL = "https://github.com/o/r/pull/7";
const HEAD = "a".repeat(40);
const LIVE_HEAD = "c".repeat(40);
const BASE = "b".repeat(40);
const REPO_ID = 424242;

function brand<T extends bigint>(
  guard: (v: bigint) => v is T,
  value: number,
): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) throw new Error("bad branded id");
  return asBigInt;
}

const REVIEWER: ReviewerId = brand(isReviewerId, 555);
const OTHER_REVIEWER: ReviewerId = brand(isReviewerId, 556);

/** An OWNER-world session with no installation: the url-box viewer's shape. */
async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
  reviewer: ReviewerId = REVIEWER,
): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(cookie).digest("hex");
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
  await createTenantRepository(handle, {
    ownerUserId: reviewer,
  }).sessions.create({
    sessionTokenHash: hash,
    reviewerId: reviewer,
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return cookie;
}

const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
};

interface PrEndpointScript {
  /** Status per bearer token; default 200 with the canned PR. */
  byToken?: Record<string, number>;
  merged?: boolean;
  state?: string;
  /** Answer the OAuth token endpoint with a rotated pair. */
  tokenEndpoint?: boolean;
}

interface FetchCounts {
  prCallTokens: string[];
  /** GraphQL reads, the live read's calls. */
  graphqlCalls: number;
}

function prJson(script: PrEndpointScript): unknown {
  return {
    head: { sha: HEAD },
    base: {
      sha: BASE,
      repo: { id: REPO_ID, full_name: "o/r" },
    },
    state: script.state ?? "open",
    draft: false,
    merged: script.merged ?? false,
    title: "Add thing",
    body: "",
    html_url: PR_URL,
    commits: 3,
    user: { login: "octocat" },
    closed_at: script.merged === true ? "2026-08-01T00:00:00Z" : null,
    updated_at: "2026-09-20T10:00:00Z",
  };
}

function stubGitHub(script: PrEndpointScript = {}): FetchCounts {
  const counts: FetchCounts = { prCallTokens: [], graphqlCalls: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(
        input instanceof Request ? input.headers : init?.headers,
      );
      if (
        script.tokenEndpoint === true &&
        url.includes("/login/oauth/access_token")
      ) {
        return new Response(
          JSON.stringify({
            access_token: ROTATED_ACCESS,
            refresh_token: ROTATED_REFRESH,
            expires_in: 28_800,
            refresh_token_expires_in: 15_897_600,
            token_type: "bearer",
            scope: "",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              date: new Date().toUTCString(),
            },
          },
        );
      }
      const membership = answerInstallationRepositories(url, [REPO_ID]);
      if (membership !== undefined) {
        return membership;
      }
      if (url.endsWith("/graphql")) {
        counts.graphqlCalls += 1;
        return new Response(
          JSON.stringify({
            data: {
              p0: {
                databaseId: REPO_ID,
                nameWithOwner: "o/r",
                pullRequest: {
                  state: "OPEN",
                  isDraft: false,
                  title: "Live title",
                  closedAt: null,
                  updatedAt: "2026-09-20T10:00:00Z",
                  headRefOid: LIVE_HEAD,
                  author: { login: "octocat" },
                },
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              date: new Date().toUTCString(),
            },
          },
        );
      }
      if (url.includes("/repositories/")) {
        return new Response(
          JSON.stringify({
            full_name: "o/r",
            private: false,
            permissions: { push: false },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              date: new Date().toUTCString(),
            },
          },
        );
      }
      if (url.includes("/repos/o/r/pulls/7")) {
        const auth = headers.get("authorization") ?? "";
        const token = auth.replace(/^(token|Bearer)\s+/i, "");
        counts.prCallTokens.push(token);
        const status = script.byToken?.[token] ?? 200;
        if (status !== 200) {
          return new Response(JSON.stringify({ message: "Not Found" }), {
            status,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify(prJson(script)), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            date: new Date().toUTCString(),
          },
        });
      }
      throw new Error(`unexpected fetch in generate suite: ${url}`);
    }),
  );
  return counts;
}

async function post(
  app: ApiApp,
  cookie: string | undefined,
  url: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (cookie !== undefined) {
    headers["Cookie"] = `rs_session=${cookie}`;
  }
  return app.request("/api/generate", {
    method: "POST",
    body: JSON.stringify({ url }),
    headers,
  });
}

describe("POST /api/generate: the url-box door", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  function buildApp(fallbackToken?: string): ApiApp {
    const deps: AppDeps = {
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: unusedConversationPort,
      urlBoxFallbackToken: fallbackToken,
    };
    return createApp(deps);
  }

  it("401 with no session", async () => {
    stubGitHub();
    const res = await post(buildApp(), undefined, PR_URL);
    expect(res.status).toBe(401);
  });

  it("400 for a non-PR url", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(buildApp(), cookie, "https://example.com/nope");
    expect(res.status).toBe(400);
  });

  it("upserts the owner-scoped row, enqueues the worker job, returns coords", async () => {
    const counts = stubGitHub({ merged: true, state: "closed" });
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(buildApp(), cookie, PR_URL);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      repoId: String(REPO_ID),
      prNumber: 7,
    });
    expect(counts.prCallTokens).toEqual([ACCESS_TOKEN]);

    const rows = await harness.raw(
      "select installation_id, owner_user_id, source, state, repo_slug, title from pull_request",
    );
    expect(rows).toEqual([
      {
        installation_id: null,
        owner_user_id: Number(REVIEWER),
        source: "url",
        // A merged PR is a first-class url-box target, and still enqueues.
        state: "merged",
        repo_slug: "o/r",
        title: "Add thing",
      },
    ]);

    const generations = await harness.raw(
      "select status, head_sha from generation",
    );
    expect(generations).toEqual([{ status: "pending", head_sha: HEAD }]);
    // The paste is the row's first live read.
    const stamps = await harness.raw(
      "select github_head_sha, github_read_at is not null as read from pull_request",
    );
    expect(stamps).toEqual([{ github_head_sha: HEAD, read: true }]);

    const jobs = await harness.raw(
      "select payload, run_at from graphile_worker.jobs where task_identifier = 'generate'",
    );
    expect(jobs).toHaveLength(1);
    const payload = jobs[0]?.["payload"];
    expect(payload).toMatchObject({
      owner_user_id: String(REVIEWER),
      pull_request_id: expect.stringMatching(/^\d+$/),
      head_sha: HEAD,
    });
    expect(
      typeof payload === "object" && payload !== null && "grant_id" in payload,
    ).toBe(true);
    // A paste takes the short trailing window, never zero: a claimed job
    // cannot be replaced, so an immediate re-paste would generate twice.
    const runAt = new Date(String(jobs[0]?.["run_at"]));
    const delaySeconds = (runAt.getTime() - Date.now()) / 1000;
    expect(delaySeconds).toBeGreaterThan(1);
    expect(delaySeconds).toBeLessThanOrEqual(30);

    const audits = await harness.raw(
      "select installation_id, source, operation, outcome from audit_log",
    );
    expect(audits).toContainEqual({
      installation_id: null,
      source: "url",
      operation: "generate-brief",
      outcome: "ok",
    });
  });

  it("an installation-bound paste lands owner-world and reads back", async () => {
    stubGitHub();
    // Same shape as seedSession but bound to a tenant, the pre-url-box norm.
    const cookie = await (async () => {
      const raw = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(raw).digest("hex");
      const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
      const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
      if (!sealedAccess.ok || !sealedRefresh.ok)
        throw new Error("seed encrypt failed");
      const grant = await createGrantAuth(harness.handle).createGrant({
        ghTokenCiphertext: sealedAccess.value,
        ghRefreshTokenCiphertext: sealedRefresh.value,
        keyRef: KEY_REF,
        refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
      });
      await createTenantRepository(harness.handle, {
        installationId: brand(isInstallationId, 987654),
      }).sessions.create({
        sessionTokenHash: hash,
        reviewerId: REVIEWER,
        reviewerLogin: "octocat",
        grantId: grant.id,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      });
      return raw;
    })();
    const app = buildApp();

    const res = await post(app, cookie, PR_URL);
    expect(res.status).toBe(200);
    const rows = await harness.raw(
      "select installation_id, owner_user_id from pull_request",
    );
    expect(rows).toEqual([
      { installation_id: null, owner_user_id: Number(REVIEWER) },
    ]);

    // The read-back: the tenant ctx misses and the owner fallback resolves,
    // the poll-after-paste loop must work for exactly this viewer.
    const meta = await app.request(`/api/repos/${REPO_ID}/pulls/7`, {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(meta.status).toBe(200);
    const body: unknown = await meta.json();
    expect(body).toMatchObject({
      repoId: String(REPO_ID),
      prNumber: 7,
      briefAvailable: false,
      generation: { status: "pending" },
    });
  });

  it("opening a url brief reads GitHub live once the row is stale", async () => {
    const counts = stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    const app = buildApp();
    expect((await post(app, cookie, PR_URL)).status).toBe(200);

    const fresh = await app.request(`/api/repos/${REPO_ID}/pulls/7`, {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(fresh.status).toBe(200);
    expect(counts.graphqlCalls).toBe(0);

    await harness.raw(
      "update pull_request set github_read_at = now() - interval '10 minutes'",
    );
    const stale = await app.request(`/api/repos/${REPO_ID}/pulls/7`, {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(stale.status).toBe(200);
    expect(counts.graphqlCalls).toBe(1);
    const rows = await harness.raw(
      "select title, github_head_sha from pull_request",
    );
    expect(rows).toEqual([{ title: "Live title", github_head_sha: LIVE_HEAD }]);
  });

  it("when BOTH worlds hold the row, the tenant world wins the read-back", async () => {
    stubGitHub();
    const tenantCtx = { installationId: brand(isInstallationId, 987654) };
    // Seed the SAME coordinates in both worlds; only the tenant row carries
    // the marker slug.
    await createTenantRepository(harness.handle, tenantCtx).pullRequests.upsert(
      {
        repoId: brand(isRepoId, REPO_ID),
        prNumber: 7,
        repoSlug: "o/r",
        title: "tenant title",
        state: "open",
      },
    );
    await createTenantRepository(harness.handle, {
      ownerUserId: REVIEWER,
    }).pullRequests.upsert({
      repoId: brand(isRepoId, REPO_ID),
      prNumber: 7,
      repoSlug: "o/r",
      title: "owner title",
      state: "open",
    });
    const cookie = await (async () => {
      const raw = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(raw).digest("hex");
      const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
      const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
      if (!sealedAccess.ok || !sealedRefresh.ok)
        throw new Error("seed encrypt failed");
      const grant = await createGrantAuth(harness.handle).createGrant({
        ghTokenCiphertext: sealedAccess.value,
        ghRefreshTokenCiphertext: sealedRefresh.value,
        keyRef: KEY_REF,
        refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
      });
      await createTenantRepository(harness.handle, tenantCtx).sessions.create({
        sessionTokenHash: hash,
        reviewerId: REVIEWER,
        reviewerLogin: "octocat",
        grantId: grant.id,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      });
      return raw;
    })();

    const meta = await buildApp().request(`/api/repos/${REPO_ID}/pulls/7`, {
      headers: { Cookie: `rs_session=${cookie}` },
    });
    expect(meta.status).toBe(200);
    // The stored title is the row marker, so the tenant row must win.
    expect(await meta.json()).toMatchObject({ title: "tenant title" });
  });

  it("a second signed-in reader opens the url-box row another viewer pasted", async () => {
    // Url-box rows are instance-visible: the gate already made this reader
    // prove GitHub access to the repo, and the row is theirs to read.
    stubGitHub();
    const app = buildApp();
    expect(
      (await post(app, await seedSession(harness.handle, kp), PR_URL)).status,
    ).toBe(200);

    const other = await seedSession(harness.handle, kp, OTHER_REVIEWER);
    const meta = await app.request(`/api/repos/${REPO_ID}/pulls/7`, {
      headers: { Cookie: `rs_session=${other}` },
    });

    expect(meta.status).toBe(200);
    expect(await meta.json()).toMatchObject({ prNumber: 7 });
  });

  it("re-pasting replaces the pending job instead of stacking a second", async () => {
    stubGitHub();
    const cookie = await seedSession(harness.handle, kp);
    const app = buildApp();
    expect((await post(app, cookie, PR_URL)).status).toBe(200);
    const first = await harness.raw(
      "select run_at from graphile_worker.jobs where task_identifier = 'generate'",
    );
    expect((await post(app, cookie, PR_URL)).status).toBe(200);

    const prs = await harness.raw("select id from pull_request");
    expect(prs).toHaveLength(1);
    const jobs = await harness.raw(
      "select id, run_at from graphile_worker.jobs where task_identifier = 'generate'",
    );
    expect(jobs).toHaveLength(1);
    // Trailing, not fixed: the re-paste re-schedules the one job off the LAST
    // trigger, so its window never runs down while pastes keep arriving.
    const rescheduled = new Date(String(jobs[0]?.["run_at"])).getTime();
    expect(rescheduled).toBeGreaterThanOrEqual(
      new Date(String(first[0]?.["run_at"])).getTime(),
    );
    expect(rescheduled).toBeGreaterThan(Date.now() + 1000);
  });

  it("an expired viewer token spends the one refresh and retries rotated", async () => {
    const counts = stubGitHub({
      byToken: { [ACCESS_TOKEN]: 401 },
      tokenEndpoint: true,
    });
    const cookie = await seedSession(harness.handle, kp);
    // The PAT is CONFIGURED here so the assertion genuinely excludes it: a
    // 401 must spend the refresh, never escalate to the operator identity.
    const res = await post(buildApp(FALLBACK_PAT), cookie, PR_URL);
    expect(res.status).toBe(200);
    expect(counts.prCallTokens).toEqual([ACCESS_TOKEN, ROTATED_ACCESS]);
  });

  it("a viewer denial with no PAT collapses to the uniform 404", async () => {
    stubGitHub({ byToken: { [ACCESS_TOKEN]: 404 } });
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(buildApp(), cookie, PR_URL);
    expect(res.status).toBe(404);
    expect(await harness.raw("select id from pull_request")).toHaveLength(0);
  });

  it("a viewer denial retries once with the operator PAT", async () => {
    const counts = stubGitHub({ byToken: { [ACCESS_TOKEN]: 404 } });
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(buildApp(FALLBACK_PAT), cookie, PR_URL);
    expect(res.status).toBe(200);
    expect(counts.prCallTokens).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
  });

  // A 401 from the OPERATOR's key is not the reader's expiry: it must not
  // spend the request's one refresh, and it must not send the reader to
  // re-authenticate a credential that is not theirs.
  it("keeps the reader's 404 when the operator PAT is itself rejected", async () => {
    const counts = stubGitHub({
      byToken: { [ACCESS_TOKEN]: 404, [FALLBACK_PAT]: 401 },
      tokenEndpoint: true,
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await post(buildApp(FALLBACK_PAT), cookie, PR_URL);

    expect(res.status).toBe(404);
    // One viewer read, one PAT read, and NO rotated-token retry.
    expect(counts.prCallTokens).toEqual([ACCESS_TOKEN, FALLBACK_PAT]);
  });
});
