// Collaborators-surface integration tests: `app.request()` against `createApp`
// over the PGlite harness. The installation-token GraphQL read enters through
// the injected `InstallationGitHubPort` (stubbed — the wire→domain mapping is
// the github package's suite); the gate's access check hits the global-fetch
// stub. The viewerCanPush guard must deny with NO port call — GitHub denies
// roster reads to non-push viewers, so must we.
import { createHash, randomBytes } from "node:crypto";
import type { ListRepoCollaboratorsInput, RepoCollaborators } from "github";
import {
  encryptToken,
  envKeyProvider,
  forTenant,
  grantAuth,
  isInstallationId,
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
  type AuthDeps,
  type InstallationGitHubPort,
} from "../src/index";
import { testLogger } from "./logging";

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_ID = 424242;
const REPO_SLUG = "octo/hello";
const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";

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

const CTX = { installationId: brandInstallation(BigInt(INSTALLATION_ID)) };

// ---------------------------------------------------------------------------
// Port stub — canned results, call log for cache/guard asserts.
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
        if (result === undefined) throw new Error("port stub exhausted");
        return result;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch) — the gate's access check only.
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

function stubGitHub(repositories: (call: number) => Response): {
  counts: { repositories: number };
} {
  const counts = { repositories: 0 };
  const fetchFn = vi.fn(
    async (input: string | URL | Request): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
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
  if (!sealedAccess.ok || !sealedRefresh.ok)
    throw new Error("seed encrypt failed");
  const grant = await grantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  const reviewerId = BigInt(reviewer.id);
  if (!isReviewerId(reviewerId)) throw new Error("bad reviewer id");
  await forTenant(handle, CTX).sessions.create({
    sessionTokenHash: sha256Hex(cookie),
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
    headers: cookie === undefined ? {} : { cookie: `rs_session=${cookie}` },
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
    kp = keyProvider();
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
      auth: authDeps(kp),
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

  it("404s when the viewer has no repo access (gate collapse), port untouched", async () => {
    const { port, log } = stubPort([okResult()]);
    stubGitHub(() => jsonResponse({ message: "denied" }, 404));
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await getCollaborators(makeApp(port), cookie);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(log.calls).toHaveLength(0);
  });

  it("404s for a read-only viewer WITHOUT calling the port (GitHub's own roster rule)", async () => {
    const { port, log } = stubPort([okResult()]);
    stubGitHub(() => repoOk(false));
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await getCollaborators(makeApp(port), cookie);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(log.calls).toHaveLength(0);
  });

  it("returns the roster with no-store for a push viewer, fetched on the installation token", async () => {
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

  it("shares the per-repo cache across viewers (one port call inside the TTL)", async () => {
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
    // roster entry — the point of the installation-token read.
    const second = await getCollaborators(app, otherCookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("cache-control")).toBe("no-store");
    expect(await second.json()).toEqual(await first.json());
    expect(log.calls).toHaveLength(1);
  });

  it("keeps a warm cache behind the push guard (read-only viewer 404s, no cache read)", async () => {
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
    // denied — the guard runs BEFORE the cache lookup, or the shared entry
    // would leak the roster to any read-access viewer.
    const denied = await getCollaborators(app, readOnlyCookie);
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(log.calls).toHaveLength(1);
  });

  it("collapses a port NOT_FOUND to 404 and maps other failures to 502", async () => {
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

  it("does not cache failures (a later read retries the port)", async () => {
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

  it("traverses exactly ONE authz gate (single access probe on a cold read)", async () => {
    const { port } = stubPort([okResult()]);
    const { counts } = stubGitHub(() => repoOk(true));
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await getCollaborators(makeApp(port), cookie);
    expect(res.status).toBe(200);
    expect(counts.repositories).toBe(1);
  });
});
