// `GET /api/repos`, the CLI's owner/name to repoId resolution. The contract:
// the installation and user-access intersection from installation-resolver's
// allowed-set machinery and its shared 60s cache, stringified repoIds, flat, unpaginated,
// no-store, and a GitHub failure answering 401 or 502, never a DB-only fallback.
import type { InstallationRepository } from "github";
import { FakeFailures, makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createTenantRepository,
  isInstallationId,
  isRepoId,
  WriteClassifications,
  type KeyProvider,
  type RepoId,
  type TenantContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import { INSTALLATION_ID, SECRET, createKeyProvider } from "./fixtures";
import { seedApiToken } from "./session/fixtures";
import {
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  stubNoNetwork,
} from "./reviewer-github";
import { seedSignIn } from "./sign-in";

const REPO_A = 42001;
const REPO_B = 42002;

function brand<T extends bigint>(
  guard: (v: bigint) => v is T,
  value: number,
): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) {
    throw new Error("bad branded id");
  }
  return asBigInt;
}

const CTX: TenantContext = {
  installationId: brand(isInstallationId, INSTALLATION_ID),
};

/** The suites' installation on `fake`, holding `repos` for the viewer. */
function arrangeInstallation(
  fake: FakeGitHub,
  repos: ReadonlyArray<{ id: number; fullName: string }>,
): void {
  const listing = new Map<RepoId, InstallationRepository>(
    repos.map((repo) => [
      brand(isRepoId, repo.id),
      { fullName: repo.fullName, viewerIsAdmin: false },
    ]),
  );
  fake.addInstallation(
    { installationId: CTX.installationId, accountLogin: "octo" },
    listing,
  );
}

function countWalks(fake: FakeGitHub): number {
  return fake.listCalls("listInstallationRepositories").length;
}

describe("GET /api/repos", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;
  let fake: FakeGitHub;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    stubNoNetwork();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  async function getRepos(headers: Record<string, string>): Promise<Response> {
    return app.request("/api/repos", { headers });
  }

  it("returns the flat intersection with stringified ids, no-store", async () => {
    arrangeInstallation(fake, [
      { id: REPO_B, fullName: "octo/world" },
      { id: REPO_A, fullName: "octo/hello" },
    ]);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await getRepos({
      Cookie: `__Host-mergebrief_session=${cookie}`,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      repos: Array<{ repoId: string; fullName: string }>;
    };
    // Deterministic order (fullName ascending); ids are STRINGS.
    expect(body.repos).toEqual([
      { repoId: String(REPO_A), fullName: "octo/hello" },
      { repoId: String(REPO_B), fullName: "octo/world" },
    ]);
  });

  it("authenticates via Bearer under the /api namespace", async () => {
    arrangeInstallation(fake, [{ id: REPO_A, fullName: "octo/hello" }]);
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.EXTERNAL_WRITE,
    );
    const res = await getRepos({ Authorization: `Bearer ${bearer}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repos: Array<{ repoId: string }> };
    expect(body.repos).toHaveLength(1);
  });

  it("shares the allowed-set cache with pulls, one fetch inside the TTL", async () => {
    arrangeInstallation(fake, [{ id: REPO_A, fullName: "octo/hello" }]);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const headers = { Cookie: `__Host-mergebrief_session=${cookie}` };
    expect((await app.request("/api/inbox", { headers })).status).toBe(200);
    expect((await getRepos(headers)).status).toBe(200);
    expect((await getRepos(headers)).status).toBe(200);
    expect(countWalks(fake)).toBe(1);
  });

  it("fails closed with 502 on GitHub errors, never a DB-derived listing", async () => {
    arrangeInstallation(fake, [{ id: REPO_A, fullName: "octo/hello" }]);
    fake.failOn("listInstallationRepositories", FakeFailures.SERVER_ERROR);
    // Rows in the DB that a leaky fallback would surface.
    await createTenantRepository(harness.handle, CTX).pullRequests.upsert({
      repoId: brand(isRepoId, REPO_A),
      prNumber: 7,
      repoSlug: "octo/hello",
      state: PrStates.OPEN,
    });
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await getRepos({
      Cookie: `__Host-mergebrief_session=${cookie}`,
    });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain('"code":"github-unavailable"');
    expect(text).not.toContain("octo/hello");
    expect(text).not.toContain(String(REPO_A));
  });

  it("401s an unauthenticated request without touching GitHub", async () => {
    const res = await getRepos({});
    expect(res.status).toBe(401);
    expect(fake.calls).toEqual([]);
  });
});
