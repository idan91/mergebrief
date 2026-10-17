// POST /api/repos/:repoId/pulls/:prNumber/comments (post-now) over the PGlite
// harness. The route's own GitHub calls reach the `github/testing` fake
// through the reviewer binding; the repo gate and the OAuth refresh still
// answer over `fetch`.
import type { InlineReviewCommentResult, ListedReviewComment } from "github";
import {
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
  type FakeReview,
} from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  type AppDatabase,
  type BriefRowId,
  type DraftAnchor,
  type KeyProvider,
  PUBLISH_CLAIM_LEASE_MS,
} from "persistence";
import {
  type AnchorStatus,
  AnchorStatuses,
  CommentAnchorKinds,
  type DiffSide,
  DiffSides,
  type DraftCommentStatus,
  DraftCommentStatuses,
  PrStates,
  ReviewOutcomes,
} from "types";
import {
  createPgliteHarness,
  stampDraftAnchorStatus,
  type PgliteHarness,
} from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { IN_DOUBT_LOOKUP_MARGIN_MS } from "../src/routes/repos/pr/publish/consts";
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
  arrangeFakeGate,
  DENIED_GATE_CALLS,
  listCallsPastGate,
  type RepoClientOverrides,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const COMMIT_ID = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };
const REVIEWER = brandReviewerId(BigInt(REVIEWER_ID));

// ---------------------------------------------------------------------------
// GitHub as the fake holds it.
// ---------------------------------------------------------------------------

interface GitHubArrangement {
  readonly fullName?: string;
  readonly reviews?: readonly FakeReview[];
  readonly listed?: readonly ListedReviewComment[];
}

/** The repository the fresh re-resolve reads and the PR a comment lands on. */
function arrangeGitHub(
  fake: FakeGitHub,
  arrangement: GitHubArrangement = {},
): void {
  const fullName = arrangement.fullName ?? REPO_SLUG;
  arrangeFakeRepository(fake, REPO_ID, fullName);
  arrangeFakePullRequest(fake, {
    repoId: REPO_ID,
    fullName,
    reviews: arrangement.reviews ?? [],
    reviewComments: { comments: arrangement.listed ?? [], complete: true },
  });
}

function countPosts(fake: FakeGitHub): number {
  return fake.listCalls("createInlineReviewComment").length;
}

/** The route's fresh re-resolves, past the gate's own repo read. */
function countFreshReads(fake: FakeGitHub): number {
  const pastGate = listCallsPastGate(fake);
  return pastGate.filter((call) => call.operation === "fetchRepositoryById")
    .length;
}

/** The single comment the route sent to GitHub. */
function readPostedInput(fake: FakeGitHub): unknown {
  const [call, ...rest] = fake.listCalls("createInlineReviewComment");
  if (call === undefined || rest.length > 0) {
    throw new Error("expected exactly one posted comment");
  }
  return call.input;
}

// ---------------------------------------------------------------------------
// Seeding.
// ---------------------------------------------------------------------------

async function seedPr(handle: AppDatabase): Promise<void> {
  await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    draft: true,
    state: PrStates.OPEN,
  });
}

/**
 * The Brief the request names and the one draft it publishes. The Brief's head
 * IS the commit the comment pins to, which is why it is a real SHA here.
 */
async function seedDraft(
  handle: AppDatabase,
  body = "post now",
  status: DraftCommentStatus = DraftCommentStatuses.DRAFT,
  anchorStatus: AnchorStatus | null = null,
  startSide: DiffSide | null = null,
): Promise<{ briefId: BriefRowId; draftId: bigint }> {
  const repo = createTenantRepository(handle, CTX);
  const pr = await repo.pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) {
    throw new Error("seedDraft: pr missing");
  }
  const brief = await createArtifactStore(handle, CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: BASE_SHA,
    headSha: COMMIT_ID,
    headIndex: 1,
    commitCount: 1,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: "{}",
  });
  const line = {
    kind: CommentAnchorKinds.LINE,
    file: "src/index.ts",
    side: DiffSides.NEW,
    startLine: 10,
    endLine: 12,
  };
  const anchor: DraftAnchor =
    startSide === null ? line : { ...line, startSide };
  const draftId = await writeDraft(handle, brief.id, anchor, body);
  if (status === DraftCommentStatuses.SUBMITTED) {
    await createTenantRepository(
      handle,
      CTX,
    ).reviewSessions.recordPublishedDrafts(
      { briefId: brief.id, reviewerId: REVIEWER },
      { draftIds: [draftId] },
    );
  }
  if (anchorStatus !== null) {
    await stampDraftAnchorStatus(handle, draftId, anchorStatus);
  }
  return { briefId: brief.id, draftId };
}

/** One draft through the reviewer's own draft action; answers its row id. */
async function writeDraft(
  handle: AppDatabase,
  briefId: BriefRowId,
  anchor: DraftAnchor,
  body: string,
): Promise<bigint> {
  const written = await createTenantRepository(
    handle,
    CTX,
  ).reviewSessions.addDraft(
    { briefId, reviewerId: REVIEWER },
    { anchor, body },
  );
  if (!written.ok) {
    throw new Error("draft seed failed");
  }
  return written.value.id;
}

async function seedFileDraft(
  handle: AppDatabase,
  body = "post now",
): Promise<{ briefId: BriefRowId; draftId: bigint }> {
  const repo = createTenantRepository(handle, CTX);
  const pr = await repo.pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) {
    throw new Error("seedFileDraft: pr missing");
  }
  const brief = await createArtifactStore(handle, CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: BASE_SHA,
    headSha: COMMIT_ID,
    headIndex: 1,
    commitCount: 1,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: "{}",
  });
  const draftId = await writeDraft(
    handle,
    brief.id,
    { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
    body,
  );
  return { briefId: brief.id, draftId };
}

/** The wire code an error response carries. */
async function readWireCode(res: Response): Promise<string> {
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || !("code" in body)) {
    throw new Error("no wire code on the response");
  }
  return String(body.code);
}

/** The ids a 201 answered with. */
async function readPostedIds(
  res: Response,
): Promise<{ commentId: number; reviewId: number }> {
  const body: unknown = await res.json();
  const hasIds =
    typeof body === "object" &&
    body !== null &&
    "commentId" in body &&
    "reviewId" in body;
  if (!hasIds) {
    throw new Error("no ids on the response");
  }
  return { commentId: Number(body.commentId), reviewId: Number(body.reviewId) };
}

/** The `since` a review-comment listing asked GitHub for. */
function readSince(input: unknown): Date {
  const hasSince =
    typeof input === "object" && input !== null && "since" in input;
  if (!hasSince || !(input.since instanceof Date)) {
    throw new Error("no since on the listing");
  }
  return input.since;
}

/**
 * A session on a NEWER Brief of the same PR, the one thing that freezes the
 * Brief the request names.
 */
async function freezeWithNewerBrief(handle: AppDatabase): Promise<void> {
  const repo = createTenantRepository(handle, CTX);
  const pr = await repo.pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) {
    throw new Error("freeze: pr missing");
  }
  const newer = await createArtifactStore(handle, CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: BASE_SHA,
    headSha: "c".repeat(40),
    headIndex: 2,
    commitCount: 2,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: JSON.stringify({ changeGroups: [], chunks: [] }),
  });
  const opened = await repo.reviewSessions.setOutcome(
    { briefId: newer.id, reviewerId: REVIEWER },
    ReviewOutcomes.COMMENT,
  );
  if (!opened.ok) {
    throw new Error("freeze: newer session failed");
  }
}

async function commentAuditCount(harness: PgliteHarness): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as n from audit_log where target_type = 'review_comment'",
  );
  const n = rows[0]?.["n"];
  if (typeof n !== "number") {
    throw new Error("unexpected count result");
  }
  return n;
}

// ---------------------------------------------------------------------------
// Request helper.
// ---------------------------------------------------------------------------

const PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/comments?base=${BASE_SHA}&head=${COMMIT_ID}`;

/** The wire the route takes: the draft it publishes, and nothing else. */
function named(draftId: bigint): { draftId: string } {
  return { draftId: String(draftId) };
}

async function post(
  app: ApiApp,
  cookie: string | undefined,
  body: { draftId: string } | string,
  path = PATH,
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
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/repos/:repoId/pulls/:prNumber/comments", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;
  let fake: FakeGitHub;

  /** An app whose reviewer repo clients answer `overrides` first. */
  function buildOverriddenApp(overrides: RepoClientOverrides): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildOverriddenAuthDeps(kp, fake, overrides),
      ...buildFakeInstallationDeps(fake),
    });
  }

  function buildCaptureApp(capture: ReturnType<typeof testLogging>): ApiApp {
    return createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
    });
  }

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  /** A request refused at the parse leaves the gate's pass cached. */
  async function cacheGatePass(cookie: string): Promise<void> {
    expect((await post(app, cookie, "{not json")).status).toBe(400);
  }

  it("401s absent session cookies without calling GitHub", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    const res = await post(app, undefined, named(1n));
    expect(res.status).toBe(401);
    expect(gate.repositoryReads()).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("404 collapse when the viewer has no access to the repo", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 403 });
    arrangeGitHub(fake);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake, DENIED_GATE_CALLS)).toEqual([]);
  });

  it("404s PRs outside the tenant without writing to GitHub", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await post(app, cookie, named(1n));
    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("404s a denied fresh repo resolution after the gate passes", async () => {
    // A viewer whose access was revoked inside the positive-cache TTL: the
    // route's own re-resolve collapses to the gate's 404 and posts nothing.
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    await cacheGatePass(cookie);
    fake.failOn("fetchRepositoryById", FakeFailures.FORBIDDEN);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(404);
    expect(countFreshReads(fake)).toBe(1);
    expect(countPosts(fake)).toBe(0);
    expect(await commentAuditCount(harness)).toBe(0);
  });

  it("201 posts to the fresh slug with ids, audit, no-store, one row read", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    await cacheGatePass(cookie);
    arrangeGitHub(fake, { fullName: "octo/renamed" });
    const lookups = spyPullRequestLookups(harness);

    const res = await post(app, cookie, named(draftId));

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      commentId: expect.any(Number),
      reviewId: expect.any(Number),
    });
    expect(lookups.count()).toBe(1);
    expect(countFreshReads(fake)).toBe(1);
    expect(readPostedInput(fake)).toEqual({
      owner: "octo",
      repo: "renamed",
      prNumber: PR_NUMBER,
      commitId: COMMIT_ID,
      path: "src/index.ts",
      line: 12,
      side: "RIGHT",
      startLine: 10,
      startSide: "RIGHT",
      body: "post now",
    });
    expect(await commentAuditCount(harness)).toBe(1);
  });

  it("maps a two-side draft's start leg to GitHub's LEFT", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(
      harness.handle,
      "spans both sides",
      DraftCommentStatuses.DRAFT,
      null,
      DiffSides.OLD,
    );

    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(201);
    expect(readPostedInput(fake)).toMatchObject({
      path: "src/index.ts",
      line: 12,
      side: "RIGHT",
      startLine: 10,
      startSide: "LEFT",
      body: "spans both sides",
    });
  });

  it("posts a File comment with subjectType file and no line", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedFileDraft(harness.handle);

    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(201);
    expect(readPostedInput(fake)).toEqual({
      owner: "octo",
      repo: "hello",
      prNumber: PR_NUMBER,
      commitId: COMMIT_ID,
      path: "src/app.ts",
      body: "post now",
      subjectType: "file",
    });
  });

  it("keeps 201 and logs audit.fail when post-commit auditing fails", async () => {
    const capture = testLogging();
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    // The GitHub post has committed by the time the audit insert runs, so
    // the response stays a 201.
    await harness.raw("alter table audit_log rename to audit_log_poisoned");

    const res = await post(buildCaptureApp(capture), cookie, named(draftId));
    expect(res.status).toBe(201);
    const line = capture.lines().find((l) => l["evt"] === "audit.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["operation"]).toBe("create-inline-comment");
    expect(line?.["err"]).toBeDefined();
  });

  it("201 with reviewId omitted when GitHub assigns no wrapping review id", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const unwrapped = buildOverriddenApp((client) => ({
      async createInlineReviewComment(input) {
        const posted = await client.createInlineReviewComment(input);
        if (!posted.ok) {
          return posted;
        }
        const value: InlineReviewCommentResult = { commentId: 999n };
        return { ok: true, value };
      },
    }));

    const res = await post(unwrapped, cookie, named(draftId));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ commentId: 999 });
  });

  it("409s stale anchors when GitHub rejects the pinned head with 422", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    fake.failOn("createInlineReviewComment", FakeFailures.ANCHOR_REJECTED);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await readWireCode(res)).toBe("pr-changed-since-read");
    expect(await commentAuditCount(harness)).toBe(0);
  });

  it("502s a hard GitHub failure after one comment call, no audit row", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    fake.failOn("createInlineReviewComment", FakeFailures.SERVER_ERROR);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(502);
    expect(countPosts(fake)).toBe(1);
    expect(await commentAuditCount(harness)).toBe(0);
  });

  it("answers 404 when the comment target is gone", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    fake.failOn("createInlineReviewComment", FakeFailures.NOT_FOUND);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(404);
  });

  it("answers an honest 403 when GitHub forbids the comment", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    fake.failOn("createInlineReviewComment", FakeFailures.FORBIDDEN);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(403);
    expect(await readWireCode(res)).toBe("github-permission");
  });

  it("renews once after a mid-request 401 and posts once", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    fake.rejectToken(ACCESS_TOKEN);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(201);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(fake.listCalls("createInlineReviewComment")).toEqual([
      expect.objectContaining({
        credential: { kind: "reviewer", token: ROTATED_ACCESS_TOKEN },
      }),
    ]);
  });

  it("401s a second rejection after the renewal budget is spent", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    fake.rejectToken(ACCESS_TOKEN);
    fake.rejectToken(ROTATED_ACCESS_TOKEN);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(401);
    expect(gate.tokenRefreshes()).toBe(1);
  });

  it("evicts cached PR conversations after posting a comment", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);

    const conversationPath = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/conversation`;
    const get = async () =>
      await app.request(conversationPath, {
        headers: { cookie: `__Host-mergebrief_session=${cookie}` },
      });

    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    // Second read served from the cache, the TTL is warm.
    expect(fake.listCalls("fetchPullRequestConversation")).toHaveLength(1);

    const posted = await post(app, cookie, named(draftId));
    expect(posted.status).toBe(201);

    // The post evicted the entry: the next read reaches GitHub again.
    expect((await get()).status).toBe(200);
    expect(fake.listCalls("fetchPullRequestConversation")).toHaveLength(2);
  });

  describe("the draft the request names", () => {
    it("400s a payload that names no draft, and a malformed one", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      expect((await post(app, cookie, "{not json")).status).toBe(400);
      expect((await post(app, cookie, { draftId: "x" })).status).toBe(400);
      expect(listCallsPastGate(fake)).toEqual([]);
    });

    it("404s a draft this session does not hold, no GitHub write", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedDraft(harness.handle);
      const res = await post(app, cookie, named(987654321n));
      expect(res.status).toBe(404);
      expect(countPosts(fake)).toBe(0);
    });

    it("409 draft-already-published on a repeat, no second GitHub write", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(
        harness.handle,
        "already there",
        DraftCommentStatuses.SUBMITTED,
      );

      const res = await post(app, cookie, named(draftId));
      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-already-published");
      expect(countPosts(fake)).toBe(0);
    });

    it("409 draft-anchor-orphaned on an orphaned anchor, no GitHub call", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(
        harness.handle,
        "stale anchor",
        DraftCommentStatuses.DRAFT,
        AnchorStatuses.ORPHANED,
      );

      const res = await post(app, cookie, named(draftId));
      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-anchor-orphaned");
      expect(res.headers.get("cache-control")).toBe("no-store");
      // Refused before the fresh re-resolve: only the gate's pass ran.
      expect(listCallsPastGate(fake)).toEqual([]);
      // The draft is still held, nothing is dropped for the reviewer.
      const rows = await harness.raw(
        "select status from review_draft_comment order by id",
      );
      expect(rows[0]?.["status"]).toBe(DraftCommentStatuses.DRAFT);
    });

    it("a moved anchor is not orphaned, it posts at its carried coordinates", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(
        harness.handle,
        "moved note",
        DraftCommentStatuses.DRAFT,
        AnchorStatuses.MOVED,
      );

      expect((await post(app, cookie, named(draftId))).status).toBe(201);
      expect(countPosts(fake)).toBe(1);
    });

    it("409s a frozen session before spending a GitHub call", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);
      await freezeWithNewerBrief(harness.handle);

      const res = await post(app, cookie, named(draftId));
      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("pr-changed-since-read");
      expect(listCallsPastGate(fake)).toEqual([]);
    });

    it("flips the published draft to submitted", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);

      expect((await post(app, cookie, named(draftId))).status).toBe(201);

      const rows = await harness.raw(
        "select status from review_draft_comment order by id",
      );
      expect(rows[0]?.["status"]).toBe(DraftCommentStatuses.SUBMITTED);
    });

    it("records the wrapping review id on the session", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);

      const res = await post(app, cookie, named(draftId));
      expect(res.status).toBe(201);
      const { reviewId } = await readPostedIds(res);

      const rows = await harness.raw(
        "select github_review_id from review_submitted_review",
      );
      expect(rows.map((row) => String(row["github_review_id"]))).toEqual([
        String(reviewId),
      ]);
    });

    it("logs a plain error, not audit.fail, when the flip fails after the post", async () => {
      // `audit.fail` names an audit ROW that would not persist; raising it for
      // a session-row flip alerts the operator on the wrong thing.
      const capture = testLogging();
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);
      // Reads still work; only the publication flip is refused.
      await harness.raw(
        "alter table review_draft_comment add constraint no_publish " +
          "check (status <> 'submitted')",
      );

      const res = await post(buildCaptureApp(capture), cookie, named(draftId));

      expect(res.status).toBe(201);
      const line = capture
        .lines()
        .find(
          (l) => l["msg"] === "draft stayed unpublished after a posted comment",
        );
      expect(line?.["level"]).toBe("error");
      expect(line?.["evt"]).toBeUndefined();
      expect(capture.lines().some((l) => l["evt"] === "audit.fail")).toBe(
        false,
      );
      await harness.raw(
        "alter table review_draft_comment drop constraint no_publish",
      );
    });
  });

  describe("the claim a post-now holds", () => {
    const IN_DOUBT_AGE_MS = PUBLISH_CLAIM_LEASE_MS + 60_000;
    const VIEWER_ID = BigInt(REVIEWER_ID);

    async function readDraftRow(): Promise<{
      status: unknown;
      claim: unknown;
    }> {
      const rows = await harness.raw(
        "select status, publish_claim from review_draft_comment order by id",
      );
      return { status: rows[0]?.["status"], claim: rows[0]?.["publish_claim"] };
    }

    /** A publish attempt on `draftId` that started `ageMs` ago. */
    async function stubClaim(
      briefId: BriefRowId,
      draftId: bigint,
      ageMs: number,
    ): Promise<Date> {
      const now = new Date(Date.now() - ageMs);
      const claimed = await createTenantRepository(
        harness.handle,
        CTX,
      ).reviewSessions.claimDrafts(
        { briefId, reviewerId: REVIEWER },
        { draftIds: [draftId], now },
      );
      if (!claimed.ok) {
        throw new Error("claim seed failed");
      }
      return now;
    }

    async function readDraftRows(): Promise<
      Array<{ status: unknown; claim: unknown }>
    > {
      const rows = await harness.raw(
        "select status, publish_claim from review_draft_comment order by id",
      );
      return rows.map((row) => ({
        status: row["status"],
        claim: row["publish_claim"],
      }));
    }

    /** A Submit that claimed every one of `draftIds` and never reported back. */
    async function stubSubmitClaim(
      briefId: BriefRowId,
      draftIds: readonly bigint[],
    ): Promise<void> {
      const claimed = await createTenantRepository(
        harness.handle,
        CTX,
      ).reviewSessions.claimDrafts(
        { briefId, reviewerId: REVIEWER },
        { draftIds, now: new Date(Date.now() - IN_DOUBT_AGE_MS) },
      );
      if (!claimed.ok) {
        throw new Error("claim seed failed");
      }
    }

    /** A review the viewer submitted just now. */
    function makeSubmittedReview(body = ""): FakeReview {
      return {
        reviewId: 778n,
        reviewNodeId: "PRR_submitted",
        state: "COMMENTED",
        body,
        authorId: VIEWER_ID,
        submittedAt: new Date(),
      };
    }

    /** The viewer's pending review holding comment 777. */
    function makePendingReview(): FakeReview {
      return {
        reviewId: 778n,
        reviewNodeId: "PRR_pending",
        state: "PENDING",
        body: "",
        authorId: VIEWER_ID,
      };
    }

    /** The posted draft as GitHub lists it, by `authorId`. */
    function makeListedComment(authorId = VIEWER_ID): ListedReviewComment {
      return {
        commentId: 777n,
        reviewId: 778n,
        authorId,
        path: "src/index.ts",
        body: "post now",
        subjectType: "line",
        line: 12,
        side: "RIGHT",
        startLine: 10,
        startSide: "RIGHT",
      };
    }

    async function editDraft(cookie: string, draftId: bigint) {
      return app.request(
        `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session/comments/${String(draftId)}?base=${BASE_SHA}&head=${COMMIT_ID}`,
        {
          method: "PATCH",
          headers: {
            ...SAME_ORIGIN_HEADERS,
            "content-type": "application/json",
            cookie: `__Host-mergebrief_session=${cookie}`,
          },
          body: JSON.stringify({ body: "edited" }),
        },
      );
    }

    async function deleteDraft(cookie: string, draftId: bigint) {
      return app.request(
        `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session/comments/${String(draftId)}?base=${BASE_SHA}&head=${COMMIT_ID}`,
        {
          method: "DELETE",
          headers: {
            ...SAME_ORIGIN_HEADERS,
            cookie: `__Host-mergebrief_session=${cookie}`,
          },
        },
      );
    }

    it("saves the claim before GitHub is called", async () => {
      let claimedAtCall: unknown;
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);
      const watched = buildOverriddenApp((client) => ({
        async createInlineReviewComment(input) {
          claimedAtCall = (await readDraftRow()).claim;
          return client.createInlineReviewComment(input);
        },
      }));

      expect((await post(watched, cookie, named(draftId))).status).toBe(201);

      expect(typeof claimedAtCall).toBe("string");
    });

    it("settles a posted draft: submitted, claim cleared", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);

      expect((await post(app, cookie, named(draftId))).status).toBe(201);

      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.SUBMITTED,
        claim: null,
      });
    });

    it("releases the claim when GitHub refuses the comment", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      fake.failOn("createInlineReviewComment", FakeFailures.ANCHOR_REJECTED);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);

      expect((await post(app, cookie, named(draftId))).status).toBe(409);

      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.DRAFT,
        claim: null,
      });
      expect((await editDraft(cookie, draftId)).status).toBe(204);
    });

    it("releases the claim when the fresh re-resolve is refused", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);
      await cacheGatePass(cookie);
      fake.failOn("fetchRepositoryById", FakeFailures.FORBIDDEN);

      expect((await post(app, cookie, named(draftId))).status).toBe(404);

      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.DRAFT,
        claim: null,
      });
    });

    it("keeps the claim when GitHub's answer is unknown", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      fake.failOn("createInlineReviewComment", FakeFailures.SERVER_ERROR);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);

      expect((await post(app, cookie, named(draftId))).status).toBe(502);

      const row = await readDraftRow();
      expect(row.status).toBe(DraftCommentStatuses.DRAFT);
      expect(typeof row.claim).toBe("string");
      const edited = await editDraft(cookie, draftId);
      expect(edited.status).toBe(409);
      expect(await readWireCode(edited)).toBe("draft-publish-pending");
    });

    it("409s a second post-now while the first is pending", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, 0);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-publish-pending");
      expect(listCallsPastGate(fake)).toEqual([]);
    });

    it("settles an in-doubt draft GitHub already holds, posting nothing", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake, { listed: [makeListedComment()] });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      const claimedAt = await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ commentId: 777, reviewId: 778 });
      expect(countPosts(fake)).toBe(0);
      const [listing] = fake.listCalls("listReviewCommentsSince");
      expect(listing?.input).toMatchObject({ since: expect.any(Date) });
      const since = readSince(listing?.input);
      expect(since.getTime()).toBeLessThanOrEqual(
        claimedAt.getTime() - IN_DOUBT_LOOKUP_MARGIN_MS,
      );
      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.SUBMITTED,
        claim: null,
      });
    });

    it("looks for an in-doubt draft on the viewer's token alone", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake, { listed: [makeListedComment()] });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      expect((await post(app, cookie, named(draftId))).status).toBe(201);

      const lookups = [
        ...fake.listCalls("listReviewsByAuthor"),
        ...fake.listCalls("listReviewCommentsSince"),
      ];
      expect(lookups.map((call) => call.credential)).toEqual([
        { kind: "reviewer", token: ACCESS_TOKEN },
        { kind: "reviewer", token: ACCESS_TOKEN },
      ]);
    });

    it("settles an in-doubt draft whose comment a later push moved", async () => {
      const moved: ListedReviewComment = {
        ...makeListedComment(),
        line: 15,
        startLine: 13,
        originalLine: 12,
        originalStartLine: 10,
      };
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake, { listed: [moved] });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ commentId: 777, reviewId: 778 });
      expect(countPosts(fake)).toBe(0);
      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.SUBMITTED,
        claim: null,
      });
    });

    it("409s already-published when a claim sibling is on GitHub", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake, { listed: [makeListedComment()] });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId: landed } = await seedDraft(harness.handle);
      const folded = await writeDraft(
        harness.handle,
        briefId,
        {
          kind: CommentAnchorKinds.LINE,
          file: "src/other.ts",
          side: DiffSides.NEW,
          startLine: 3,
          endLine: 3,
        },
        "folded into the review body",
      );
      await stubSubmitClaim(briefId, [landed, folded]);

      const res = await post(app, cookie, named(folded));

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-already-published");
      expect(countPosts(fake)).toBe(0);
      expect(await readDraftRows()).toEqual([
        { status: DraftCommentStatuses.SUBMITTED, claim: null },
        { status: DraftCommentStatuses.SUBMITTED, claim: null },
      ]);
    });

    it("409s in-doubt when a review since holds the draft folded", async () => {
      const folded = [
        "1 of 2 comments could not be anchored to the diff:",
        "**`src/index.ts:10-12`**",
        "first line\r\nsecond line",
      ].join("\r\n\r\n");
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake, { reviews: [makeSubmittedReview(folded)] });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(
        harness.handle,
        "first line\nsecond line",
      );
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-publish-in-doubt");
      expect(countPosts(fake)).toBe(0);
      expect(typeof (await readDraftRow()).claim).toBe("string");
    });

    it("posts once when the only review since is a post-now's wrapper", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake, { reviews: [makeSubmittedReview()] });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(201);
      expect(countPosts(fake)).toBe(1);
      expect(countFreshReads(fake)).toBe(1);
      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.SUBMITTED,
        claim: null,
      });
    });

    it("409s in-doubt when the draft sits in the viewer's pending review", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake, {
        reviews: [makePendingReview()],
        listed: [makeListedComment()],
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-publish-in-doubt");
      expect(countPosts(fake)).toBe(0);
      const row = await readDraftRow();
      expect(row.status).toBe(DraftCommentStatuses.DRAFT);
      expect(typeof row.claim).toBe("string");
      const edited = await editDraft(cookie, draftId);
      expect(edited.status).toBe(409);
      expect(await readWireCode(edited)).toBe("draft-publish-in-doubt");
    });

    it("409s in-doubt when the viewer's reviews cannot be read", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      fake.failOn("listReviewsByAuthor", FakeFailures.FORBIDDEN);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-publish-in-doubt");
      expect(countPosts(fake)).toBe(0);
      expect(typeof (await readDraftRow()).claim).toBe("string");
    });

    it("posts an in-doubt draft once when GitHub does not hold it", async () => {
      // The same words on the same lines, but another reviewer's comment.
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake, { listed: [makeListedComment(VIEWER_ID + 1n)] });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        commentId: expect.any(Number),
        reviewId: expect.any(Number),
      });
      expect(countPosts(fake)).toBe(1);
      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.SUBMITTED,
        claim: null,
      });
    });

    it("409s draft-publish-in-doubt when the check cannot list comments", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      fake.failOn("listReviewCommentsSince", FakeFailures.FORBIDDEN);
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-publish-in-doubt");
      expect(countPosts(fake)).toBe(0);
      expect(typeof (await readDraftRow()).claim).toBe("string");
    });

    it("deletes an in-doubt draft on the reviewer's word", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      expect((await deleteDraft(cookie, draftId)).status).toBe(204);

      const rows = await harness.raw("select id from review_draft_comment");
      expect(rows).toEqual([]);
    });
  });
});
