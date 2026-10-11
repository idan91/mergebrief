// POST /api/repos/:repoId/pulls/:prNumber/ready over the PGlite harness. The
// route's own GitHub calls reach the `github/testing` fake through the
// reviewer binding; the repo gate and the OAuth refresh still answer over
// `fetch`.
import {
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
  type FakePullRequest,
} from "github/testing";
import {
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { PrStates } from "types/pull-requests";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SAME_ORIGIN_HEADERS,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  buildOperatorToken,
  createKeyProvider,
} from "./fixtures";
import { testLogger } from "./logging";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  ROTATED_ACCESS_TOKEN,
  UNUSED_INSTALLATION_PORT,
  buildFakeAuthDeps,
  stubGateGitHub,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const OPERATOR_PAT = "ghp_OPERATOR_PAT";
const READY_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/ready`;

const TENANT: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};

function makeFakePullRequest(draft: boolean): FakePullRequest {
  return {
    info: {
      repoId: brandRepoId(BigInt(REPO_ID)),
      repoFullName: REPO_SLUG,
      headSha: "h".repeat(40),
      headRef: "feature",
      baseSha: "b".repeat(40),
      state: "open",
      draft,
      merged: false,
      title: "A pull request",
      body: "",
      htmlUrl: `https://github.com/${REPO_SLUG}/pull/${PR_NUMBER}`,
      commitCount: 1,
      authorLogin: "octocat",
      closedAt: null,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
  };
}

function arrangeRepository(fake: FakeGitHub, fullName = REPO_SLUG): void {
  const [owner = "", repo = ""] = fullName.split("/");
  fake.addRepository({
    repoId: brandRepoId(BigInt(REPO_ID)),
    fullName,
    private: true,
    viewerCanPush: true,
    viewerIsAdmin: false,
  });
  fake.addPullRequest(
    { owner, repo, prNumber: PR_NUMBER },
    makeFakePullRequest(true),
  );
}

async function seedDraftPr(
  handle: AppDatabase,
  scope: ScopeContext = TENANT,
): Promise<void> {
  await createTenantRepository(handle, scope).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    draft: true,
    state: PrStates.OPEN,
  });
}

async function readDraft(handle: AppDatabase): Promise<boolean | undefined> {
  const row = await createTenantRepository(
    handle,
    TENANT,
  ).pullRequests.getByNumber(brandRepoId(BigInt(REPO_ID)), PR_NUMBER);
  return row?.draft;
}

async function countReadyAudits(harness: PgliteHarness): Promise<number> {
  const rows = await harness.raw(
    "select id from audit_log where operation = 'mark-ready' and outcome = 'ok'",
  );
  return rows.length;
}

function listSentTokens(fake: FakeGitHub): string[] {
  return fake.calls.map((call) =>
    "token" in call.credential ? call.credential.token : "",
  );
}

describe("POST /api/repos/:repoId/pulls/:prNumber/ready", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;

  function buildApp(operatorToken?: string): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      github: UNUSED_INSTALLATION_PORT,
      operatorToken:
        operatorToken === undefined
          ? undefined
          : buildOperatorToken(operatorToken),
    });
  }

  async function markReady(
    cookie: string | undefined,
    target: ApiApp = app,
  ): Promise<Response> {
    const headers: Record<string, string> = { ...SAME_ORIGIN_HEADERS };
    if (cookie !== undefined) {
      headers["cookie"] = `__Host-mergebrief_session=${cookie}`;
    }
    return target.request(READY_PATH, { method: "POST", headers });
  }

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = buildApp();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  it("401s an absent session cookie without calling GitHub", async () => {
    const gate = stubGateGitHub({ repoId: REPO_ID });

    const res = await markReady(undefined);

    expect(res.status).toBe(401);
    expect(gate.repositoryReads()).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("collapses a gate denial to 404 with no mutation", async () => {
    stubGateGitHub({ repoId: REPO_ID, viewerStatus: 403 });
    arrangeRepository(fake);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(404);
    expect(fake.calls).toEqual([]);
    expect(await readDraft(harness.handle)).toBe(true);
  });

  it("collapses a denied fresh repo read to the uniform 404", async () => {
    stubGateGitHub({ repoId: REPO_ID });
    arrangeRepository(fake);
    fake.failOn("fetchRepositoryById", FakeFailures.FORBIDDEN);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", code: "not-found" });
    expect(fake.listCalls("markPullRequestReadyForReview")).toEqual([]);
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await countReadyAudits(harness)).toBe(0);
  });

  it("marks the PR under the fresh name, never the gate's cached slug", async () => {
    stubGateGitHub({ repoId: REPO_ID });
    arrangeRepository(fake, "octo/renamed");
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(200);
    expect(fake.listCalls("markPullRequestReadyForReview")).toEqual([
      expect.objectContaining({
        input: { owner: "octo", repo: "renamed", prNumber: PR_NUMBER },
      }),
    ]);
  });

  it("404s a PR with no row before any call past the gate", async () => {
    stubGateGitHub({ repoId: REPO_ID });
    arrangeRepository(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(404);
    expect(fake.calls).toEqual([]);
  });

  it("200s a fresh flip with the mirror, the audit and one row read", async () => {
    stubGateGitHub({ repoId: REPO_ID });
    arrangeRepository(fake);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const lookups = spyPullRequestLookups(harness);

    const res = await markReady(cookie);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ draft: false });
    expect(lookups.count()).toBe(1);
    expect(fake.listCalls("markPullRequestReadyForReview")).toHaveLength(1);
    expect(await readDraft(harness.handle)).toBe(false);
    expect(await countReadyAudits(harness)).toBe(1);
  });

  it("converges two POSTs to 200 with an audit row each", async () => {
    stubGateGitHub({ repoId: REPO_ID });
    arrangeRepository(fake);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const first = await markReady(cookie);
    const second = await markReady(cookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ draft: false });
    expect(await readDraft(harness.handle)).toBe(false);
    expect(await countReadyAudits(harness)).toBe(2);
  });

  it("502s an upstream failure and leaves the row a draft", async () => {
    stubGateGitHub({ repoId: REPO_ID });
    arrangeRepository(fake);
    fake.failOn("markPullRequestReadyForReview", FakeFailures.SERVER_ERROR);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await countReadyAudits(harness)).toBe(0);
  });

  it("answers a mutation-stage 403 as github-permission", async () => {
    stubGateGitHub({ repoId: REPO_ID });
    arrangeRepository(fake);
    fake.failOn("markPullRequestReadyForReview", FakeFailures.FORBIDDEN);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "github-permission",
      code: "github-permission",
    });
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await countReadyAudits(harness)).toBe(0);
  });

  it("renews once after a mid-request 401 and lands the write", async () => {
    const gate = stubGateGitHub({ repoId: REPO_ID });
    arrangeRepository(fake);
    fake.rejectToken(ACCESS_TOKEN);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(200);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(gate.repositoryReads()).toBe(1);
    expect(listSentTokens(fake)).toEqual([
      ACCESS_TOKEN,
      ROTATED_ACCESS_TOKEN,
      ROTATED_ACCESS_TOKEN,
    ]);
    expect(await readDraft(harness.handle)).toBe(false);
  });

  it("401s a second rejection without renewing twice", async () => {
    const gate = stubGateGitHub({ repoId: REPO_ID });
    arrangeRepository(fake);
    fake.rejectToken(ACCESS_TOKEN);
    fake.rejectToken(ROTATED_ACCESS_TOKEN);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(401);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await countReadyAudits(harness)).toBe(0);
  });

  it("401s an unreadable token behind a cached gate pass, ending the session", async () => {
    stubGateGitHub({ repoId: REPO_ID });
    arrangeRepository(fake);
    await seedDraftPr(harness.handle);
    const { cookie, cookieHash } = await seedSignIn(harness.handle, kp);
    expect((await markReady(cookie)).status).toBe(200);
    await harness.raw("update github_grant set gh_token_ciphertext = 'sealed'");

    const res = await markReady(cookie);

    expect(res.status).toBe(401);
    const sessions = await harness.raw(
      "select id from auth_session where session_token_hash = $1",
      [cookieHash],
    );
    expect(sessions).toEqual([]);
  });

  it("refuses a write behind an operator pass with no-repo-write-access", async () => {
    stubGateGitHub({ repoId: REPO_ID, viewerStatus: 404 });
    await seedDraftPr(harness.handle, OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp, { scope: OWNER });

    const res = await markReady(cookie, buildApp(OPERATOR_PAT));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "no-repo-write-access",
    });
    expect(fake.listCalls("markPullRequestReadyForReview")).toEqual([]);
  });
});
