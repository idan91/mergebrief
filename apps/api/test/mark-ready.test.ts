// POST /api/repos/:repoId/pulls/:prNumber/ready over the PGlite harness. The
// route's own GitHub calls reach the `github/testing` fake through the
// reviewer binding; the repo gate and the OAuth refresh still answer over
// `fetch`.
import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import {
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import type { Logger } from "logging";
import { testLogger, testLogging } from "./logging";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  ROTATED_ACCESS_TOKEN,
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  listFakeCallTokens,
  makeFakePullRequestInfo,
  arrangeFakeGate,
  DENIED_GATE_CALLS,
  REVIEWER_GATE_CALLS,
  listCallsPastGate,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";
import {
  openPerTestPglite,
  registerSharedPglite,
  type SharedPglite,
} from "./shared-pglite";

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
    { info: makeFakePullRequestInfo({ repoId: REPO_ID, draft: true }) },
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

async function arrangeFailingDraftWrite(harness: SharedPglite): Promise<void> {
  await harness.raw(
    "create function refuse_draft_write() returns trigger language plpgsql as $$ begin raise exception 'refused'; end $$",
  );
  await harness.raw(
    "create trigger refuse_draft_write before update on pull_request for each row when (old.draft is distinct from new.draft) execute function refuse_draft_write()",
  );
}

async function countReadyAudits(harness: SharedPglite): Promise<number> {
  const rows = await harness.raw(
    "select id from audit_log where operation = 'mark-ready' and outcome = 'ok'",
  );
  return rows.length;
}

describe("POST /api/repos/:repoId/pulls/:prNumber/ready", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;

  interface AppOverrides {
    handle: AppDatabase;
    logger: Logger;
  }

  function buildApp(operatorToken?: string, overrides?: AppOverrides): ApiApp {
    return createApp({
      logger: overrides?.logger ?? testLogger(),
      handle: overrides?.handle ?? harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
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

  beforeEach(() => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = buildApp();
  });

  it("401s an absent session cookie without calling GitHub", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });

    const res = await markReady(undefined);

    expect(res.status).toBe(401);
    expect(gate.repositoryReads()).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("collapses a gate denial to 404 with no mutation", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 403 });
    arrangeRepository(fake);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake, DENIED_GATE_CALLS)).toEqual([]);
    expect(await readDraft(harness.handle)).toBe(true);
  });

  it("collapses a denied fresh repo read to the uniform 404", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeRepository(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    // With no row yet the request stops past the gate, which caches its pass.
    expect((await markReady(cookie)).status).toBe(404);
    await seedDraftPr(harness.handle);
    fake.failOn("fetchRepositoryById", FakeFailures.FORBIDDEN);

    const res = await markReady(cookie);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", code: "not-found" });
    const pastGate = listCallsPastGate(fake).map((call) => call.operation);
    expect(pastGate).toEqual(["fetchRepositoryById"]);
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await countReadyAudits(harness)).toBe(0);
  });

  it("marks the PR under the fresh name, never the gate's cached slug", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    const { cookie } = await seedSignIn(harness.handle, kp);
    // The gate caches its pass under the old name before the rename lands.
    expect((await markReady(cookie)).status).toBe(404);
    arrangeRepository(fake, "octo/renamed");
    await seedDraftPr(harness.handle);

    const res = await markReady(cookie);

    expect(res.status).toBe(204);
    expect(fake.listCalls("markPullRequestReadyForReview")).toEqual([
      expect.objectContaining({
        input: { owner: "octo", repo: "renamed", prNumber: PR_NUMBER },
      }),
    ]);
  });

  it("404s a PR with no row before any call past the gate", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeRepository(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("204s a fresh flip with the mirror, the audit and one row read", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeRepository(fake);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const lookups = spyPullRequestLookups(harness);

    const res = await markReady(cookie);

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
    expect(lookups.count()).toBe(1);
    expect(fake.listCalls("markPullRequestReadyForReview")).toHaveLength(1);
    expect(await readDraft(harness.handle)).toBe(false);
    expect(await countReadyAudits(harness)).toBe(1);
  });

  it("keeps the draft a webhook stamped after GitHub's flip", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeRepository(fake);
    await createTenantRepository(harness.handle, TENANT).pullRequests.upsert({
      repoId: brandRepoId(BigInt(REPO_ID)),
      prNumber: PR_NUMBER,
      repoSlug: REPO_SLUG,
      draft: true,
      state: PrStates.OPEN,
      githubUpdatedAt: new Date("2026-02-01T00:00:00Z"),
    });
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(204);
    expect(fake.listCalls("markPullRequestReadyForReview")).toHaveLength(1);
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await countReadyAudits(harness)).toBe(1);
  });

  it("converges two POSTs to 204 with an audit row each", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeRepository(fake);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const first = await markReady(cookie);
    const second = await markReady(cookie);

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(await second.text()).toBe("");
    expect(await readDraft(harness.handle)).toBe(false);
    expect(await countReadyAudits(harness)).toBe(2);
  });

  it("answers 204 and audits ok when the draft write fails", async () => {
    const own = await openPerTestPglite();
    const capture = testLogging();
    const ownApp = buildApp(undefined, {
      handle: own.handle,
      logger: capture.logger,
    });
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeRepository(fake);
    await seedDraftPr(own.handle);
    const { cookie } = await seedSignIn(own.handle, kp);
    await arrangeFailingDraftWrite(own);

    const res = await markReady(cookie, ownApp);

    expect(res.status).toBe(204);
    expect(fake.listCalls("markPullRequestReadyForReview")).toHaveLength(1);
    expect(await readDraft(own.handle)).toBe(true);
    expect(await countReadyAudits(own)).toBe(1);
    const errors = capture.lines().filter((line) => line["level"] === "error");
    expect(errors).toEqual([
      expect.objectContaining({ pullRequestId: expect.any(String) }),
    ]);
  });

  it("502s an upstream failure and leaves the row a draft", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
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
    arrangeFakeGate(fake, { repoId: REPO_ID });
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
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeRepository(fake);
    fake.rejectToken(ACCESS_TOKEN);
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(204);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(listFakeCallTokens(fake)).toEqual([
      ACCESS_TOKEN,
      ...REVIEWER_GATE_CALLS.map(() => ROTATED_ACCESS_TOKEN),
      ROTATED_ACCESS_TOKEN,
      ROTATED_ACCESS_TOKEN,
    ]);
    expect(await readDraft(harness.handle)).toBe(false);
  });

  it("401s when the write still 401s after a good refresh", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeRepository(fake);
    fake.failOn(
      "markPullRequestReadyForReview",
      FakeFailures.UNAUTHORIZED,
      CredentialKinds.REVIEWER,
    );
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie);

    expect(res.status).toBe(401);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(fake.listCalls("markPullRequestReadyForReview")).toHaveLength(2);
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await countReadyAudits(harness)).toBe(0);
  });

  it("500s an unreadable token behind a cached gate pass, session kept", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeRepository(fake);
    await seedDraftPr(harness.handle);
    const { cookie, cookieHash } = await seedSignIn(harness.handle, kp);
    expect((await markReady(cookie)).status).toBe(204);
    await harness.raw("update github_grant set gh_token_ciphertext = 'sealed'");

    const res = await markReady(cookie);

    expect(res.status).toBe(500);
    const sessions = await harness.raw(
      "select id from auth_session where session_token_hash = $1",
      [cookieHash],
    );
    expect(sessions).toHaveLength(1);
  });

  it("refuses a write behind an operator pass with no-repo-write-access", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 404 });
    await seedDraftPr(harness.handle, OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await markReady(cookie, buildApp(OPERATOR_PAT));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "no-repo-write-access",
    });
    expect(fake.listCalls("markPullRequestReadyForReview")).toEqual([]);
  });
});
