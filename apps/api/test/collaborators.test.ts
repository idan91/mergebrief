// Collaborators-surface integration tests against `createApp` over the PGlite
// harness. The installation-token GraphQL read enters through the injected and
// stubbed `InstallationGitHubPort`, and the gate's access check hits the
// global-fetch stub. viewerCanPush must deny with NO port call.
import { randomBytes } from "node:crypto";
import type { ListRepoCollaboratorsInput, RepoCollaborators } from "github";
import {
  encryptToken,
  createTenantRepository,
  createGrantAuth,
  isReviewerId,
  type AppDatabase,
  type InstallationId,
  type KeyProvider,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  type ApiApp,
  type InstallationGitHubPort,
} from "../src/index";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  KEY_REF,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  buildAuthDeps,
  createKeyProvider,
  hashSha256Hex,
  getRequestUrl,
  answerInstallationRepositories,
} from "./fixtures";

const REPO_ID = 424242;
const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };

// ---------------------------------------------------------------------------
// Port stub, canned results, call log for cache/guard asserts.
// ---------------------------------------------------------------------------

function rosterFixture(): RepoCollaborators {
  return {
    collaborators: [
      {
        login: "alice",
        name: "Alice Example",
        avatarUrl: "https://avatars.example/alice.png",
      },
      { login: "bob", avatarUrl: "https://avatars.example/bob.png" },
    ],
    hasMore: false,
  };
}

interface PortLog {
  readonly calls: Array<{
    installationId: InstallationId;
    input: ListRepoCollaboratorsInput;
  }>;
}

function stubPort(
  results: Array<
    Awaited<ReturnType<InstallationGitHubPort["listRepoCollaborators"]>>
  >,
): { port: InstallationGitHubPort; log: PortLog } {
  const log: PortLog = { calls: [] };
  let call = 0;
  return {
    log,
    port: {
      fetchPullRequestConversation: async () => {
        throw new Error("conversation port must not be called in this suite");
      },
      async listRepoCollaborators(installationId, input) {
        log.calls.push({ installationId, input });
        const result = results[Math.min(call, results.length - 1)];
        call += 1;
        if (result === undefined) {
          throw new Error("port stub exhausted");
        }
        return result;
      },
      commitAttachment: async () => {
        throw new Error("attachment port must not be called in this suite");
      },
      deleteAttachmentBranch: async () => {
        throw new Error("attachment port must not be called in this suite");
      },
    },
  };
}

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch), the gate's access check only.
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

/** Gate probe: viewer has access; `push` controls the roster guard. */
function repoOk(push: boolean): Response {
  return jsonResponse({
    id: REPO_ID,
    full_name: REPO_SLUG,
    private: true,
    permissions: { push },
  });
}

function stubGitHub(
  repositories: (call: number) => Response,
  installationRepos: readonly number[] = [REPO_ID],
): {
  counts: { repositories: number };
} {
  const counts = { repositories: 0 };
  const fetchFn = vi.fn(
    async (input: string | URL | Request): Promise<Response> => {
      const url = getRequestUrl(input);
      const membership = answerInstallationRepositories(url, installationRepos);
      if (membership !== undefined) {
        return membership;
      }
      if (url.includes("/repositories/")) {
        const i = counts.repositories++;
        return repositories(i);
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return { counts };
}

// ---------------------------------------------------------------------------
// Seeding + request helpers.
// ---------------------------------------------------------------------------

async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
  reviewer: { id: number; login: string } = {
    id: REVIEWER_ID,
    login: "octocat",
  },
): Promise<{ cookie: string }> {
  const cookie = randomBytes(32).toString("base64url");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(
    kp,
    KEY_REF,
    "ghr_REFRESH_TOKEN_PLAINTEXT",
  );
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed encrypt failed");
  }
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  const reviewerId = BigInt(reviewer.id);
  if (!isReviewerId(reviewerId)) {
    throw new Error("bad reviewer id");
  }
  await createTenantRepository(handle, CTX).sessions.create({
    sessionTokenHash: hashSha256Hex(cookie),
    reviewerId,
    reviewerLogin: reviewer.login,
    grantId: grant.id,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return { cookie };
}

const COLLABORATORS_PATH = `/api/repos/${REPO_ID}/collaborators`;

async function getCollaborators(
  app: ApiApp,
  cookie: string | undefined,
  path = COLLABORATORS_PATH,
): Promise<Response> {
  return await app.request(path, {
    headers:
      cookie === undefined
        ? {}
        : { cookie: `__Host-mergebrief_session=${cookie}` },
  });
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

describe("GET /api/repos/:repoId/collaborators", () => {
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

  function makeApp(port: InstallationGitHubPort): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: port,
    });
  }

  const okResult = () => ({ ok: true as const, value: rosterFixture() });

  it("401s without a session cookie and never calls the port", async () => {
    const { port, log } = stubPort([okResult()]);
    stubGitHub(() => repoOk(true));
    const res = await getCollaborators(makeApp(port), undefined);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(log.calls).toHaveLength(0);
  });

  it("404s without repo access and leaves the port untouched", async () => {
    const { port, log } = stubPort([okResult()]);
    stubGitHub(() => jsonResponse({ message: "denied" }, 404));
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await getCollaborators(makeApp(port), cookie);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(log.calls).toHaveLength(0);
  });

  it("404s for a push viewer on a repo outside the installation", async () => {
    const { port, log } = stubPort([okResult()]);
    stubGitHub(() => repoOk(true), []);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await getCollaborators(makeApp(port), cookie);
    expect(res.status).toBe(404);
    expect(log.calls).toHaveLength(0);
  });

  it("404s for a read-only viewer without calling the port", async () => {
    const { port, log } = stubPort([okResult()]);
    stubGitHub(() => repoOk(false));
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await getCollaborators(makeApp(port), cookie);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(log.calls).toHaveLength(0);
  });

  it("returns the roster with no-store for a push viewer", async () => {
    const { port, log } = stubPort([okResult()]);
    stubGitHub(() => repoOk(true));
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await getCollaborators(makeApp(port), cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body: unknown = await res.json();
    expect(body).toEqual({
      collaborators: [
        {
          login: "alice",
          name: "Alice Example",
          avatarUrl: "https://avatars.example/alice.png",
        },
        { login: "bob", avatarUrl: "https://avatars.example/bob.png" },
      ],
      hasMore: false,
    });
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0]?.installationId).toBe(CTX.installationId);
    // Fetched by the AUTHZ-VERIFIED slug, split into owner/repo.
    expect(log.calls[0]?.input).toEqual({ owner: "octo", repo: "hello" });
  });

  it("shares the per-repo cache across viewers within the TTL", async () => {
    const { port, log } = stubPort([okResult()]);
    stubGitHub(() => repoOk(true));
    const { cookie } = await seedSession(harness.handle, kp);
    const { cookie: otherCookie } = await seedSession(harness.handle, kp, {
      id: 556,
      login: "hubot",
    });
    const app = makeApp(port);
    const first = await getCollaborators(app, cookie);
    // A DIFFERENT push viewer (own session, own gate probe) rides the same
    // roster entry, the point of the installation-token read.
    const second = await getCollaborators(app, otherCookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("cache-control")).toBe("no-store");
    expect(await second.json()).toEqual(await first.json());
    expect(log.calls).toHaveLength(1);
  });

  it("keeps a warm cache behind the push guard for a read-only viewer", async () => {
    const { port, log } = stubPort([okResult()]);
    // Gate probes arrive in request order: push viewer first, read-only second.
    stubGitHub((call) => repoOk(call === 0));
    const { cookie } = await seedSession(harness.handle, kp);
    const { cookie: readOnlyCookie } = await seedSession(harness.handle, kp, {
      id: 557,
      login: "lurker",
    });
    const app = makeApp(port);
    expect((await getCollaborators(app, cookie)).status).toBe(200);
    // The roster is now cached repo-wide. A read-only viewer must still be
    // denied, the guard runs BEFORE the cache lookup, or the shared entry
    // would leak the roster to any read-access viewer.
    const denied = await getCollaborators(app, readOnlyCookie);
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(log.calls).toHaveLength(1);
  });

  it("collapses a port NOT_FOUND to 404 and an upstream failure to 502", async () => {
    const notFound = {
      ok: false as const,
      error: {
        code: "not-found" as const,
        message: "failed to list repo collaborators: x",
      },
    };
    const failed = {
      ok: false as const,
      error: {
        code: "request-failed" as const,
        message: "failed to list repo collaborators: y",
      },
    };
    stubGitHub(() => repoOk(true));
    const { cookie } = await seedSession(harness.handle, kp);

    const notFoundApp = makeApp(stubPort([notFound]).port);
    const notFoundRes = await getCollaborators(notFoundApp, cookie);
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.headers.get("cache-control")).toBe("no-store");

    const failedApp = makeApp(stubPort([failed]).port);
    const failedRes = await getCollaborators(failedApp, cookie);
    expect(failedRes.status).toBe(502);
    expect(failedRes.headers.get("cache-control")).toBe("no-store");
  });

  it("collapses a port 403 to 404 and keeps an App 401 a 502", async () => {
    const forbidden = {
      ok: false as const,
      error: {
        code: "forbidden" as const,
        message: "failed to list repo collaborators: z",
      },
    };
    const unauthorized = {
      ok: false as const,
      error: {
        code: "unauthorized" as const,
        message: "failed to list repo collaborators: w",
      },
    };
    stubGitHub(() => repoOk(true));
    const { cookie } = await seedSession(harness.handle, kp);

    const forbiddenRes = await getCollaborators(
      makeApp(stubPort([forbidden]).port),
      cookie,
    );
    expect(forbiddenRes.status).toBe(404);
    expect(await forbiddenRes.json()).toMatchObject({ code: "not-found" });

    const unauthorizedRes = await getCollaborators(
      makeApp(stubPort([unauthorized]).port),
      cookie,
    );
    expect(unauthorizedRes.status).toBe(502);
  });

  it("does not cache failures, so a later read retries the port", async () => {
    const failed = {
      ok: false as const,
      error: {
        code: "request-failed" as const,
        message: "failed to list repo collaborators: y",
      },
    };
    const { port, log } = stubPort([failed, okResult()]);
    stubGitHub(() => repoOk(true));
    const { cookie } = await seedSession(harness.handle, kp);
    const app = makeApp(port);
    expect((await getCollaborators(app, cookie)).status).toBe(502);
    expect((await getCollaborators(app, cookie)).status).toBe(200);
    expect(log.calls).toHaveLength(2);
  });

  it("traverses exactly ONE authz gate on a cold read", async () => {
    const { port } = stubPort([okResult()]);
    const { counts } = stubGitHub(() => repoOk(true));
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await getCollaborators(makeApp(port), cookie);
    expect(res.status).toBe(200);
    expect(counts.repositories).toBe(1);
  });
});
