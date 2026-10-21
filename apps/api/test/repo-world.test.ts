// The per-repo gate names the world a repo belongs to. A reader signed in
// through the App can see repos outside their installation, public ones
// above all, and reads their url-box briefs there with their own token. The
// gate passes those requests in the OWNER world, so nothing downstream can
// take the installation's rows for a repo the installation never held.
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { AUTHZ_CACHE_TTL_MS } from "../src/access/consts";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  createKeyProvider,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import {
  ROTATED_ACCESS_TOKEN,
  UNUSED_INSTALLATION_DEPS,
  arrangeFakeGate,
  buildFakeAuthDeps,
  listFakeCallTokens,
  stubTokenRefresh,
  type GateGitHub,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

const REPO_ID = 424242;

const TENANT_CTX = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER_CTX = { ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)) };

/** The viewer's token sees the repo; the installation holds it or not. */
function arrangeGate(fake: FakeGitHub, inInstallation: boolean): GateGitHub {
  return arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation });
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

const harness = registerSharedPglite();

describe("the per-repo gate's repo world", () => {
  let kp: KeyProvider;
  let fake: FakeGitHub;

  beforeEach(() => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
  });

  function buildApp(): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
    });
  }

  async function read(app: ApiApp, cookie: string): Promise<Response> {
    return app.request(`/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("opens a url-box brief on a repo outside the installation", async () => {
    arrangeGate(fake, false);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPullRequest(harness.handle, OWNER_CTX, "the reader's paste");

    const res = await read(buildApp(), cookie);
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      title: "the reader's paste",
      appInstalled: false,
    });
    expect(new Set(listFakeCallTokens(fake))).toEqual(new Set([ACCESS_TOKEN]));
  });

  it("asks GitHub once when a cold page fans out concurrent reads", async () => {
    arrangeGate(fake, true);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPullRequest(harness.handle, TENANT_CTX, "the installation's row");
    const app = buildApp();

    const responses = await Promise.all([
      read(app, cookie),
      read(app, cookie),
      read(app, cookie),
    ]);

    expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(fake.listCalls("listInstallationRepositories")).toHaveLength(1);
  });

  it("never serves the installation's row for a repo it does not hold", async () => {
    arrangeGate(fake, false);
    const { cookie } = await seedSignIn(harness.handle, kp);
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
    arrangeGate(fake, true);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPullRequest(harness.handle, TENANT_CTX, "the installation's row");
    await seedPullRequest(harness.handle, OWNER_CTX, "the reader's paste");

    const res = await read(buildApp(), cookie);
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ title: "the installation's row" });
  });

  it("renews an expired token once across gate, walk and route", async () => {
    const gate = arrangeGate(fake, false);
    fake.rejectToken(ACCESS_TOKEN);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPullRequest(harness.handle, OWNER_CTX, "the reader's paste");

    const res = await read(buildApp(), cookie);

    expect(res.status).toBe(200);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(fake.calls.map((call) => call.operation)).toEqual([
      "fetchRepositoryById",
      "fetchRepositoryById",
      "listUserInstallations",
      "listInstallationRepositories",
      "readPullRequestFacts",
    ]);
    const [expired, ...renewed] = listFakeCallTokens(fake);
    expect(expired).toBe(ACCESS_TOKEN);
    expect(new Set(renewed)).toEqual(new Set([ROTATED_ACCESS_TOKEN]));
  });

  it("audits a write on an outside repo under the owner world", async () => {
    arrangeGate(fake, false);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPullRequest(harness.handle, OWNER_CTX, "the reader's paste");

    const res = await buildApp().request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session/chunks/c1/read?base=${"b".repeat(40)}&head=${"a".repeat(40)}`,
      {
        method: "POST",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: `__Host-mergebrief_session=${cookie}`,
        },
      },
    );

    // No brief at that span in the reader's world, so the write finds nothing.
    expect(res.status).toBe(404);
    const rows = await harness.raw(
      "select operation, installation_id, source from audit_log order by id",
    );
    expect(rows).toEqual([
      {
        operation: "mark-chunk-read",
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

/** Two installations, one repo each, of which `reachable` the viewer reaches. */
function arrangeTwoInstallations(
  fake: FakeGitHub,
  reachable: readonly number[],
): void {
  const repos = [
    { installationId: INSTALLATION_ID, repoId: REPO_ID, fullName: REPO_SLUG },
    {
      installationId: OTHER_INSTALLATION_ID,
      repoId: OTHER_REPO_ID,
      fullName: "other/repo",
    },
  ];
  for (const { installationId, repoId, fullName } of repos) {
    const brandedRepoId = brandRepoId(BigInt(repoId));
    fake.addRepository({
      repoId: brandedRepoId,
      fullName,
      private: false,
      viewerCanPush: true,
      viewerIsAdmin: false,
    });
    if (!reachable.includes(installationId)) {
      continue;
    }
    fake.addInstallation(
      {
        installationId: brandInstallationId(BigInt(installationId)),
        accountLogin: `org-${installationId}`,
      },
      new Map([[brandedRepoId, { fullName, viewerIsAdmin: false }]]),
    );
  }
  stubTokenRefresh();
}

describe("the per-repo gate across two installations", () => {
  let kp: KeyProvider;
  let fake: FakeGitHub;

  beforeEach(() => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildApp(): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: {
        ...buildFakeAuthDeps(kp, fake),
        // Read at call time, so a test can swap in GitHub after a change.
        bindReviewerGitHub: (credential, options) =>
          fake.bindReviewerGitHub(credential, options),
      },
      ...UNUSED_INSTALLATION_DEPS,
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
    arrangeTwoInstallations(fake, [INSTALLATION_ID, OTHER_INSTALLATION_ID]);
    const { cookie } = await seedSignIn(harness.handle, kp);
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
    arrangeTwoInstallations(fake, [INSTALLATION_ID]);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedBothRows();

    const res = await readOther(buildApp(), cookie);

    expect(res.status).toBe(404);
  });

  it("stores a write on the second installation's row under the second", async () => {
    arrangeTwoInstallations(fake, [INSTALLATION_ID, OTHER_INSTALLATION_ID]);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedBothRows();
    const otherRow = await createTenantRepository(
      harness.handle,
      OTHER_CTX,
    ).pullRequests.getByNumber(
      brandRepoId(BigInt(OTHER_REPO_ID)),
      OTHER_PR_NUMBER,
    );
    if (otherRow === undefined) {
      throw new Error("seed missing");
    }
    await createArtifactStore(harness.handle, OTHER_CTX).briefs.write({
      pullRequestId: otherRow.id,
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      headIndex: 1,
      commitCount: 1,
      provider: "anthropic",
      model: "claude",
      effort: "high",
      body: JSON.stringify({
        changeGroups: [],
        chunks: [{ id: "c1", file: "src/app.ts" }],
      }),
      carriedChunkIds: [],
      anchorState: "anchored",
      usedGroupIds: [],
    });

    const res = await buildApp().request(
      `/api/repos/${OTHER_REPO_ID}/pulls/${OTHER_PR_NUMBER}/session/chunks/c1/read?base=${"b".repeat(40)}&head=${"a".repeat(40)}`,
      {
        method: "POST",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: `__Host-mergebrief_session=${cookie}`,
        },
      },
    );

    expect(res.status).toBe(204);
    const sessions = await harness.raw(
      "select installation_id from review_session",
    );
    expect(sessions).toEqual([{ installation_id: OTHER_INSTALLATION_ID }]);
    const audit = await harness.raw(
      "select operation, installation_id, source from audit_log order by id",
    );
    expect(audit).toEqual([
      {
        operation: "mark-chunk-read",
        installation_id: OTHER_INSTALLATION_ID,
        source: "installation",
      },
    ]);
  });

  it("refuses a revoked installation once the window has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    arrangeTwoInstallations(fake, [INSTALLATION_ID, OTHER_INSTALLATION_ID]);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedBothRows();
    const app = buildApp();

    const granted = await readOther(app, cookie);
    fake = makeFakeGitHub();
    arrangeTwoInstallations(fake, [INSTALLATION_ID]);
    const insideWindow = await readOther(app, cookie);
    vi.advanceTimersByTime(AUTHZ_CACHE_TTL_MS + 1);
    const afterWindow = await readOther(app, cookie);

    expect(granted.status).toBe(200);
    expect(insideWindow.status).toBe(200);
    expect(afterWindow.status).toBe(404);
  });
});
