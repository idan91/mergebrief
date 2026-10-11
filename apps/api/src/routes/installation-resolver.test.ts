import { randomBytes } from "node:crypto";
import type * as githubModule from "github";
import {
  GitHubApiErrorCodes,
  listInstallationRepositoriesForUser,
  type InstallationRepository,
} from "github";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isInstallationId,
  isRepoId,
  isReviewerId,
  WriteClassifications,
  type InstallationId,
  type RepoId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTestUserOctokit } from "../../test/fixtures";
import type { AccessibleInstallationsResolver } from "./auth/accessible-installations";
import {
  AuthChannels,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "./auth/session/types";
import { AUTHZ_CACHE_TTL_MS } from "../access/consts";
import { createInstallationResolver } from "./installation-resolver";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  listInstallationRepositoriesForUser: vi.fn(),
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

const ACME_ID = brand(10n, isInstallationId);
const OCTO_ID = brand(20n, isInstallationId);
const HOOLI_ID = brand(30n, isInstallationId);
const INITECH_ID = brand(40n, isInstallationId);
const ACME_REPO = brand(101n, isRepoId);
const OCTO_REPO = brand(201n, isRepoId);
const OUTSIDE_REPO = brand(301n, isRepoId);

const ACME_ONE: InstallationRepository = {
  fullName: "acme/one",
  viewerIsAdmin: true,
};
const OCTO_TWO: InstallationRepository = {
  fullName: "octo/two",
  viewerIsAdmin: false,
};
const REPOS_BY_INSTALLATION: ReadonlyMap<
  InstallationId,
  Map<RepoId, InstallationRepository>
> = new Map([
  [ACME_ID, new Map([[ACME_REPO, ACME_ONE]])],
  [OCTO_ID, new Map([[OCTO_REPO, OCTO_TWO]])],
]);

let harness: PgliteHarness;
beforeAll(async () => {
  harness = await createPgliteHarness();
});
afterAll(async () => {
  await harness.close();
});

async function stubPrincipal(): Promise<ViewerPrincipal> {
  const sealed = await encryptToken(keyProvider, KEY_REF, "ghu_TOKEN");
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  return {
    id: 1n,
    sessionTokenHash: `hash-resolver-${randomBytes(4).toString("hex")}`,
    reviewerId: brand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId: brand(7n, isGrantRowId),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: sealed.value,
    keyRef: KEY_REF,
    scope: WriteClassifications.EXTERNAL_WRITE,
    channel: AuthChannels.COOKIE,
  };
}

function stubDeps(): AuthRouteDeps {
  return {
    handle: harness.handle,
    auth: {
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      keyProvider,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: "https://example.test",
      createUserOctokit: createTestUserOctokit,
    },
  };
}

function stubReachable(
  ids: readonly InstallationId[],
  expiresIn = AUTHZ_CACHE_TTL_MS,
): AccessibleInstallationsResolver {
  return {
    resolve: vi.fn<AccessibleInstallationsResolver["resolve"]>(
      async (session) => ({
        ok: true,
        value: {
          installations: ids.map((installationId) => ({
            installationId,
            accountLogin: `org-${String(installationId)}`,
          })),
          session,
          expiresAt: Date.now() + expiresIn,
        },
      }),
    ),
  };
}

function answerWalks(): void {
  vi.mocked(listInstallationRepositoriesForUser).mockImplementation(
    async (_octokit, installationId) => ({
      ok: true,
      value: REPOS_BY_INSTALLATION.get(installationId) ?? new Map(),
    }),
  );
}

beforeEach(() => {
  vi.mocked(listInstallationRepositoriesForUser).mockReset();
});

describe("the installation resolver", () => {
  it("names the installation a repo belongs to across every reachable one", async () => {
    answerWalks();
    const resolver = createInstallationResolver(
      stubDeps(),
      stubReachable([ACME_ID, OCTO_ID]),
    );
    const principal = await stubPrincipal();

    const acme = await resolver.resolveInstallationForRepo(
      principal,
      ACME_REPO,
      log,
    );
    const octo = await resolver.resolveInstallationForRepo(
      principal,
      OCTO_REPO,
      log,
    );

    expect(acme.ok && acme.value.world).toEqual({
      kind: "installation",
      installationId: ACME_ID,
    });
    expect(octo.ok && octo.value.world).toEqual({
      kind: "installation",
      installationId: OCTO_ID,
    });
  });

  it("carries the admin bit GitHub gave per repository into the allowed set", async () => {
    answerWalks();
    const resolver = createInstallationResolver(
      stubDeps(),
      stubReachable([ACME_ID, OCTO_ID]),
    );

    const resolved = await resolver.listAllowedRepos(
      await stubPrincipal(),
      log,
    );

    expect(resolved.ok && resolved.value.allowed.get(ACME_REPO)).toEqual({
      installationId: ACME_ID,
      fullName: "acme/one",
      viewerIsAdmin: true,
    });
    expect(resolved.ok && resolved.value.allowed.get(OCTO_REPO)).toEqual({
      installationId: OCTO_ID,
      fullName: "octo/two",
      viewerIsAdmin: false,
    });
  });

  it("drops a repo outside every reachable installation to the owner world", async () => {
    answerWalks();
    const resolver = createInstallationResolver(
      stubDeps(),
      stubReachable([ACME_ID]),
    );

    const outside = await resolver.resolveInstallationForRepo(
      await stubPrincipal(),
      OCTO_REPO,
      log,
    );

    expect(outside.ok && outside.value.world).toEqual({ kind: "owner" });
  });

  it("walks every installation in parallel once and caches the union", async () => {
    answerWalks();
    const resolver = createInstallationResolver(
      stubDeps(),
      stubReachable([ACME_ID, OCTO_ID]),
    );
    const principal = await stubPrincipal();

    await Promise.all([
      resolver.listAllowedRepos(principal, log),
      resolver.resolveInstallationForRepo(principal, OUTSIDE_REPO, log),
    ]);
    const again = await resolver.listAllowedRepos(principal, log);

    expect(listInstallationRepositoriesForUser).toHaveBeenCalledTimes(2);
    expect(again.ok && [...again.value.allowed.keys()]).toEqual([
      ACME_REPO,
      OCTO_REPO,
    ]);
  });

  it("fails the whole set when one installation's walk fails", async () => {
    vi.mocked(listInstallationRepositoriesForUser).mockImplementation(
      async (_octokit, installationId) =>
        installationId === ACME_ID
          ? { ok: true, value: new Map([[ACME_REPO, ACME_ONE]]) }
          : {
              ok: false,
              error: {
                code: GitHubApiErrorCodes.REQUEST_FAILED,
                status: 502,
                message: "down",
              },
            },
    );
    const resolver = createInstallationResolver(
      stubDeps(),
      stubReachable([ACME_ID, OCTO_ID]),
    );
    const principal = await stubPrincipal();

    const failed = await resolver.listAllowedRepos(principal, log);
    const retried = await resolver.listAllowedRepos(principal, log);

    expect(failed.ok).toBe(false);
    expect(!failed.ok && failed.error.status).toBe(502);
    expect(listInstallationRepositoriesForUser).toHaveBeenCalledTimes(4);
    expect(retried.ok).toBe(false);
  });

  it("a denied installation is left out and the others still count", async () => {
    vi.mocked(listInstallationRepositoriesForUser).mockImplementation(
      async (_octokit, installationId) =>
        installationId === OCTO_ID
          ? {
              ok: false,
              error: {
                code: GitHubApiErrorCodes.FORBIDDEN,
                status: 403,
                message: "saml",
              },
            }
          : { ok: true, value: new Map([[ACME_REPO, ACME_ONE]]) },
    );
    const resolver = createInstallationResolver(
      stubDeps(),
      stubReachable([ACME_ID, OCTO_ID, HOOLI_ID]),
    );
    const principal = await stubPrincipal();

    const allowed = await resolver.listAllowedRepos(principal, log);

    expect(allowed.ok && [...allowed.value.allowed.keys()]).toEqual([
      ACME_REPO,
    ]);
    expect(listInstallationRepositoriesForUser).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledWith(
      "installation walk denied, left out of the reachable set",
      expect.objectContaining({ installationId: String(OCTO_ID) }),
    );
  });

  it("never starts the walks after the batch with the failed one", async () => {
    vi.mocked(listInstallationRepositoriesForUser).mockImplementation(
      async (_octokit, installationId) =>
        installationId === OCTO_ID
          ? {
              ok: false,
              error: {
                code: GitHubApiErrorCodes.REQUEST_FAILED,
                status: 502,
                message: "down",
              },
            }
          : { ok: true, value: new Map() },
    );
    const resolver = createInstallationResolver(
      stubDeps(),
      stubReachable([ACME_ID, OCTO_ID, HOOLI_ID, INITECH_ID]),
    );
    const principal = await stubPrincipal();

    const failed = await resolver.listAllowedRepos(principal, log);

    expect(failed.ok).toBe(false);
    const walked = vi
      .mocked(listInstallationRepositoriesForUser)
      .mock.calls.map(([, installationId]) => installationId);
    expect(walked).toEqual([ACME_ID, OCTO_ID, HOOLI_ID]);
  });

  it("makes no repository walk when no installation is reachable", async () => {
    answerWalks();
    const resolver = createInstallationResolver(stubDeps(), stubReachable([]));

    const resolved = await resolver.listAllowedRepos(
      await stubPrincipal(),
      log,
    );

    expect(resolved.ok && resolved.value.allowed.size).toBe(0);
    expect(listInstallationRepositoriesForUser).not.toHaveBeenCalled();
  });

  it("expires the union no later than the reachable set it came from", async () => {
    vi.useFakeTimers();
    answerWalks();
    const SOON_MS = 5_000;
    const resolver = createInstallationResolver(
      stubDeps(),
      stubReachable([ACME_ID], SOON_MS),
    );
    const principal = await stubPrincipal();

    await resolver.listAllowedRepos(principal, log);
    vi.advanceTimersByTime(SOON_MS + 1);
    await resolver.listAllowedRepos(principal, log);

    expect(listInstallationRepositoriesForUser).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("answers 401 when the reachable set finds the auth dead", async () => {
    const dead: AccessibleInstallationsResolver = {
      resolve: async () => ({ ok: false, error: { kind: "auth-dead" } }),
    };
    const resolver = createInstallationResolver(stubDeps(), dead);

    const resolved = await resolver.resolveInstallationForRepo(
      await stubPrincipal(),
      ACME_REPO,
      log,
    );

    expect(!resolved.ok && resolved.error.status).toBe(401);
  });
});
