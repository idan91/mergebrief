import { randomBytes } from "node:crypto";
import { Hono, type Handler } from "hono";
import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isInstallationId,
  isRepoId,
  isReviewerId,
  createTenantRepository,
  WriteClassifications,
  type RepoId,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Mutable } from "types/utils";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildAuthDeps } from "../../test/fixtures";
import type {
  AllowedRepo,
  InstallationResolver,
  RepoWorld,
} from "../routes/installation-resolver";
import { repoAuthzLayer } from "./index";
import { AUTHZ_CACHE_TTL_MS } from "./consts";
import { AccessFootings, type AuthzEnv } from "./types";
import { createErrorHandler } from "../shared-errors/on-error";
import type * as refreshModule from "../routes/auth/session/logic/refresh";
import {
  AuthChannels,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "../routes/auth/session/types";
import { refreshSessionToken } from "../routes/auth/session/logic/refresh";

vi.mock("../routes/auth/session/logic/refresh", async (importOriginal) => ({
  ...(await importOriginal<typeof refreshModule>()),
  refreshSessionToken: vi.fn(),
}));

const KEY_REF = "SESSION_KEY_TEST";
const keyProvider = createEnvKeyProvider({
  [KEY_REF]: randomBytes(32).toString("base64"),
});

const STALE_TOKEN = "stale-token";
const ROTATED_TOKEN = "rotated-token";

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
  readonly channel?: ViewerPrincipal["channel"];
  readonly installations?: InstallationResolver;
  readonly operatorToken?: string;
}

const INSTALLATION_ID = brand(10n, isInstallationId);

/** The installation holds exactly one repo; every other id is outside it. */
function stubInstallations(): InstallationResolver {
  const allowed = new Map<RepoId, AllowedRepo>([
    [
      brand(REPO_IN_INSTALLATION, isRepoId),
      {
        installationId: INSTALLATION_ID,
        fullName: "acme/inside",
        viewerIsAdmin: false,
      },
    ],
  ]);
  return {
    listAllowedRepos: vi.fn<InstallationResolver["listAllowedRepos"]>(
      async (request) => ({
        ok: true,
        value: {
          allowed,
          session: request.credential.session(),
          expiresAt: Date.now() + AUTHZ_CACHE_TTL_MS,
        },
      }),
    ),
    resolveInstallationForRepo: vi.fn<
      InstallationResolver["resolveInstallationForRepo"]
    >(async (request, repoId) => {
      const entry = allowed.get(repoId);
      const world: RepoWorld =
        entry === undefined
          ? { kind: "owner" }
          : { kind: "installation", installationId: entry.installationId };
      return {
        ok: true,
        value: {
          world,
          session: request.credential.session(),
          expiresAt: Date.now() + AUTHZ_CACHE_TTL_MS,
        },
      };
    }),
  };
}

function stubFailingInstallations(status: 401 | 502): InstallationResolver {
  const failure = { ok: false, error: { status } } as const;
  return {
    listAllowedRepos: vi.fn(async () => failure),
    resolveInstallationForRepo: vi.fn(async () => failure),
  };
}

let fake: FakeGitHub;

async function buildGateApp(
  options: GateAppOptions = {},
): Promise<Hono<AuthzEnv>> {
  const installations = options.installations ?? stubInstallations();
  const sealed = await encryptToken(keyProvider, KEY_REF, STALE_TOKEN);
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  const session: ViewerPrincipal = {
    id: 1n,
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
      ...buildAuthDeps(keyProvider),
      sessionKeyRef: KEY_REF,
      bindReviewerGitHub: (credential, bindOptions) =>
        fake.bindReviewerGitHub(credential, bindOptions),
      bindOperatorGitHub: (token, bindOptions) =>
        fake.bindOperatorGitHub(token, bindOptions),
    },
  };
  if (options.operatorToken !== undefined) {
    deps.operatorToken = {
      token: options.operatorToken,
      reviewerIds: new Set([session.reviewerId]),
    };
  }
  const app = new Hono<AuthzEnv>();
  app.onError(createErrorHandler<AuthzEnv>(log));
  app.use(async (c, next) => {
    c.set("logger", log);
    c.set("session", session);
    await next();
  });
  app.use("/:repoId/*", repoAuthzLayer(deps, installations));
  const reportWorld: Handler<AuthzEnv> = (c) => {
    const world = c.get("repoAccess").installation.kind;
    return c.json({ ok: true, world });
  };
  app.get("/:repoId/probe", reportWorld);
  app.get("/:repoId/pulls/:prNumber/probe", reportWorld);
  app.get("/:repoId/access", reportAccess);
  app.get("/:repoId/pulls/:prNumber/access", reportAccess);
  return app;
}

const reportAccess: Handler<AuthzEnv> = (c) => {
  const access = c.get("repoAccess");
  const prNumber =
    access.footing === AccessFootings.OPERATOR ? access.prNumber : null;
  return c.json({
    footing: access.footing,
    prNumber,
    repoFullName: access.repoFullName,
    viewerCanPush: access.viewerCanPush,
    installation: access.installation.kind,
  });
};

/** GitHub holds `repoId` under `fullName`; the viewer can read it. */
function arrangeRepo(repoId: bigint, fullName: string): void {
  fake.addRepository({
    repoId: brand(repoId, isRepoId),
    fullName,
    private: false,
    viewerCanPush: false,
    viewerIsAdmin: false,
  });
}

/** The viewer's token is refused the repo; any other credential reads it. */
function denyViewer(repoId: bigint, fullName: string): void {
  arrangeRepo(repoId, fullName);
  fake.failOn(
    "fetchRepositoryById",
    FakeFailures.NOT_FOUND,
    CredentialKinds.REVIEWER,
  );
}

function countRepositoryReads(): number {
  return fake.listCalls("fetchRepositoryById").length;
}

beforeEach(() => {
  fake = makeFakeGitHub();
  vi.mocked(refreshSessionToken).mockReset();
});

describe("repoAuthzLayer refresh disambiguation", () => {
  it("answers 401 when the check still 401s after a good refresh", async () => {
    const app = await buildGateApp();
    arrangeRepo(9101n, "acme/inside");
    fake.rejectToken(STALE_TOKEN);
    fake.rejectToken(ROTATED_TOKEN);
    vi.mocked(refreshSessionToken).mockImplementation(async (_d, session) => ({
      ok: true,
      value: { session, accessToken: ROTATED_TOKEN },
    }));

    const res = await app.request("/9101/probe");

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthorized" });
    // One cold check + exactly one post-refresh retry; one refresh spent.
    expect(countRepositoryReads()).toBe(2);
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
  });

  it("keeps the refresh-failed 401 posture when no retry was possible", async () => {
    const app = await buildGateApp();
    arrangeRepo(9101n, "acme/inside");
    fake.rejectToken(STALE_TOKEN);
    vi.mocked(refreshSessionToken).mockResolvedValue({
      ok: false,
      error: { code: "refresh-failed", message: "refresh failed" },
    });

    const res = await app.request("/9101/probe");

    expect(res.status).toBe(401);
    expect(countRepositoryReads()).toBe(1);
  });

  it("renews once for the gate's read and the route's own call", async () => {
    const app = await buildGateApp();
    app.get("/:repoId/route-call", async (c) => {
      const access = c.get("repoAccess");
      const read = await access.github.fetchRepositoryById(access.repoId);
      return c.json({ ok: read.ok });
    });
    arrangeRepo(REPO_IN_INSTALLATION, "acme/inside");
    fake.rejectToken(STALE_TOKEN);
    vi.mocked(refreshSessionToken).mockImplementation(async (_d, session) => ({
      ok: true,
      value: { session, accessToken: ROTATED_TOKEN },
    }));

    const res = await app.request(`/${REPO_IN_INSTALLATION}/route-call`);

    expect(await res.json()).toEqual({ ok: true });
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
    const tokens = fake
      .listCalls("fetchRepositoryById")
      .map((call) => ("token" in call.credential ? call.credential.token : ""));
    expect(tokens).toEqual([STALE_TOKEN, ROTATED_TOKEN, ROTATED_TOKEN]);
  });
});

describe("repoAuthzLayer upstream failures", () => {
  it("answers a GitHub outage 502 without the operator rung", async () => {
    const app = await buildGateApp({ operatorToken: "operator-pat" });
    await createTenantRepository(harness.handle, {
      ownerUserId: brand(42n, isReviewerId),
    }).pullRequests.upsert({
      repoId: brand(8889n, isRepoId),
      prNumber: 6,
      repoSlug: "other/outage",
      state: PrStates.OPEN,
    });
    fake.failOn("fetchRepositoryById", FakeFailures.SERVER_ERROR);

    const first = await app.request("/8889/pulls/6/probe");
    const second = await app.request("/8889/pulls/6/probe");

    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ code: "github-unavailable" });
    expect(second.status).toBe(502);
    // Reader's token only, twice: no PAT call and no cached answer.
    const kinds = fake
      .listCalls("fetchRepositoryById")
      .map((call) => call.credential.kind);
    expect(kinds).toEqual([CredentialKinds.REVIEWER, CredentialKinds.REVIEWER]);
  });
});

describe("repoAuthzLayer repo world", () => {
  it("keeps the installation world for a repo inside it", async () => {
    const app = await buildGateApp();
    arrangeRepo(REPO_IN_INSTALLATION, "acme/inside");

    const res = await app.request(`/${REPO_IN_INSTALLATION}/probe`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, world: "installation" });
  });

  it("moves a visible repo outside the installation to the owner world", async () => {
    const app = await buildGateApp();
    arrangeRepo(7777n, "other/public");

    const res = await app.request("/7777/probe");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, world: "owner" });
  });

  it("treats a Bearer principal outside its installation the same", async () => {
    const app = await buildGateApp({ channel: AuthChannels.BEARER });
    arrangeRepo(7777n, "other/public");

    const res = await app.request("/7777/probe");

    expect(await res.json()).toEqual({ ok: true, world: "owner" });
  });

  it("replays the owner world from the cache without asking again", async () => {
    const installations = stubInstallations();
    const app = await buildGateApp({ installations });
    arrangeRepo(7777n, "other/public");

    await app.request("/7777/probe");
    const res = await app.request("/7777/probe");

    expect(await res.json()).toEqual({ ok: true, world: "owner" });
    expect(countRepositoryReads()).toBe(1);
    expect(installations.resolveInstallationForRepo).toHaveBeenCalledTimes(1);
  });

  it("answers 401 when the membership lookup finds the auth dead", async () => {
    const app = await buildGateApp({
      installations: stubFailingInstallations(401),
    });
    arrangeRepo(REPO_IN_INSTALLATION, "acme/inside");

    const res = await app.request(`/${REPO_IN_INSTALLATION}/probe`);

    expect(res.status).toBe(401);
  });

  it("answers 502 on a membership outage and caches nothing", async () => {
    const installations = stubFailingInstallations(502);
    const app = await buildGateApp({ installations });
    arrangeRepo(REPO_IN_INSTALLATION, "acme/inside");

    const first = await app.request(`/${REPO_IN_INSTALLATION}/probe`);
    const second = await app.request(`/${REPO_IN_INSTALLATION}/probe`);

    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ code: "github-unavailable" });
    expect(second.status).toBe(502);
    expect(installations.resolveInstallationForRepo).toHaveBeenCalledTimes(2);
  });

  it("passes the operator-token rung in the owner world without asking", async () => {
    const installations = stubInstallations();
    const app = await buildGateApp({
      installations,
      operatorToken: "operator-pat",
    });
    await createTenantRepository(harness.handle, {
      ownerUserId: brand(42n, isReviewerId),
    }).pullRequests.upsert({
      repoId: brand(8888n, isRepoId),
      prNumber: 5,
      repoSlug: "other/private",
      state: PrStates.OPEN,
    });
    denyViewer(8888n, "other/private");

    const res = await app.request("/8888/pulls/5/probe");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, world: "owner" });
    expect(installations.resolveInstallationForRepo).not.toHaveBeenCalled();
  });
});

describe("repoAuthzLayer path bounds", () => {
  it("answers 404 for an oversized repo id without asking GitHub", async () => {
    const app = await buildGateApp();

    const res = await app.request("/99999999999999999999/probe");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", code: "not-found" });
    expect(countRepositoryReads()).toBe(0);
  });

  it("answers 404 for an oversized pull number on the operator rung", async () => {
    const app = await buildGateApp({ operatorToken: "operator-pat" });
    denyViewer(8888n, "other/private");

    const res = await app.request("/8888/pulls/2147483648/probe");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", code: "not-found" });
    expect(countRepositoryReads()).toBe(1);
  });
});

describe("repoAuthzLayer repo access", () => {
  it("sets a reviewer-footed access on the reviewer's own token", async () => {
    const app = await buildGateApp();
    arrangeRepo(REPO_IN_INSTALLATION, "acme/inside");

    const res = await app.request(`/${REPO_IN_INSTALLATION}/access`);

    expect(await res.json()).toEqual({
      footing: AccessFootings.REVIEWER,
      prNumber: null,
      repoFullName: "acme/inside",
      viewerCanPush: false,
      installation: "installation",
    });
  });

  it("sets an operator-footed access pinned to the granted PR", async () => {
    const app = await buildGateApp({ operatorToken: "operator-pat" });
    await createTenantRepository(harness.handle, {
      ownerUserId: brand(42n, isReviewerId),
    }).pullRequests.upsert({
      repoId: brand(8890n, isRepoId),
      prNumber: 4,
      repoSlug: "other/pinned",
      state: PrStates.OPEN,
    });
    denyViewer(8890n, "other/pinned");

    const first = await app.request("/8890/pulls/4/access");
    const second = await app.request("/8890/pulls/4/access");

    const expected = {
      footing: AccessFootings.OPERATOR,
      prNumber: 4,
      repoFullName: "other/pinned",
      viewerCanPush: false,
      installation: "owner",
    };
    expect(await first.json()).toEqual(expected);
    expect(await second.json()).toEqual(expected);
    expect(countRepositoryReads()).toBe(2);
  });
});
