import { randomBytes } from "node:crypto";
import { Hono, type Handler } from "hono";
import { GitHubApiErrorCodes, fetchRepositoryById } from "github";
import type * as githubModule from "github";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isInstallationId,
  isOwnerContext,
  isRepoId,
  isReviewerId,
  createTenantRepository,
  PrStates,
  WriteClassifications,
  type InstallationId,
  type RepoId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Mutable, Result } from "types/utils";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AllowedRepoResolver } from "./allowed-repos";
import { repoAuthzLayer, type AuthzEnv } from "./authz";
import { createErrorHandler } from "../shared-errors/on-error";
import type * as refreshModule from "./auth/session/logic/refresh";
import {
  AuthChannels,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "./auth/session/types";
import { refreshSessionToken } from "./auth/session/logic/refresh";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  fetchRepositoryById: vi.fn(),
}));

vi.mock("./auth/session/logic/refresh", async (importOriginal) => ({
  ...(await importOriginal<typeof refreshModule>()),
  refreshSessionToken: vi.fn(),
}));

const KEY_REF = "SESSION_KEY_TEST";
const keyProvider = createEnvKeyProvider({
  [KEY_REF]: randomBytes(32).toString("base64"),
});

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

function brand<T extends bigint>(
  value: bigint,
  guard: (v: bigint) => v is T,
): T {
  if (!guard(value)) {
    throw new Error("unbrandable fixture value");
  }
  return value;
}

let harness: PgliteHarness;
beforeAll(async () => {
  harness = await createPgliteHarness();
});
afterAll(async () => {
  await harness.close();
});

const REPO_IN_INSTALLATION = 9101n;

interface GateAppOptions {
  /** `null` builds the installation-less, url-box-only viewer. */
  readonly installationId?: InstallationId | null;
  readonly channel?: ViewerPrincipal["channel"];
  readonly allowedRepos?: AllowedRepoResolver;
  readonly urlBoxFallbackToken?: string;
}

/** The installation holds exactly one repo; every other id is outside it. */
function stubAllowedRepos(): AllowedRepoResolver {
  const allowed = new Map<RepoId, string>([
    [brand(REPO_IN_INSTALLATION, isRepoId), "acme/inside"],
  ]);
  return {
    resolve: vi.fn<AllowedRepoResolver["resolve"]>(async (session) => ({
      ok: true,
      value: { allowed, session },
    })),
  };
}

function stubFailingAllowedRepos(status: 401 | 502): AllowedRepoResolver {
  return {
    resolve: vi.fn<AllowedRepoResolver["resolve"]>(async () => ({
      ok: false,
      error: { status },
    })),
  };
}

async function buildGateApp(
  options: GateAppOptions = {},
): Promise<Hono<AuthzEnv>> {
  const installationId =
    options.installationId === undefined
      ? brand(10n, isInstallationId)
      : options.installationId;
  const allowedRepos = options.allowedRepos ?? stubAllowedRepos();
  const sealed = await encryptToken(keyProvider, KEY_REF, "stale-token");
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  const session: ViewerPrincipal = {
    id: 1n,
    installationId,
    sessionTokenHash: `hash-authz-unit-${randomBytes(4).toString("hex")}`,
    reviewerId: brand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId: brand(7n, isGrantRowId),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: sealed.value,
    keyRef: KEY_REF,
    scope: WriteClassifications.EXTERNAL_WRITE,
    channel: options.channel ?? AuthChannels.COOKIE,
  };
  const deps: Mutable<AuthRouteDeps> = {
    handle: harness.handle,
    auth: {
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      keyProvider,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: "https://example.test",
      cookieSecure: false,
    },
  };
  if (options.urlBoxFallbackToken !== undefined) {
    deps.urlBoxFallbackToken = options.urlBoxFallbackToken;
  }
  const app = new Hono<AuthzEnv>();
  app.onError(createErrorHandler<AuthzEnv>(log));
  app.use(async (c, next) => {
    c.set("logger", log);
    if (installationId === null) {
      c.set("ctx", { ownerUserId: session.reviewerId });
    } else {
      c.set("ctx", { installationId });
    }
    c.set("session", session);
    await next();
  });
  // One layer instance, mounted where each probe's params are in scope: the
  // rung reads `:prNumber`, which a `/:repoId/*` mount never sees.
  const gate = repoAuthzLayer(deps, allowedRepos);
  app.use("/:repoId/probe", gate);
  app.use("/:repoId/pulls/:prNumber/*", gate);
  const reportWorld: Handler<AuthzEnv> = (c) => {
    const world = isOwnerContext(c.get("ctx")) ? "owner" : "installation";
    return c.json({ ok: true, world });
  };
  app.get("/:repoId/probe", reportWorld);
  app.get("/:repoId/pulls/:prNumber/probe", reportWorld);
  return app;
}

function stubDeniedRepo(
  status: number,
): Result<never, githubModule.GitHubApiError> {
  const code =
    status === 401
      ? GitHubApiErrorCodes.UNAUTHORIZED
      : GitHubApiErrorCodes.FORBIDDEN;
  return { ok: false, error: { code, status, message: "denied" } };
}

beforeEach(() => {
  vi.mocked(fetchRepositoryById).mockReset();
  vi.mocked(refreshSessionToken).mockReset();
});

describe("repoAuthzLayer refresh disambiguation", () => {
  it("collapses a 401 after successful refresh to 404", async () => {
    const app = await buildGateApp();
    vi.mocked(fetchRepositoryById).mockResolvedValue(stubDeniedRepo(401));
    vi.mocked(refreshSessionToken).mockImplementation(async (_d, session) => ({
      ok: true,
      value: { session, accessToken: "rotated-token" },
    }));

    const res = await app.request("/9101/probe");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", code: "not-found" });
    // One cold check + exactly one post-refresh retry; one refresh spent.
    expect(fetchRepositoryById).toHaveBeenCalledTimes(2);
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
  });

  it("keeps the refresh-failed 401 posture when no retry was possible", async () => {
    const app = await buildGateApp();
    vi.mocked(fetchRepositoryById).mockResolvedValue(stubDeniedRepo(401));
    vi.mocked(refreshSessionToken).mockResolvedValue({
      ok: false,
      error: { code: "refresh-failed", message: "refresh failed" },
    });

    const res = await app.request("/9101/probe");

    expect(res.status).toBe(401);
    expect(fetchRepositoryById).toHaveBeenCalledTimes(1);
  });
});

function stubGrantedRepo(
  fullName: string,
): Result<githubModule.RepositoryInfo, never> {
  return {
    ok: true,
    value: {
      repoId: brand(REPO_IN_INSTALLATION, isRepoId),
      fullName,
      private: false,
      viewerCanPush: false,
    },
  };
}

describe("repoAuthzLayer repo world", () => {
  it("keeps the installation world for a repo inside it", async () => {
    const app = await buildGateApp();
    vi.mocked(fetchRepositoryById).mockResolvedValue(
      stubGrantedRepo("acme/inside"),
    );

    const res = await app.request(`/${REPO_IN_INSTALLATION}/probe`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, world: "installation" });
  });

  it("moves a visible repo outside the installation to the owner world", async () => {
    const app = await buildGateApp();
    vi.mocked(fetchRepositoryById).mockResolvedValue(
      stubGrantedRepo("other/public"),
    );

    const res = await app.request("/7777/probe");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, world: "owner" });
  });

  it("never asks about membership for an installation-less session", async () => {
    const allowedRepos = stubAllowedRepos();
    const app = await buildGateApp({ installationId: null, allowedRepos });
    vi.mocked(fetchRepositoryById).mockResolvedValue(
      stubGrantedRepo("other/public"),
    );

    const res = await app.request("/7777/probe");

    expect(await res.json()).toEqual({ ok: true, world: "owner" });
    expect(allowedRepos.resolve).not.toHaveBeenCalled();
  });

  it("treats a Bearer principal outside its installation the same", async () => {
    const app = await buildGateApp({ channel: AuthChannels.BEARER });
    vi.mocked(fetchRepositoryById).mockResolvedValue(
      stubGrantedRepo("other/public"),
    );

    const res = await app.request("/7777/probe");

    expect(await res.json()).toEqual({ ok: true, world: "owner" });
  });

  it("replays the owner world from the cache without asking again", async () => {
    const allowedRepos = stubAllowedRepos();
    const app = await buildGateApp({ allowedRepos });
    vi.mocked(fetchRepositoryById).mockResolvedValue(
      stubGrantedRepo("other/public"),
    );

    await app.request("/7777/probe");
    const res = await app.request("/7777/probe");

    expect(await res.json()).toEqual({ ok: true, world: "owner" });
    expect(fetchRepositoryById).toHaveBeenCalledTimes(1);
    expect(allowedRepos.resolve).toHaveBeenCalledTimes(1);
  });

  it("answers 401 when the membership lookup finds the auth dead", async () => {
    const app = await buildGateApp({
      allowedRepos: stubFailingAllowedRepos(401),
    });
    vi.mocked(fetchRepositoryById).mockResolvedValue(
      stubGrantedRepo("acme/inside"),
    );

    const res = await app.request(`/${REPO_IN_INSTALLATION}/probe`);

    expect(res.status).toBe(401);
  });

  it("answers 502 on a membership outage and caches nothing", async () => {
    const allowedRepos = stubFailingAllowedRepos(502);
    const app = await buildGateApp({ allowedRepos });
    vi.mocked(fetchRepositoryById).mockResolvedValue(
      stubGrantedRepo("acme/inside"),
    );

    const first = await app.request(`/${REPO_IN_INSTALLATION}/probe`);
    const second = await app.request(`/${REPO_IN_INSTALLATION}/probe`);

    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ code: "github-unavailable" });
    expect(second.status).toBe(502);
    expect(allowedRepos.resolve).toHaveBeenCalledTimes(2);
  });

  it("leaves the operator-token rung alone", async () => {
    const allowedRepos = stubAllowedRepos();
    const app = await buildGateApp({
      allowedRepos,
      urlBoxFallbackToken: "operator-pat",
    });
    await createTenantRepository(harness.handle, {
      ownerUserId: brand(42n, isReviewerId),
    }).pullRequests.upsert({
      repoId: brand(8888n, isRepoId),
      prNumber: 5,
      repoSlug: "other/private",
      state: PrStates.OPEN,
    });
    vi.mocked(fetchRepositoryById)
      .mockResolvedValueOnce(stubDeniedRepo(404))
      .mockResolvedValueOnce(stubGrantedRepo("other/private"));

    const res = await app.request("/8888/pulls/5/probe");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, world: "installation" });
    expect(allowedRepos.resolve).not.toHaveBeenCalled();
  });
});
