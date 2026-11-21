import { randomBytes } from "node:crypto";
import {
  GitHubApiErrorCodes,
  type GitHubApiError,
  type InstallationRepository,
} from "github";
import { FakeFailures, makeFakeGitHub, type FakeGitHub } from "github/testing";
import type { Logger } from "logging";
import {
  encryptToken,
  GrantSealedColumns,
  isGrantRowId,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type InstallationId,
} from "persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEY_REF, createKeyProvider } from "../../test/fixtures";
import { buildFakeAuthDeps } from "../../test/reviewer-github";
import {
  bindRequestGitHub,
  type RequestGitHub,
} from "../access/reviewer-binding";
import type { AccessibleInstallationsResolver } from "./auth/accessible-installations";
import { AuthChannels, type ViewerPrincipal } from "./auth/session/types";
import { AUTHZ_CACHE_TTL_MS } from "../access/consts";
import { createInstallationResolver } from "./installation-resolver";
import { AccessLevels } from "types/access-levels";
import { registerSharedPglite } from "../../test/shared-pglite";
import { InternalError } from "../shared-errors/api-error";

const keyProvider = createKeyProvider();

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
  viewerCanPush: true,
};
const OCTO_TWO: InstallationRepository = {
  fullName: "octo/two",
  viewerIsAdmin: false,
  viewerCanPush: false,
};

const UPSTREAM_DOWN: GitHubApiError = {
  code: GitHubApiErrorCodes.REQUEST_FAILED,
  status: 502,
  message: "down",
};

const harness = registerSharedPglite();
let fake: FakeGitHub;

async function stubPrincipal(): Promise<ViewerPrincipal> {
  const grantId = brand(7n, isGrantRowId);
  const sealed = await encryptToken(keyProvider, KEY_REF, "ghu_TOKEN", {
    grantId,
    column: GrantSealedColumns.ACCESS_TOKEN,
  });
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  return {
    id: 1n,
    sessionTokenHash: `hash-resolver-${randomBytes(4).toString("hex")}`,
    reviewerId: brand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: sealed.value,
    keyRef: KEY_REF,
    scope: AccessLevels.EXTERNAL_WRITE,
    channel: AuthChannels.COOKIE,
  };
}

/** The request's credential and the fake's binding over it. */
async function bindRequest(
  principal?: ViewerPrincipal,
): Promise<RequestGitHub> {
  const deps = {
    handle: harness.handle,
    auth: buildFakeAuthDeps(keyProvider, fake),
  };
  return bindRequestGitHub(deps, principal ?? (await stubPrincipal()), log);
}

/** One installation's listing answers `failure`; the others reach the fake. */
function failWalkOf(
  request: RequestGitHub,
  installationId: InstallationId,
  failure: GitHubApiError,
): RequestGitHub {
  const { github } = request;
  return {
    ...request,
    github: {
      ...github,
      async listInstallationRepositories(id) {
        if (id === installationId) {
          return { ok: false, error: failure };
        }
        return github.listInstallationRepositories(id);
      },
    },
  };
}

function stubReachable(
  ids: readonly InstallationId[],
  expiresIn = AUTHZ_CACHE_TTL_MS,
): AccessibleInstallationsResolver {
  return {
    resolve: vi.fn<AccessibleInstallationsResolver["resolve"]>(
      async (request) => ({
        ok: true,
        value: {
          installations: ids.map((installationId) => ({
            installationId,
            accountLogin: `org-${String(installationId)}`,
          })),
          session: request.credential.session(),
          expiresAt: Date.now() + expiresIn,
        },
      }),
    ),
  };
}

function arrangeInstallations(): void {
  fake.addInstallation(
    { installationId: ACME_ID, accountLogin: "acme" },
    new Map([[ACME_REPO, ACME_ONE]]),
  );
  fake.addInstallation(
    { installationId: OCTO_ID, accountLogin: "octo" },
    new Map([[OCTO_REPO, OCTO_TWO]]),
  );
}

function listWalkedInstallations(): unknown[] {
  return fake
    .listCalls("listInstallationRepositories")
    .map((call) => (call.input as { installationId: unknown }).installationId);
}

beforeEach(() => {
  fake = makeFakeGitHub();
});

describe("the installation resolver", () => {
  it("names the installation a repo belongs to across every reachable one", async () => {
    arrangeInstallations();
    const resolver = createInstallationResolver(
      stubReachable([ACME_ID, OCTO_ID]),
    );
    const request = await bindRequest();

    const acme = await resolver.resolveInstallationForRepo(
      request,
      ACME_REPO,
      log,
    );
    const octo = await resolver.resolveInstallationForRepo(
      request,
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
    arrangeInstallations();
    const resolver = createInstallationResolver(
      stubReachable([ACME_ID, OCTO_ID]),
    );

    const resolved = await resolver.listAllowedRepos(await bindRequest(), log);

    expect(resolved.ok && resolved.value.allowed.get(ACME_REPO)).toEqual({
      installationId: ACME_ID,
      fullName: "acme/one",
      viewerIsAdmin: true,
      viewerCanPush: true,
    });
    expect(resolved.ok && resolved.value.allowed.get(OCTO_REPO)).toEqual({
      installationId: OCTO_ID,
      fullName: "octo/two",
      viewerIsAdmin: false,
      viewerCanPush: false,
    });
  });

  it("drops a repo outside every reachable installation to the owner world", async () => {
    arrangeInstallations();
    const resolver = createInstallationResolver(stubReachable([ACME_ID]));

    const outside = await resolver.resolveInstallationForRepo(
      await bindRequest(),
      OCTO_REPO,
      log,
    );

    expect(outside.ok && outside.value.world).toEqual({ kind: "owner" });
  });

  it("walks every installation in parallel once and caches the union", async () => {
    arrangeInstallations();
    const resolver = createInstallationResolver(
      stubReachable([ACME_ID, OCTO_ID]),
    );
    const request = await bindRequest();

    await Promise.all([
      resolver.listAllowedRepos(request, log),
      resolver.resolveInstallationForRepo(request, OUTSIDE_REPO, log),
    ]);
    const again = await resolver.listAllowedRepos(request, log);

    expect(listWalkedInstallations()).toEqual([ACME_ID, OCTO_ID]);
    expect(again.ok && [...again.value.allowed.keys()]).toEqual([
      ACME_REPO,
      OCTO_REPO,
    ]);
  });

  it("fails the whole set when one installation's walk fails", async () => {
    arrangeInstallations();
    const resolver = createInstallationResolver(
      stubReachable([ACME_ID, OCTO_ID]),
    );
    const request = failWalkOf(await bindRequest(), OCTO_ID, UPSTREAM_DOWN);

    const failed = await resolver.listAllowedRepos(request, log);
    const retried = await resolver.listAllowedRepos(request, log);

    expect(!failed.ok && failed.error.status).toBe(502);
    expect(retried.ok).toBe(false);
    expect(listWalkedInstallations()).toEqual([ACME_ID, ACME_ID]);
  });

  it("a denied installation is left out and the others still count", async () => {
    arrangeInstallations();
    const resolver = createInstallationResolver(
      stubReachable([ACME_ID, OCTO_ID, HOOLI_ID]),
    );
    const denied: GitHubApiError = {
      code: GitHubApiErrorCodes.FORBIDDEN,
      status: 403,
      message: "saml",
    };
    const request = failWalkOf(await bindRequest(), OCTO_ID, denied);

    const allowed = await resolver.listAllowedRepos(request, log);

    expect(allowed.ok && [...allowed.value.allowed.keys()]).toEqual([
      ACME_REPO,
    ]);
    expect(listWalkedInstallations()).toEqual([ACME_ID, HOOLI_ID]);
    expect(log.warn).toHaveBeenCalledWith(
      "installation walk denied, left out of the reachable set",
      expect.objectContaining({ installationId: String(OCTO_ID) }),
    );
  });

  it("never starts the walks after the batch with the failed one", async () => {
    arrangeInstallations();
    const resolver = createInstallationResolver(
      stubReachable([ACME_ID, OCTO_ID, HOOLI_ID, INITECH_ID]),
    );
    fake.failOn("listInstallationRepositories", FakeFailures.SERVER_ERROR);

    const failed = await resolver.listAllowedRepos(await bindRequest(), log);

    expect(failed.ok).toBe(false);
    expect(listWalkedInstallations()).toEqual([ACME_ID, OCTO_ID, HOOLI_ID]);
  });

  it("answers 401 on a walk whose token GitHub keeps refusing", async () => {
    arrangeInstallations();
    const resolver = createInstallationResolver(stubReachable([ACME_ID]));
    fake.rejectToken("ghu_TOKEN");

    const failed = await resolver.listAllowedRepos(await bindRequest(), log);

    expect(!failed.ok && failed.error.status).toBe(401);
  });

  it("throws a 500 on a walk whose stored token will not decrypt", async () => {
    arrangeInstallations();
    const resolver = createInstallationResolver(stubReachable([ACME_ID]));
    const principal = await stubPrincipal();
    const unreadable = { ...principal, ghTokenCiphertext: "sealed" };
    const bound = await bindRequest(unreadable);

    await expect(resolver.listAllowedRepos(bound, log)).rejects.toBeInstanceOf(
      InternalError,
    );
    expect(fake.calls).toEqual([]);
  });

  it("makes no repository walk when no installation is reachable", async () => {
    arrangeInstallations();
    const resolver = createInstallationResolver(stubReachable([]));

    const resolved = await resolver.listAllowedRepos(await bindRequest(), log);

    expect(resolved.ok && resolved.value.allowed.size).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("expires the union no later than the reachable set it came from", async () => {
    vi.useFakeTimers();
    arrangeInstallations();
    const SOON_MS = 5_000;
    const resolver = createInstallationResolver(
      stubReachable([ACME_ID], SOON_MS),
    );
    const request = await bindRequest();

    await resolver.listAllowedRepos(request, log);
    vi.advanceTimersByTime(SOON_MS + 1);
    await resolver.listAllowedRepos(request, log);

    expect(listWalkedInstallations()).toEqual([ACME_ID, ACME_ID]);
    vi.useRealTimers();
  });

  it("answers 401 when the reachable set finds the auth dead", async () => {
    const dead: AccessibleInstallationsResolver = {
      resolve: async () => ({ ok: false, error: { kind: "auth-dead" } }),
    };
    const resolver = createInstallationResolver(dead);

    const resolved = await resolver.resolveInstallationForRepo(
      await bindRequest(),
      ACME_REPO,
      log,
    );

    expect(!resolved.ok && resolved.error.status).toBe(401);
  });
});
