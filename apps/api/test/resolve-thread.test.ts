// The thread resolve and unresolve routes over the PGlite harness. The
// route's own GitHub calls reach the `github/testing` fake through the
// reviewer binding; the repo gate and the OAuth refresh still answer over
// `fetch`.
import type { PrConversation } from "github";
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
import { testLogger } from "./logging";
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
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  ROTATED_ACCESS_TOKEN,
  arrangeFakePullRequest,
  arrangeFakeRepository,
  buildFakeAuthDeps,
  buildFakeInstallationDeps,
  listFakeCallTokens,
  arrangeFakeGate,
  DENIED_GATE_CALLS,
  REVIEWER_GATE_CALLS,
  listCallsPastGate,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";
import { registerSharedPglite, type SharedPglite } from "./shared-pglite";

// Every case drives a full request over the PGlite harness; the slowest
// measures 3.0s, cold snapshot cache included.
vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const ROOT_COMMENT_ID = 91001;
const OPERATOR_PAT = "ghp_OPERATOR_PAT";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};

const RESOLVE_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/comments/${ROOT_COMMENT_ID}/resolve`;
const BAD_COMMENT_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/comments/nope/resolve`;
const UNRESOLVE_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/comments/${ROOT_COMMENT_ID}/unresolve`;
const CONVERSATION_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/conversation`;

/** One thread whose root is `rootCommentId`, in `isResolved` state. */
function makeThreadConversation(
  isResolved: boolean,
  rootCommentId = ROOT_COMMENT_ID,
): PrConversation {
  return {
    threads: [
      {
        rootCommentId,
        path: "src/a.ts",
        subjectType: "LINE",
        isResolved,
        isOutdated: false,
        comments: [],
        hasMoreComments: false,
      },
    ],
    reviews: [],
    prComments: [],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

async function seedPr(
  handle: AppDatabase,
  scope: ScopeContext = CTX,
): Promise<void> {
  await createTenantRepository(handle, scope).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

async function auditCount(
  harness: SharedPglite,
  action: string,
): Promise<number> {
  const rows = await harness.raw(
    // Successful flips only: the choke point also records refusals, and what
    // these cases pin is whether the flip itself was recorded.
    `select count(*)::int as n from audit_log where operation = '${action}' and outcome = 'ok'`,
  );
  const n = rows[0]?.["n"];
  if (typeof n !== "number") {
    throw new Error("unexpected count result");
  }
  return n;
}

async function post(
  app: ApiApp,
  cookie: string | undefined,
  path: string,
): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers:
      cookie === undefined
        ? {}
        : {
            ...SAME_ORIGIN_HEADERS,
            cookie: `__Host-mergebrief_session=${cookie}`,
          },
  });
}

describe("thread resolve and unresolve routes", () => {
  const harness = registerSharedPglite();
  let app: ApiApp;
  let kp: KeyProvider;
  let fake: FakeGitHub;

  function buildApp(operatorToken?: string): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
      operatorToken:
        operatorToken === undefined
          ? undefined
          : buildOperatorToken(operatorToken),
    });
  }

  function arrangeThread(isResolved: boolean, rootCommentId?: number): void {
    arrangeFakeRepository(fake, REPO_ID);
    arrangeFakePullRequest(fake, {
      repoId: REPO_ID,
      conversation: makeThreadConversation(isResolved, rootCommentId),
    });
  }

  function countConversationReads(): number {
    return fake.listCalls("fetchPullRequestConversation").length;
  }

  function countResolutions(): number {
    return fake.listCalls("setReviewThreadResolution").length;
  }

  async function readConversation(cookie: string): Promise<number> {
    const res = await app.request(CONVERSATION_PATH, {
      headers: { cookie: `__Host-mergebrief_session=${cookie}` },
    });
    return res.status;
  }

  beforeEach(() => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = buildApp();
  });

  it("401 without a session cookie and no GitHub call", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    const res = await post(app, undefined, RESOLVE_PATH);
    expect(res.status).toBe(401);
    expect(gate.repositoryReads()).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("404 collapse when the viewer has no access to the repo", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 403 });
    arrangeThread(false);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake, DENIED_GATE_CALLS)).toEqual([]);
  });

  it("404 when the PR is outside the tenant, with no GitHub call", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(false);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("400 on a malformed comment id, 404 on a malformed PR number", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(false);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const badComment = await post(app, cookie, BAD_COMMENT_PATH);
    expect(badComment.status).toBe(400);
    const badPr = await post(
      app,
      cookie,
      `/api/repos/${REPO_ID}/pulls/nope/comments/${ROOT_COMMENT_ID}/resolve`,
    );
    expect(badPr.status).toBe(404);
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("200 resolve flips, audits and answers no-store with one row read", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFakePullRequest(fake, {
      repoId: REPO_ID,
      fullName: "octo/renamed",
      conversation: makeThreadConversation(false),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    // The gate caches its pass under the old name before the rename lands.
    expect((await post(app, cookie, BAD_COMMENT_PATH)).status).toBe(400);
    arrangeFakeRepository(fake, REPO_ID, "octo/renamed");
    const lookups = spyPullRequestLookups(harness);

    const res = await post(app, cookie, RESOLVE_PATH);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      resolved: true,
      alreadyInTargetState: false,
    });
    expect(lookups.count()).toBe(1);
    const freshReads = listCallsPastGate(fake).filter(
      (call) => call.operation === "fetchRepositoryById",
    );
    expect(freshReads).toHaveLength(1);
    expect(fake.listCalls("setReviewThreadResolution")).toEqual([
      expect.objectContaining({
        input: {
          owner: "octo",
          repo: "renamed",
          prNumber: PR_NUMBER,
          rootCommentId: ROOT_COMMENT_ID,
          resolved: true,
        },
      }),
    ]);
    expect(await auditCount(harness, "resolve-thread")).toBe(1);
    expect(await auditCount(harness, "unresolve-thread")).toBe(0);
  });

  it("200 unresolve happy path with its own audit action", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(true);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await post(app, cookie, UNRESOLVE_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resolved: false,
      alreadyInTargetState: false,
    });
    expect(await auditCount(harness, "unresolve-thread")).toBe(1);
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("200 converges when already in the target state and still evicts", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(true);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    // Convergence means someone else flipped the thread inside the TTL, so
    // the cached conversation is stale and the eviction runs on this path too.
    expect(await readConversation(cookie)).toBe(200);
    expect(countConversationReads()).toBe(1);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resolved: true,
      alreadyInTargetState: true,
    });
    expect(await auditCount(harness, "resolve-thread")).toBe(1);

    expect(await readConversation(cookie)).toBe(200);
    expect(countConversationReads()).toBe(2);
  });

  it("404 when no thread has the comment as its root", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(false, 777_777);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(404);
    expect(countResolutions()).toBe(1);
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("404 collapse when the in-route fresh repo resolve is denied", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(false);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    // A malformed comment id stops past the gate, which caches its pass.
    expect((await post(app, cookie, BAD_COMMENT_PATH)).status).toBe(400);
    fake.failOn("fetchRepositoryById", FakeFailures.FORBIDDEN);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(404);
    const pastGate = listCallsPastGate(fake).map((call) => call.operation);
    expect(pastGate).toEqual(["fetchRepositoryById"]);
    expect(countResolutions()).toBe(0);
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("403 github-permission on a mutation-stage FORBIDDEN", async () => {
    // Gate and fresh re-resolve both passed: the viewer proved repo access
    // this request, so the refusal surfaces honestly.
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(false);
    fake.failOn("setReviewThreadResolution", FakeFailures.FORBIDDEN);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "github-permission",
      code: "github-permission",
    });
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("502 on a hard GitHub failure, no audit", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(false);
    fake.failOn("setReviewThreadResolution", FakeFailures.SERVER_ERROR);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("renews the token once after a mid-request 401, then flips", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(false);
    fake.rejectToken(ACCESS_TOKEN);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(200);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(listFakeCallTokens(fake)).toEqual([
      ACCESS_TOKEN,
      ...REVIEWER_GATE_CALLS.map(() => ROTATED_ACCESS_TOKEN),
      ROTATED_ACCESS_TOKEN,
      ROTATED_ACCESS_TOKEN,
    ]);
  });

  it("401 when the flip still 401s after a good refresh", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(false);
    fake.failOn(
      "setReviewThreadResolution",
      FakeFailures.UNAUTHORIZED,
      CredentialKinds.REVIEWER,
    );
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(401);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(countResolutions()).toBe(2);
    expect(await auditCount(harness, "resolve-thread")).toBe(0);
  });

  it("refuses a flip behind an operator pass with no-repo-write-access", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 404 });
    await seedPr(harness.handle, OWNER);
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await post(buildApp(OPERATOR_PAT), cookie, RESOLVE_PATH);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "no-repo-write-access",
    });
    expect(countResolutions()).toBe(0);
  });

  it("busts the PR's conversation cache so a refetch reflects the write", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(false);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    expect(await readConversation(cookie)).toBe(200);
    expect(await readConversation(cookie)).toBe(200);
    expect(countConversationReads()).toBe(1);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(200);

    expect(await readConversation(cookie)).toBe(200);
    expect(countConversationReads()).toBe(2);
  });

  it("does not bust the conversation cache on a failed mutation", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeThread(false);
    fake.failOn("setReviewThreadResolution", FakeFailures.SERVER_ERROR);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);

    expect(await readConversation(cookie)).toBe(200);
    expect(countConversationReads()).toBe(1);

    const res = await post(app, cookie, RESOLVE_PATH);
    expect(res.status).toBe(502);

    expect(await readConversation(cookie)).toBe(200);
    expect(countConversationReads()).toBe(1);
  });
});
