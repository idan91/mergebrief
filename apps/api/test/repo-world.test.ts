// The per-repo gate names the world a repo belongs to. A reader signed in
// through the App can see repos outside their installation, public ones
// above all, and reads their url-box briefs there with their own token. The
// gate passes those requests in the OWNER world, so nothing downstream can
// take the installation's rows for a repo the installation never held.
import { createHash, randomBytes } from "node:crypto";
import {
  createArtifactStore,
  createGrantAuth,
  createTenantRepository,
  encryptToken,
  PrStates,
  type AppDatabase,
  type KeyProvider,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { AUTHZ_CACHE_TTL_MS } from "../src/routes/authz";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  KEY_REF,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  answerInstallationRepositories,
  answerUserInstallations,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  buildAuthDeps,
  createKeyProvider,
  getRequestUrl,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";

const REPO_ID = 424242;
const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";

const TENANT_CTX = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER_CTX = { ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)) };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

interface GitHubCalls {
  readonly tokens: string[];
  listings: number;
}

/** The viewer's token sees the repo; the installation holds `held`. */
function stubGitHub(held: readonly number[]): GitHubCalls {
  const calls: GitHubCalls = { tokens: [], listings: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = getRequestUrl(
        input instanceof Request ? input : String(input),
      );
      const headers = new Headers(
        input instanceof Request ? input.headers : init?.headers,
      );
      calls.tokens.push(
        (headers.get("authorization") ?? "").replace(/^(token|Bearer)\s+/i, ""),
      );
      const membership = answerInstallationRepositories(url, held);
      if (membership !== undefined) {
        if (url.includes("/repositories")) {
          calls.listings += 1;
        }
        return membership;
      }
      if (url.includes("/repositories/")) {
        return jsonResponse({
          id: REPO_ID,
          full_name: REPO_SLUG,
          private: false,
          permissions: { push: true },
        });
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    }),
  );
  return calls;
}

async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok)
    throw new Error("seed encrypt failed");
  const expiresAt = new Date("2027-01-01T00:00:00Z");
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: expiresAt,
  });
  await createTenantRepository(handle, TENANT_CTX).sessions.create({
    sessionTokenHash: createHash("sha256").update(cookie).digest("hex"),
    reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt,
  });
  return cookie;
}

async function seedPullRequest(
  handle: AppDatabase,
  ctx: typeof TENANT_CTX | typeof OWNER_CTX,
  title: string,
): Promise<void> {
  await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
    title,
  });
}

describe("the per-repo gate's repo world", () => {
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

  function buildApp(): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: {
        fetchPullRequestConversation: async () => {
          throw new Error("conversation port must not be called");
        },
        listRepoCollaborators: async () => {
          throw new Error("collaborators port must not be called");
        },
        commitAttachment: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
        deleteAttachmentBranch: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
      },
    });
  }

  async function read(app: ApiApp, cookie: string): Promise<Response> {
    return app.request(`/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("opens a url-box brief on a repo outside the installation", async () => {
    const calls = stubGitHub([]);
    const cookie = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle, OWNER_CTX, "the reader's paste");

    const res = await read(buildApp(), cookie);
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      title: "the reader's paste",
      appInstalled: false,
    });
    expect(new Set(calls.tokens)).toEqual(new Set([ACCESS_TOKEN]));
  });

  it("asks GitHub once when a cold page fans out concurrent reads", async () => {
    const calls = stubGitHub([REPO_ID]);
    const cookie = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle, TENANT_CTX, "the installation's row");
    const app = buildApp();

    const responses = await Promise.all([
      read(app, cookie),
      read(app, cookie),
      read(app, cookie),
    ]);

    expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(calls.listings).toBe(1);
  });

  it("never serves the installation's row for a repo it does not hold", async () => {
    stubGitHub([]);
    const cookie = await seedSession(harness.handle, kp);
    await seedPullRequest(
      harness.handle,
      TENANT_CTX,
      "a row from before a transfer",
    );
    await seedPullRequest(harness.handle, OWNER_CTX, "the reader's paste");

    const res = await read(buildApp(), cookie);
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ title: "the reader's paste" });
  });

  it("keeps serving the installation's row for a repo it holds", async () => {
    stubGitHub([REPO_ID]);
    const cookie = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle, TENANT_CTX, "the installation's row");
    await seedPullRequest(harness.handle, OWNER_CTX, "the reader's paste");

    const res = await read(buildApp(), cookie);
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ title: "the installation's row" });
  });

  it("audits a write on an outside repo under the owner world", async () => {
    stubGitHub([]);
    const cookie = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle, OWNER_CTX, "the reader's paste");

    const res = await buildApp().request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session/chunks/c1/read?base=${"b".repeat(40)}&head=${"a".repeat(40)}`,
      {
        method: "PUT",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: `__Host-mergebrief_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ read: true }),
      },
    );

    // No brief at that span in the reader's world, so the write finds nothing.
    expect(res.status).toBe(404);
    const rows = await harness.raw(
      "select operation, installation_id, source from audit_log order by id",
    );
    expect(rows).toEqual([
      {
        operation: "set-chunk-read",
        installation_id: null,
        source: "url",
      },
    ]);
  });
});

const OTHER_INSTALLATION_ID = 111222;
const OTHER_REPO_ID = 535353;
const OTHER_PR_NUMBER = 9;
const OTHER_CTX = {
  installationId: brandInstallationId(BigInt(OTHER_INSTALLATION_ID)),
};

interface TwoInstallationStub {
  /** Which installations `GET /user/installations` lists, swappable mid-test. */
  reachable: number[];
}

/** Two installations, one repo each; the viewer's token reads both repos. */
function stubTwoInstallations(reachable: number[]): TwoInstallationStub {
  const stub: TwoInstallationStub = { reachable };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown): Promise<Response> => {
      const url = getRequestUrl(
        input instanceof Request ? input : String(input),
      );
      if (url.includes(`/user/installations/${INSTALLATION_ID}/repositories`)) {
        return (
          answerInstallationRepositories(url, [REPO_ID]) ??
          jsonResponse({}, 500)
        );
      }
      if (
        url.includes(
          `/user/installations/${OTHER_INSTALLATION_ID}/repositories`,
        )
      ) {
        return (
          answerInstallationRepositories(url, [OTHER_REPO_ID]) ??
          jsonResponse({}, 500)
        );
      }
      if (url.includes("/user/installations")) {
        return answerUserInstallations(stub.reachable);
      }
      if (url.includes(`/repositories/${OTHER_REPO_ID}`)) {
        return jsonResponse({
          id: OTHER_REPO_ID,
          full_name: "other/repo",
          private: false,
          permissions: { push: true },
        });
      }
      if (url.includes("/repositories/")) {
        return jsonResponse({
          id: REPO_ID,
          full_name: REPO_SLUG,
          private: false,
          permissions: { push: true },
        });
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    }),
  );
  return stub;
}

describe("the per-repo gate across two installations", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await harness.close();
  });

  function buildApp(): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: {
        fetchPullRequestConversation: async () => {
          throw new Error("conversation port must not be called");
        },
        listRepoCollaborators: async () => {
          throw new Error("collaborators port must not be called");
        },
        commitAttachment: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
        deleteAttachmentBranch: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
      },
    });
  }

  async function seedBothRows(): Promise<void> {
    await seedPullRequest(harness.handle, TENANT_CTX, "the first org's row");
    await createTenantRepository(harness.handle, OTHER_CTX).pullRequests.upsert(
      {
        repoId: brandRepoId(BigInt(OTHER_REPO_ID)),
        prNumber: OTHER_PR_NUMBER,
        repoSlug: "other/repo",
        state: PrStates.OPEN,
        title: "the second org's row",
      },
    );
  }

  async function readOther(app: ApiApp, cookie: string): Promise<Response> {
    return app.request(`/api/repos/${OTHER_REPO_ID}/pulls/${OTHER_PR_NUMBER}`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  async function readFirst(app: ApiApp, cookie: string): Promise<Response> {
    return app.request(`/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("reads rows from two installations on one session with no switch", async () => {
    stubTwoInstallations([INSTALLATION_ID, OTHER_INSTALLATION_ID]);
    const cookie = await seedSession(harness.handle, kp);
    await seedBothRows();
    const app = buildApp();

    const [first, other] = await Promise.all([
      readFirst(app, cookie),
      readOther(app, cookie),
    ]);

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ title: "the first org's row" });
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({ title: "the second org's row" });
  });

  it("answers 404 for a row held by an installation out of reach", async () => {
    stubTwoInstallations([INSTALLATION_ID]);
    const cookie = await seedSession(harness.handle, kp);
    await seedBothRows();

    const res = await readOther(buildApp(), cookie);

    expect(res.status).toBe(404);
  });

  it("stores a write on the second installation's row under the second", async () => {
    stubTwoInstallations([INSTALLATION_ID, OTHER_INSTALLATION_ID]);
    const cookie = await seedSession(harness.handle, kp);
    await seedBothRows();
    const otherRow = await createTenantRepository(
      harness.handle,
      OTHER_CTX,
    ).pullRequests.getByNumber(
      brandRepoId(BigInt(OTHER_REPO_ID)),
      OTHER_PR_NUMBER,
    );
    if (otherRow === undefined) throw new Error("seed missing");
    const brief = await createArtifactStore(
      harness.handle,
      OTHER_CTX,
    ).briefs.write({
      pullRequestId: otherRow.id,
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      headIndex: 1,
      commitCount: 1,
      provider: "anthropic",
      model: "claude",
      effort: "high",
      body: JSON.stringify({ groupIds: ["c1"], flags: [], filePaths: [] }),
      carriedChunkIds: [],
      anchorState: "anchored",
    });
    if (!brief.ok) throw new Error("brief seed failed");

    const res = await buildApp().request(
      `/api/repos/${OTHER_REPO_ID}/pulls/${OTHER_PR_NUMBER}/session/chunks/c1/read?base=${"b".repeat(40)}&head=${"a".repeat(40)}`,
      {
        method: "PUT",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: `__Host-mergebrief_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ read: true }),
      },
    );

    expect(res.status).toBe(200);
    const sessions = await harness.raw(
      "select installation_id from review_session",
    );
    expect(sessions).toEqual([{ installation_id: OTHER_INSTALLATION_ID }]);
    const audit = await harness.raw(
      "select operation, installation_id, source from audit_log order by id",
    );
    expect(audit).toEqual([
      {
        operation: "set-chunk-read",
        installation_id: OTHER_INSTALLATION_ID,
        source: "installation",
      },
    ]);
  });

  it("refuses a revoked installation once the window has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const stub = stubTwoInstallations([INSTALLATION_ID, OTHER_INSTALLATION_ID]);
    const cookie = await seedSession(harness.handle, kp);
    await seedBothRows();
    const app = buildApp();

    const granted = await readOther(app, cookie);
    stub.reachable = [INSTALLATION_ID];
    const insideWindow = await readOther(app, cookie);
    vi.advanceTimersByTime(AUTHZ_CACHE_TTL_MS + 1);
    const afterWindow = await readOther(app, cookie);

    expect(granted.status).toBe(200);
    expect(insideWindow.status).toBe(200);
    expect(afterWindow.status).toBe(404);
  });
});
