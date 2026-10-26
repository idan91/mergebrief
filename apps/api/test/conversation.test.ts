// The conversation read and the writes that evict it, over the PGlite
// harness. The read reaches the `github/testing` fake through the
// installation binding for an Installation row and the reviewer binding for
// an owner row, and the reply and the review submit through the reviewer
// binding; the gate still answers over `fetch`. The github suite owns the
// wire-to-domain mapping.
import type { PrConversation } from "github";
import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { ReviewOutcomes } from "types/reviews";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger, testLogging } from "./logging";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  buildOperatorToken,
  createKeyProvider,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  ROTATED_ACCESS_TOKEN,
  arrangeFakePullRequest,
  arrangeFakeRepository,
  buildFakeAuthDeps,
  buildFakeInstallationDeps,
  buildOverriddenAuthDeps,
  listFakeCallTokens,
  arrangeFakeGate,
  OPERATOR_GATE_CALLS,
  REVIEWER_GATE_CALLS,
  listCallTokens,
  listCallsPastGate,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";
import {
  openPerTestPglite,
  registerSharedPglite,
  type SharedPglite,
} from "./shared-pglite";
import { STORED_BODY_VERSION } from "brief-core/artifact";

// Headroom for the PGlite harness; fake clocks stay out, they poison octokit.
vi.setConfig({ testTimeout: 30_000 });

const REPO_ID = 424242;
const OTHER_PR_NUMBER = PR_NUMBER + 1;
const ROOT_COMMENT_ID = 3_538_588_388;
const BASE_SHA = "b".repeat(40);
const HEAD_SHA = "a".repeat(40);
const REPLY_ID = 3_600_000_001;
const OPERATOR_PAT = "ghp_OPERATOR_PAT";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};

// ---------------------------------------------------------------------------
// Canned conversation and the fake GitHub that serves it.
// ---------------------------------------------------------------------------

function conversationFixture(): PrConversation {
  return {
    threads: [
      {
        rootCommentId: ROOT_COMMENT_ID,
        path: "src/a.ts",
        line: 12,
        side: "RIGHT",
        subjectType: "LINE",
        isResolved: false,
        isOutdated: false,
        anchorSha: "a".repeat(40),
        comments: [
          {
            commentId: ROOT_COMMENT_ID,
            author: { login: "alice", isBot: false },
            body: "human note",
            createdAt: "2026-07-01T10:00:00Z",
            url: "https://github.com/octo/hello/pull/7#discussion_r1",
            reviewId: 4_647_663_464,
          },
        ],
        hasMoreComments: false,
      },
      {
        rootCommentId: 3_538_700_000,
        path: "src/b.ts",
        subjectType: "LINE",
        isResolved: true,
        isOutdated: true,
        comments: [
          {
            commentId: 3_538_700_000,
            author: { login: "coderabbitai", isBot: true },
            body: "bot note",
            createdAt: "2026-07-01T11:00:00Z",
            url: "https://github.com/octo/hello/pull/7#discussion_r2",
          },
        ],
        hasMoreComments: false,
      },
    ],
    reviews: [
      {
        reviewId: 4_647_663_464,
        author: { login: "alice", isBot: false },
        state: "CHANGES_REQUESTED",
        body: "needs work",
        submittedAt: "2026-07-01T10:00:00Z",
        url: "https://github.com/octo/hello/pull/7#pullrequestreview-1",
      },
    ],
    prComments: [
      {
        commentId: 9001,
        author: { login: "carol", isBot: false },
        body: "PR-level remark",
        createdAt: "2026-07-02T09:00:00Z",
        url: "https://github.com/octo/hello/pull/7#issuecomment-9001",
      },
    ],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

function listConversationReads(fake: FakeGitHub) {
  return fake.listCalls("fetchPullRequestConversation");
}

// ---------------------------------------------------------------------------
// Seeding + request helpers.
// ---------------------------------------------------------------------------

async function seedPullRequest(
  handle: AppDatabase,
  scope: ScopeContext = CTX,
  prNumber: number = PR_NUMBER,
): Promise<void> {
  await createTenantRepository(handle, scope).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

/** Seed + stamp the stored Entry-comment id (delete+repost tracking). */
async function seedPullRequestWithEntryComment(
  handle: AppDatabase,
  entryCommentId: bigint,
): Promise<void> {
  await seedPullRequest(handle);
  const row = await createTenantRepository(
    handle,
    CTX,
  ).pullRequests.getByNumber(brandRepoId(BigInt(REPO_ID)), PR_NUMBER);
  if (row === undefined) {
    throw new Error("seed row missing");
  }
  const set = await createTenantRepository(
    handle,
    CTX,
  ).pullRequests.swapEntryComment(row.id, {
    seen: null,
    next: entryCommentId,
  });
  if (!set.ok) {
    throw new Error("swapEntryComment failed in seed");
  }
}

function conversationPath(prNumber: number = PR_NUMBER): string {
  return `/api/repos/${REPO_ID}/pulls/${prNumber}/conversation`;
}

function replyPath(commentId: number | string = ROOT_COMMENT_ID): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/comments/${commentId}/replies`;
}

/** The brief the submit names, and the session opened against it. */
async function seedBriefSession(handle: AppDatabase): Promise<void> {
  await seedBrief(handle, true);
}

/** The brief a request names, with or without the reviewer's session on it. */
async function seedBrief(
  handle: AppDatabase,
  withSession: boolean,
): Promise<void> {
  const repo = createTenantRepository(handle, CTX);
  const pr = await repo.pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) {
    throw new Error("seedBriefSession: pr missing");
  }
  const brief = await createArtifactStore(handle, CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    headIndex: 1,
    commitCount: 1,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    bodyVersion: STORED_BODY_VERSION,
    body: "{}",
    usedGroupIds: [],
  });
  if (!withSession) {
    return;
  }

  const written = await repo.reviewSessions.setOutcome(
    {
      briefId: brief.id,
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
    },
    ReviewOutcomes.COMMENT,
  );
  if (!written.ok) {
    throw new Error("seedBriefSession: session seed failed");
  }
}

async function getConversation(
  app: ApiApp,
  cookie: string | undefined,
  path = conversationPath(),
): Promise<Response> {
  return await app.request(path, {
    headers:
      cookie === undefined
        ? {}
        : { cookie: `__Host-mergebrief_session=${cookie}` },
  });
}

async function postReply(
  app: ApiApp,
  cookie: string | undefined,
  body: unknown,
  path = replyPath(),
): Promise<Response> {
  const headers: Record<string, string> = {
    ...SAME_ORIGIN_HEADERS,
    "content-type": "application/json",
  };

  if (cookie !== undefined) {
    headers["cookie"] = `__Host-mergebrief_session=${cookie}`;
  }

  return await app.request(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function replyAuditCount(harness: SharedPglite): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as n from audit_log where operation = 'reply-to-comment' and outcome = 'ok'",
  );
  const n = rows[0]?.["n"];
  if (typeof n !== "number") {
    throw new Error("unexpected count result");
  }
  return n;
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

describe("conversation surface", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;

  beforeEach(() => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    arrangeFakePullRequest(fake, {
      repoId: REPO_ID,
      conversation: conversationFixture(),
    });
  });

  function makeApp(operatorToken?: string): ApiApp {
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

  describe("GET conversation on an Installation row", () => {
    it("401s without a session cookie and never reads GitHub", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const res = await getConversation(makeApp(), undefined);
      expect(res.status).toBe(401);
      // Gate denials are per-viewer state too, the no-store contract covers
      // EVERY response of a gated route, middleware denials included.
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(fake.calls).toEqual([]);
    });

    it("returns no-store conversation data on the App with one row read", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const lookups = spyPullRequestLookups(harness);
      const res = await getConversation(makeApp(), cookie);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      const body = (await res.json()) as PrConversation;
      expect(body).toEqual(conversationFixture());
      expect(lookups.count()).toBe(1);
      // The App read the tenant installation's PR by the verified repo slug.
      expect(listConversationReads(fake)).toEqual([
        {
          operation: "fetchPullRequestConversation",
          credential: {
            kind: CredentialKinds.INSTALLATION,
            installationId: CTX.installationId,
          },
          input: { owner: "octo", repo: "hello", prNumber: PR_NUMBER },
        },
      ]);
    });

    it("filters the stored Entry comment out of prComments", async () => {
      const fixture = conversationFixture();
      arrangeFakePullRequest(fake, {
        repoId: REPO_ID,
        conversation: {
          ...fixture,
          prComments: [
            ...fixture.prComments,
            {
              commentId: 424_242,
              author: { login: "mergebrief[bot]", isBot: true },
              body: "**[Read the brief for this push](https://mb.example/...)**",
              createdAt: "2026-07-02T10:00:00Z",
              url: "https://github.com/octo/hello/pull/7#issuecomment-424242",
            },
          ],
        },
      });
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequestWithEntryComment(harness.handle, 424_242n);
      const res = await getConversation(makeApp(), cookie);
      expect(res.status).toBe(200);
      const body = (await res.json()) as PrConversation;
      // The human comment stays; OUR branded entry comment never renders in
      // the collapsible (it is the front door, not conversation).
      expect(body.prComments.map((comment) => comment.commentId)).toEqual([
        9001,
      ]);
      // Only the exact stored id is filtered, pagination flag untouched.
      expect(body.hasMorePrComments).toBe(false);
    });

    it("caches the second read per PR within the TTL", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const app = makeApp();
      const first = await getConversation(app, cookie);
      expect(first.status).toBe(200);
      const second = await getConversation(app, cookie);
      expect(second.status).toBe(200);
      expect(listConversationReads(fake)).toHaveLength(1);
      // The cache is per PR, not per viewer: a SECOND session shares the entry.
      const other = await seedSignIn(harness.handle, kp);
      const third = await getConversation(app, other.cookie);
      expect(third.status).toBe(200);
      expect(listConversationReads(fake)).toHaveLength(1);
    });

    it("502s a rate limit and caches no failure", async () => {
      fake.failOn("fetchPullRequestConversation", FakeFailures.RATE_LIMITED);
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const app = makeApp();
      const first = await getConversation(app, cookie);
      expect(first.status).toBe(502);
      expect(first.headers.get("cache-control")).toBe("no-store");
      expect(await first.json()).toMatchObject({ code: "github-unavailable" });
      const second = await getConversation(app, cookie);
      expect(second.status).toBe(502);
      expect(listConversationReads(fake)).toHaveLength(2);
    });

    it("collapses an App-credential 403 to 404", async () => {
      fake.failOn("fetchPullRequestConversation", FakeFailures.FORBIDDEN);
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const res = await getConversation(makeApp(), cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "not-found" });
    });

    it("answers an App-credential 401 as 502, never a sign-in prompt", async () => {
      fake.failOn("fetchPullRequestConversation", FakeFailures.UNAUTHORIZED);
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const res = await getConversation(makeApp(), cookie);
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ code: "github-unavailable" });
    });
  });

  describe("GET conversation on an owner row", () => {
    it("reads on the viewer's token, never the App's", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation: false });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle, OWNER);
      const lookups = spyPullRequestLookups(harness);
      const res = await getConversation(makeApp(), cookie);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(conversationFixture());
      expect(lookups.count()).toBe(1);
      expect(listConversationReads(fake)).toEqual([
        expect.objectContaining({
          credential: { kind: CredentialKinds.REVIEWER, token: ACCESS_TOKEN },
        }),
      ]);
    });

    it("500s an unreadable token behind a cached gate pass", async () => {
      arrangeFakePullRequest(fake, {
        repoId: REPO_ID,
        prNumber: OTHER_PR_NUMBER,
        conversation: conversationFixture(),
      });
      arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation: false });
      const { cookie, cookieHash } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle, OWNER);
      await seedPullRequest(harness.handle, OWNER, OTHER_PR_NUMBER);
      const app = makeApp();
      expect((await getConversation(app, cookie)).status).toBe(200);
      await harness.raw(
        "update github_grant set gh_token_ciphertext = 'sealed'",
      );

      const res = await getConversation(
        app,
        cookie,
        conversationPath(OTHER_PR_NUMBER),
      );

      expect(res.status).toBe(500);
      expect(listConversationReads(fake)).toHaveLength(1);
      const sessions = await harness.raw(
        "select id from auth_session where session_token_hash = $1",
        [cookieHash],
      );
      expect(sessions).toHaveLength(1);
    });

    it("collapses a viewer-token 403 to 404", async () => {
      fake.failOn("fetchPullRequestConversation", FakeFailures.FORBIDDEN);
      arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation: false });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle, OWNER);
      const res = await getConversation(makeApp(), cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "not-found" });
    });

    it("401s when the read still 401s after a good refresh", async () => {
      fake.failOn(
        "fetchPullRequestConversation",
        FakeFailures.UNAUTHORIZED,
        CredentialKinds.REVIEWER,
      );
      const gate = arrangeFakeGate(fake, {
        repoId: REPO_ID,
        inInstallation: false,
      });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle, OWNER);
      const res = await getConversation(makeApp(), cookie);
      expect(res.status).toBe(401);
      expect(gate.tokenRefreshes()).toBe(1);
      expect(listConversationReads(fake)).toHaveLength(2);
    });

    it("falls back to the operator token behind an operator pass", async () => {
      fake.failOn(
        "fetchPullRequestConversation",
        FakeFailures.NOT_FOUND,
        CredentialKinds.REVIEWER,
      );
      arrangeFakeGate(fake, {
        repoId: REPO_ID,
        viewerStatus: 404,
        inInstallation: false,
      });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle, OWNER);
      const lookups = spyPullRequestLookups(harness);
      const res = await getConversation(makeApp(OPERATOR_PAT), cookie);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(conversationFixture());
      const pastGate = listCallsPastGate(fake, OPERATOR_GATE_CALLS);
      expect(listCallTokens(pastGate)).toEqual([ACCESS_TOKEN, OPERATOR_PAT]);
      // The gate rung probes the reader's own url row once, then the row loads.
      expect(lookups.count()).toBe(2);
    });

    it("keeps a reviewer-footed denial off the operator token", async () => {
      fake.failOn(
        "fetchPullRequestConversation",
        FakeFailures.NOT_FOUND,
        CredentialKinds.REVIEWER,
      );
      arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation: false });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle, OWNER);
      const res = await getConversation(makeApp(OPERATOR_PAT), cookie);
      expect(res.status).toBe(404);
      expect(listCallTokens(listCallsPastGate(fake))).toEqual([ACCESS_TOKEN]);
    });
  });

  describe("POST reply", () => {
    function listReplies() {
      return fake.listCalls("createReviewCommentReply");
    }

    /** The wrapping review id a reply answered with. */
    async function readReplyReviewId(res: Response): Promise<number> {
      const body: unknown = await res.json();
      const hasReviewId =
        typeof body === "object" && body !== null && "reviewId" in body;
      if (!hasReviewId || typeof body.reviewId !== "number") {
        throw new Error("no reviewId on the reply");
      }
      return body.reviewId;
    }

    beforeEach(() => {
      arrangeFakeRepository(fake, REPO_ID);
    });

    /** An empty reply stops at the parse, past the gate that caches its pass. */
    async function cacheGatePass(app: ApiApp, cookie: string): Promise<void> {
      expect((await postReply(app, cookie, { body: "" })).status).toBe(400);
    }

    it("posts and audits with the viewer token and one row read", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const lookups = spyPullRequestLookups(harness);

      const res = await postReply(makeApp(), cookie, { body: "a follow-up" });

      expect(res.status).toBe(201);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        commentId: expect.any(Number),
        reviewId: expect.any(Number),
      });
      expect(lookups.count()).toBe(1);
      expect(listReplies()).toEqual([
        expect.objectContaining({
          input: {
            owner: "octo",
            repo: "hello",
            prNumber: PR_NUMBER,
            commentId: ROOT_COMMENT_ID,
            body: "a follow-up",
          },
        }),
      ]);
      const pastGate = listCallsPastGate(fake);
      const freshReads = pastGate.filter(
        (call) => call.operation === "fetchRepositoryById",
      );
      expect(freshReads).toHaveLength(1);
      expect(listCallTokens(pastGate)).toEqual([ACCESS_TOKEN, ACCESS_TOKEN]);
      expect(await replyAuditCount(harness)).toBe(1);
    });

    it("answers no reviewId when GitHub wraps the reply in none", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      await seedBriefSession(harness.handle);
      const app = createApp({
        logger: testLogger(),
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: buildOverriddenAuthDeps(kp, fake, (client) => ({
          async createReviewCommentReply(input) {
            const created = await client.createReviewCommentReply(input);
            if (!created.ok) {
              return created;
            }
            return { ok: true, value: { commentId: REPLY_ID } };
          },
        })),
        ...buildFakeInstallationDeps(fake),
      });

      const res = await postReply(
        app,
        cookie,
        { body: "a follow-up" },
        `${replyPath()}?base=${BASE_SHA}&head=${HEAD_SHA}`,
      );

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ commentId: REPLY_ID });
      const rows = await harness.raw(
        "select github_review_id from review_submitted_review",
      );
      expect(rows).toHaveLength(0);
    });

    it("records the reply's review id on the brief the request names", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      await seedBriefSession(harness.handle);
      const lookups = spyPullRequestLookups(harness);

      const res = await postReply(
        makeApp(),
        cookie,
        { body: "a follow-up" },
        `${replyPath()}?base=${BASE_SHA}&head=${HEAD_SHA}`,
      );

      expect(res.status).toBe(201);
      const reviewId = await readReplyReviewId(res);
      expect(lookups.count()).toBe(1);
      const rows = await harness.raw(
        "select github_review_id from review_submitted_review",
      );
      expect(rows.map((row) => String(row["github_review_id"]))).toEqual([
        String(reviewId),
      ]);
    });

    it("still posts a reply that names no brief, recording nothing", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      await seedBriefSession(harness.handle);

      const res = await postReply(makeApp(), cookie, { body: "a follow-up" });

      expect(res.status).toBe(201);
      const rows = await harness.raw(
        "select github_review_id from review_submitted_review",
      );
      expect(rows).toHaveLength(0);
    });

    it("never creates a session for a reviewer who holds none", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      await seedBrief(harness.handle, false);

      const res = await postReply(
        makeApp(),
        cookie,
        { body: "a follow-up" },
        `${replyPath()}?base=${BASE_SHA}&head=${HEAD_SHA}`,
      );

      expect(res.status).toBe(201);
      const sessions = await harness.raw("select id from review_session");
      const recorded = await harness.raw(
        "select id from review_submitted_review",
      );
      expect(sessions).toHaveLength(0);
      expect(recorded).toHaveLength(0);
    });

    it("keeps 201 when the named brief does not exist", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);

      const res = await postReply(
        makeApp(),
        cookie,
        { body: "a follow-up" },
        `${replyPath()}?base=${BASE_SHA}&head=${HEAD_SHA}`,
      );

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        commentId: expect.any(Number),
        reviewId: expect.any(Number),
      });
    });

    it("400s empty or oversized replies without posting", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const app = makeApp();
      const empty = await postReply(app, cookie, { body: "" });
      expect(empty.status).toBe(400);
      const oversized = await postReply(app, cookie, {
        body: "x".repeat(65_537),
      });
      expect(oversized.status).toBe(400);
      expect(listReplies()).toEqual([]);
      expect(await replyAuditCount(harness)).toBe(0);
    });

    it("400s comment ids beyond safe integer precision", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const res = await postReply(
        makeApp(),
        cookie,
        { body: "x" },
        replyPath("9007199254740993"),
      );
      expect(res.status).toBe(400);
      expect(listReplies()).toEqual([]);
    });

    it("renews once across the gate and the reply, then posts", async () => {
      const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
      fake.rejectToken(ACCESS_TOKEN);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const res = await postReply(makeApp(), cookie, {
        body: "after refresh",
      });
      expect(res.status).toBe(201);
      expect(gate.tokenRefreshes()).toBe(1);
      expect(listFakeCallTokens(fake)).toEqual([
        ACCESS_TOKEN,
        ...REVIEWER_GATE_CALLS.map(() => ROTATED_ACCESS_TOKEN),
        ROTATED_ACCESS_TOKEN,
        ROTATED_ACCESS_TOKEN,
      ]);
      expect(listReplies()).toHaveLength(1);
    });

    it("502s a reply GitHub fails upstream after one reply call", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      fake.failOn("createReviewCommentReply", FakeFailures.SERVER_ERROR);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const res = await postReply(makeApp(), cookie, { body: "x" });
      expect(res.status).toBe(502);
      expect(listReplies()).toHaveLength(1);
      expect(await replyAuditCount(harness)).toBe(0);
    });

    it("collapses reply-create 403 to the gate's uniform 404", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      fake.failOn("createReviewCommentReply", FakeFailures.FORBIDDEN);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const res = await postReply(makeApp(), cookie, { body: "x" });
      expect(res.status).toBe(404);
      expect(await replyAuditCount(harness)).toBe(0);
    });

    it("404s a deleted root comment with sanitized copy", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      fake.failOn("createReviewCommentReply", FakeFailures.NOT_FOUND);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const res = await postReply(makeApp(), cookie, { body: "x" });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: "not found",
        code: "not-found",
      });
      expect(await replyAuditCount(harness)).toBe(0);
    });

    it("keeps 201 when auditing fails after posting the reply", async () => {
      const own = await openPerTestPglite();
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(own.handle, kp);
      await seedPullRequest(own.handle);
      const capture = testLogging();
      const app = createApp({
        logger: capture.logger,
        handle: own.handle,
        webhookSecret: SECRET,
        auth: buildFakeAuthDeps(kp, fake),
        ...buildFakeInstallationDeps(fake),
      });
      // The GitHub write already happened, so a local persistence failure
      // must not read as "nothing was posted".
      await own.raw("alter table audit_log rename to audit_log_hidden");
      const res = await postReply(app, cookie, {
        body: "posted then audit dies",
      });
      expect(res.status).toBe(201);
      // The integrity failure is operator-visible: one audit.fail error
      // line naming the operation whose row never landed.
      const line = capture.lines().find((l) => l["evt"] === "audit.fail");
      expect(line?.["level"]).toBe("error");
      expect(line?.["operation"]).toBe("reply-to-comment");
      expect(line?.["err"]).toBeDefined();
    });

    it("collapses a denied fresh re-resolve to the gate's 404 posture", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const app = makeApp();
      await cacheGatePass(app, cookie);
      fake.failOn("fetchRepositoryById", FakeFailures.FORBIDDEN);
      const res = await postReply(app, cookie, { body: "x" });
      expect(res.status).toBe(404);
      const pastGate = listCallsPastGate(fake).map((call) => call.operation);
      expect(pastGate).toEqual(["fetchRepositoryById"]);
      expect(listReplies()).toEqual([]);
      expect(await replyAuditCount(harness)).toBe(0);
    });

    it("posts to the freshly resolved repo slug, never the gate's name", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeFakePullRequest(fake, {
        repoId: REPO_ID,
        fullName: "octo/renamed",
      });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const app = makeApp();
      await cacheGatePass(app, cookie);
      arrangeFakeRepository(fake, REPO_ID, "octo/renamed");
      const res = await postReply(app, cookie, {
        body: "to the fresh slug",
      });
      expect(res.status).toBe(201);
      expect(listReplies()).toEqual([
        expect.objectContaining({
          input: expect.objectContaining({ owner: "octo", repo: "renamed" }),
        }),
      ]);
    });

    it("refuses a reply behind an operator pass with no-repo-write-access", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 404 });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle, OWNER);

      const res = await postReply(makeApp(OPERATOR_PAT), cookie, {
        body: "x",
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: expect.any(String),
        code: "no-repo-write-access",
      });
      expect(listReplies()).toEqual([]);
    });

    it("evicts the PR's cached conversation so the next read refetches", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      const app = makeApp();
      await getConversation(app, cookie);
      expect(listConversationReads(fake)).toHaveLength(1);
      const posted = await postReply(app, cookie, {
        body: "invalidates cache",
      });
      expect(posted.status).toBe(201);
      await getConversation(app, cookie);
      expect(listConversationReads(fake)).toHaveLength(2);
    });
  });

  describe("review submit evicts the conversation cache", () => {
    it("drops the PR's cached conversation on a successful review submit", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeFakeRepository(fake, REPO_ID);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPullRequest(harness.handle);
      await seedBriefSession(harness.handle);
      const app = makeApp();
      await getConversation(app, cookie);
      expect(listConversationReads(fake)).toHaveLength(1);
      const submitted = await app.request(
        `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/review?base=${BASE_SHA}&head=${HEAD_SHA}`,
        {
          method: "POST",
          headers: {
            ...SAME_ORIGIN_HEADERS,
            "content-type": "application/json",
            cookie: `__Host-mergebrief_session=${cookie}`,
          },
          body: JSON.stringify({ outcome: "approve" }),
        },
      );
      expect(submitted.status).toBe(201);
      await getConversation(app, cookie);
      expect(listConversationReads(fake)).toHaveLength(2);
    });
  });
});
