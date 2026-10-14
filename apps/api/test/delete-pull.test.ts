// DELETE /api/repos/:repoId/pulls/:prNumber, the gated delete of one pull
// request's briefs. Full wire over PGlite; the gate and the route's fresh
// repository read reach the `github/testing` fake. The owner world
// is a 404 before any call past the gate; the installation world re-reads
// the repository fresh and needs admin from THAT answer, never the walk's.
import { FakeFailures, makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { PrStates, AccessLevels } from "types";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
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
  buildOperatorToken,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  OPERATOR_GATE_CALLS,
  arrangeFakeGate,
  listCallsPastGate,
} from "./reviewer-github";
import { seedSignIn, seedApiToken } from "./sign-in";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const FALLBACK_PAT = "ghp_OPERATOR_PAT";
const OTHER_INSTALLATION_ID = 777;
const OTHER_REVIEWER_ID = 999;

const TENANT: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};
const OTHER_TENANT: ScopeContext = {
  installationId: brandInstallationId(BigInt(OTHER_INSTALLATION_ID)),
};
const OTHER_OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(OTHER_REVIEWER_ID)),
};

const DELETE_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`;

function arrangeFreshRead(fake: FakeGitHub, admin: boolean): void {
  fake.addRepository({
    repoId: brandRepoId(BigInt(REPO_ID)),
    fullName: REPO_SLUG,
    private: true,
    viewerCanPush: true,
    viewerIsAdmin: admin,
  });
}

async function seedBriefedPr(
  handle: AppDatabase,
  ctx: ScopeContext,
): Promise<void> {
  const pr = await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
  const brief = await createArtifactStore(handle, ctx).briefs.write({
    pullRequestId: pr.id,
    baseSha: "b".repeat(40),
    headSha: "h".repeat(40),
    headIndex: 1,
    commitCount: 1,
    provider: "p",
    model: "m",
    effort: "e",
    body: "{}",
  });
  if (!brief.ok) {
    throw new Error("brief seed failed");
  }
}

interface AuditRow {
  readonly installation_id: bigint | null;
  readonly source: string;
  readonly operation: string;
  readonly outcome: string;
  readonly actor_type: string;
  readonly actor_id: bigint | null;
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" || typeof value === "string") {
    return BigInt(value);
  }
  return null;
}

async function readAudits(harness: PgliteHarness): Promise<AuditRow[]> {
  const rows = await harness.raw(
    "select installation_id, source, operation, outcome, actor_type, actor_id from audit_log order by id",
  );
  return rows.map((row) => ({
    installation_id: readBigInt(row["installation_id"]),
    source: String(row["source"]),
    operation: String(row["operation"]),
    outcome: String(row["outcome"]),
    actor_type: String(row["actor_type"]),
    actor_id: readBigInt(row["actor_id"]),
  }));
}

async function readOwners(harness: PgliteHarness): Promise<string[]> {
  const rows = await harness.raw(
    "select owner_user_id from pull_request order by id",
  );
  return rows.map((row) => String(row["owner_user_id"]));
}

async function countRows(
  harness: PgliteHarness,
  table: string,
): Promise<number> {
  return (await harness.raw(`select id from ${table}`)).length;
}

describe("DELETE /api/repos/:repoId/pulls/:prNumber", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;

  function buildApp(fallbackToken?: string): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      operatorToken:
        fallbackToken === undefined
          ? undefined
          : buildOperatorToken(fallbackToken),
    });
  }

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = buildApp();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  async function del(
    cookie: string,
    path = DELETE_PATH,
    headers: Record<string, string> = SAME_ORIGIN_HEADERS,
    target: ApiApp = app,
  ): Promise<Response> {
    return target.request(path, {
      method: "DELETE",
      headers: { ...headers, Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("the owner world is a 404 with nothing erased, no call past the gate", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation: false });
    arrangeFreshRead(fake, true);
    await seedBriefedPr(harness.handle, OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake)).toEqual([]);
    expect(await countRows(harness, "pull_request")).toBe(1);
    expect(await readAudits(harness)).toContainEqual(
      expect.objectContaining({
        operation: "delete-pull",
        outcome: "denied",
        installation_id: null,
        source: "url",
      }),
    );
  });

  it("erases an installation row when the fresh read says admin", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFreshRead(fake, true);
    await seedBriefedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(200);
    const pastGate = listCallsPastGate(fake).map((call) => call.operation);
    expect(pastGate).toEqual(["fetchRepositoryById"]);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "brief")).toBe(0);
    expect(await readAudits(harness)).toContainEqual({
      installation_id: BigInt(INSTALLATION_ID),
      source: "installation",
      operation: "delete",
      outcome: "ok",
      actor_type: "reviewer",
      actor_id: BigInt(REVIEWER_ID),
    });
  });

  it("refuses a non-admin with repo-admin-only and erases nothing", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, admin: false });
    arrangeFreshRead(fake, false);
    await seedBriefedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "repo-admin-only",
    });
    expect(await countRows(harness, "pull_request")).toBe(1);
    expect(await countRows(harness, "brief")).toBe(1);
    expect(await readAudits(harness)).toContainEqual(
      expect.objectContaining({ operation: "delete-pull", outcome: "denied" }),
    );
  });

  it("the fresh read decides, never the walk's cached admin bit", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, admin: true });
    arrangeFreshRead(fake, false);
    await seedBriefedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(403);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("an admin delete takes the viewer's shadowed url row with it", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFreshRead(fake, true);
    await seedBriefedPr(harness.handle, TENANT);
    await seedBriefedPr(harness.handle, OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const lookups = spyPullRequestLookups(harness);

    const res = await del(cookie);

    expect(res.status).toBe(200);
    // The access step's row, then the shadowed url row in the owner scope.
    expect(lookups.count()).toBe(2);
    expect(await countRows(harness, "pull_request")).toBe(0);
    const purges = (await readAudits(harness)).filter(
      (row) => row.operation === "delete",
    );
    expect(purges.map((row) => row.source).toSorted()).toEqual([
      "installation",
      "url",
    ]);
  });

  it("an installation holding no row is a 404 that leaves the pasted row", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFreshRead(fake, true);
    await seedBriefedPr(harness.handle, OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("the owner world's 404 leaves another reviewer's url row alone", async () => {
    arrangeFakeGate(fake, {
      repoId: REPO_ID,
      inInstallation: false,
      admin: false,
    });
    arrangeFreshRead(fake, false);
    await seedBriefedPr(harness.handle, OTHER_OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await readOwners(harness)).toEqual([String(OTHER_REVIEWER_ID)]);
  });

  it("another reviewer's url row survives an admin's installation delete", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFreshRead(fake, true);
    await seedBriefedPr(harness.handle, TENANT);
    await seedBriefedPr(harness.handle, OTHER_OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(200);
    expect(await readOwners(harness)).toEqual([String(OTHER_REVIEWER_ID)]);
  });

  it("a row in an installation the viewer cannot reach survives", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation: false });
    arrangeFreshRead(fake, true);
    await seedBriefedPr(harness.handle, OTHER_TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("the operator-PAT rung is a 404 here, the pasted row is the inbox's", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 404 });
    arrangeFreshRead(fake, true);
    await seedBriefedPr(harness.handle, TENANT);
    await seedBriefedPr(harness.handle, OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(
      cookie,
      DELETE_PATH,
      SAME_ORIGIN_HEADERS,
      buildApp(FALLBACK_PAT),
    );

    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake, OPERATOR_GATE_CALLS)).toEqual([]);
    expect(await countRows(harness, "pull_request")).toBe(2);
  });

  it("a fresh read GitHub refuses is a 404 with nothing erased", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, admin: false });
    await seedBriefedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp);
    expect((await del(cookie)).status).toBe(403);
    // The gate now passes from its cache, so only the fresh read is refused.
    fake.failOn("fetchRepositoryById", FakeFailures.NOT_FOUND);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await countRows(harness, "pull_request")).toBe(1);
    expect(await countRows(harness, "brief")).toBe(1);
  });

  it("an unknown pull request in the resolved world is a 404", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFreshRead(fake, true);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
  });

  it("a Bearer principal is refused as human-only before any fresh read", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFreshRead(fake, true);
    await seedBriefedPr(harness.handle, TENANT);
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      AccessLevels.EXTERNAL_WRITE,
    );

    const res = await app.request(DELETE_PATH, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${bearer}` },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("human-only");
    expect(listCallsPastGate(fake)).toEqual([]);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("a cross-origin cookie request is forbidden", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFreshRead(fake, true);
    await seedBriefedPr(harness.handle, TENANT);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie, DELETE_PATH, {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example.test",
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("forbidden");
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("the inbox path erases the same own row with no call past the session", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation: false });
    await seedBriefedPr(harness.handle, OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await del(cookie, `/api/inbox/${REPO_ID}/${PR_NUMBER}`);

    expect(res.status).toBe(200);
    expect(fake.calls).toEqual([]);
    expect(await countRows(harness, "pull_request")).toBe(0);
  });
});
