// Inline-comment route integration tests: `app.request()` against `createApp`
// over the PGlite harness, GitHub stubbed at the global-fetch boundary (same
// pattern as mark-ready.test.ts).
import {
  createArtifactStore,
  createTenantRepository,
  type AppDatabase,
  type BriefRowId,
  type DraftAnchor,
  type KeyProvider,
  PUBLISH_CLAIM_LEASE_MS,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { ReviewOutcomes } from "types/reviews";
import {
  AnchorStatuses,
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
  type AnchorStatus,
  type DiffSide,
  type DraftCommentStatus,
} from "types/comments";
import {
  createPgliteHarness,
  stampDraftAnchorStatus,
  type PgliteHarness,
} from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeGitHub } from "github/testing";
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
  buildAuthDeps,
  createKeyProvider,
  getRequestUrl,
  answerInstallationRepositories,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import { seedSignIn } from "./sign-in";
import {
  UNUSED_INSTALLATION_DEPS,
  arrangeFakePullRequest,
  buildFakeInstallationDeps,
} from "./reviewer-github";

const REPO_ID = 424242;
const COMMIT_ID = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };
const REVIEWER = brandReviewerId(BigInt(REVIEWER_ID));

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch): REST /repositories/:id + the comment POST.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}
function repoOk(): Response {
  return jsonResponse({ id: REPO_ID, full_name: REPO_SLUG, private: true });
}
function repoStatus(status: number): Response {
  return jsonResponse({ message: "denied" }, status);
}
function commentOk(): Response {
  return jsonResponse({ id: 999, pull_request_review_id: 555 }, 201);
}
function commentStatus(status: number): Response {
  return jsonResponse({ message: "nope" }, status);
}
function tokenSuccess(): Response {
  return jsonResponse({
    access_token: ROTATED_ACCESS,
    refresh_token: ROTATED_REFRESH,
    expires_in: 28_800,
    refresh_token_expires_in: 15_897_600,
    token_type: "bearer",
    scope: "",
  });
}

interface StubConfig {
  readonly repositories?: (call: number) => Response;
  readonly comments?: (call: number) => Response | Promise<Response>;
  readonly listComments?: (call: number) => Response;
  readonly listReviews?: (call: number) => Response;
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  repositories: number;
  comments: number;
  listComments: number;
  listReviews: number;
  token: number;
  readonly commentBodies: Array<Record<string, unknown>>;
  /** Full URL of each comment POST, in order, pins the fresh-slug target. */
  readonly commentUrls: string[];
  /** Full URL of each review-comment list GET, in order. */
  readonly listUrls: string[];
}

const COMMENT_LIST_PATH = /\/pulls\/\d+\/comments(\?|$)/;
const REVIEW_LIST_PATH = /\/pulls\/\d+\/reviews(\?|$)/;

function readMethod(input: string | URL | Request, init?: RequestInit): string {
  if (init?.method !== undefined) {
    return init.method.toUpperCase();
  }
  if (input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = {
    repositories: 0,
    comments: 0,
    listComments: 0,
    listReviews: 0,
    token: 0,
    commentBodies: [],
    commentUrls: [],
    listUrls: [],
  };
  const fetchFn = vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = getRequestUrl(input);
      if (url.includes("/login/oauth/access_token")) {
        const i = counts.token++;
        return cfg.token
          ? cfg.token(i)
          : jsonResponse({ error: "unexpected_token" }, 500);
      }
      const membership = answerInstallationRepositories(url, [REPO_ID]);
      if (membership !== undefined) {
        return membership;
      }
      if (url.includes("/repositories/")) {
        const i = counts.repositories++;
        return cfg.repositories ? cfg.repositories(i) : repoStatus(404);
      }
      if (COMMENT_LIST_PATH.test(url) && readMethod(input, init) === "GET") {
        const i = counts.listComments++;
        counts.listUrls.push(url);
        return cfg.listComments
          ? cfg.listComments(i)
          : jsonResponse({ message: "unexpected" }, 500);
      }
      if (REVIEW_LIST_PATH.test(url) && readMethod(input, init) === "GET") {
        const i = counts.listReviews++;
        return cfg.listReviews
          ? cfg.listReviews(i)
          : jsonResponse({ message: "unexpected" }, 500);
      }
      if (/\/pulls\/\d+\/comments$/.test(url)) {
        const i = counts.comments++;
        counts.commentUrls.push(url);
        const raw =
          init?.body ??
          (input instanceof Request ? await input.text() : undefined);
        if (typeof raw === "string") {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === "object" && parsed !== null) {
            counts.commentBodies.push({ ...parsed });
          }
        }
        return cfg.comments
          ? cfg.comments(i)
          : jsonResponse({ message: "unexpected" }, 500);
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return counts;
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
  if (!brief.ok) {
    throw new Error("seedDraft: brief write failed");
  }
  const line = {
    kind: CommentAnchorKinds.LINE,
    file: "src/index.ts",
    side: DiffSides.NEW,
    startLine: 10,
    endLine: 12,
  };
  const anchor: DraftAnchor =
    startSide === null ? line : { ...line, startSide };
  const draftId = await writeDraft(handle, brief.value.id, anchor, body);
  if (status === DraftCommentStatuses.SUBMITTED) {
    await createTenantRepository(
      handle,
      CTX,
    ).reviewSessions.recordPublishedDrafts(
      { briefId: brief.value.id, reviewerId: REVIEWER },
      { draftIds: [draftId] },
    );
  }
  if (anchorStatus !== null) {
    await stampDraftAnchorStatus(handle, draftId, anchorStatus);
  }
  return { briefId: brief.value.id, draftId };
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
  if (!brief.ok) {
    throw new Error("seedFileDraft: brief write failed");
  }
  const draftId = await writeDraft(
    handle,
    brief.value.id,
    { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
    body,
  );
  return { briefId: brief.value.id, draftId };
}

/** The wire code an error response carries. */
async function readWireCode(res: Response): Promise<string> {
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || !("code" in body)) {
    throw new Error("no wire code on the response");
  }
  return String(body.code);
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
  if (!newer.ok) {
    throw new Error("freeze: brief write failed");
  }
  const opened = await repo.reviewSessions.setOutcome(
    { briefId: newer.value.id, reviewerId: REVIEWER },
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

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  it("401s absent session cookies without calling GitHub", async () => {
    const counts = stubGitHub({});
    const res = await post(app, undefined, named(1n));
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(0);
    expect(counts.comments).toBe(0);
  });

  it("404 collapse when the viewer has no access to the repo", async () => {
    const counts = stubGitHub({ repositories: () => repoStatus(403) });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(404);
    expect(counts.comments).toBe(0);
  });

  it("404s PRs outside the tenant without writing to GitHub", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await post(app, cookie, named(1n));
    expect(res.status).toBe(404);
    expect(counts.comments).toBe(0);
  });

  it("404s a denied fresh repo resolution after the gate passes", async () => {
    // The gate's access check (call 0) passes; the route's own fresh
    // fetchRepositoryById (call 1) is denied, a viewer whose access was
    // revoked inside the positive-cache TTL. Must collapse to the gate's 404
    // posture and post nothing.
    const counts = stubGitHub({
      repositories: (i) => (i === 0 ? repoOk() : repoStatus(403)),
      comments: () => commentOk(),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(404);
    expect(counts.repositories).toBe(2);
    expect(counts.comments).toBe(0);
    expect(await commentAuditCount(harness)).toBe(0);
  });

  it("201 happy path: posts to the FRESH slug, returns ids, audits, no-store", async () => {
    const counts = stubGitHub({
      // Gate caches octo/hello; the route's own fresh resolve renames it,
      // the comment POST must target the fresh owner/name, never the stale slug.
      repositories: (i) =>
        i === 0
          ? repoOk()
          : jsonResponse({
              id: REPO_ID,
              full_name: "octo/renamed",
              private: true,
            }),
      comments: () => commentOk(),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);

    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ commentId: 999, reviewId: 555 });
    expect(counts.comments).toBe(1);
    // Single-gate pin: exactly the gate's access check + the route's own
    // fresh resolve, a third repositories call would mean a stacked gate.
    expect(counts.repositories).toBe(2);
    // The POST url carried the FRESHLY-resolved repo name, never the gate's
    // cached (renamed-away) slug.
    expect(counts.commentUrls[0]).toContain("/repos/octo/renamed/pulls/");
    expect(counts.commentUrls[0]).not.toContain("octo/hello");
    // Pinned commit + the multi-line anchor on the wire body.
    const body = counts.commentBodies[0];
    expect(body).toMatchObject({
      commit_id: COMMIT_ID,
      path: "src/index.ts",
      line: 12,
      side: "RIGHT",
      start_line: 10,
      start_side: "RIGHT",
      body: "post now",
    });
    expect(await commentAuditCount(harness)).toBe(1);
  });

  it("maps a two-side draft's start leg to GitHub's LEFT", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      comments: () => commentOk(),
    });
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
    expect(counts.commentBodies[0]).toMatchObject({
      path: "src/index.ts",
      line: 12,
      side: "RIGHT",
      start_line: 10,
      start_side: "LEFT",
      body: "spans both sides",
    });
  });

  it("posts a File comment with subject_type file and no line", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      comments: () => commentOk(),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedFileDraft(harness.handle);

    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(201);
    const body = counts.commentBodies[0];
    expect(body).toEqual({
      commit_id: COMMIT_ID,
      path: "src/app.ts",
      body: "post now",
      subject_type: "file",
    });
    if (body === undefined) {
      throw new Error("expected a posted comment");
    }
    expect("line" in body).toBe(false);
    expect("side" in body).toBe(false);
    expect("start_line" in body).toBe(false);
    expect("start_side" in body).toBe(false);
  });

  it("keeps 201 and logs audit.fail when post-commit auditing fails", async () => {
    const capture = testLogging();
    const captureApp = createApp({
      logger: capture.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...UNUSED_INSTALLATION_DEPS,
    });
    stubGitHub({ repositories: () => repoOk(), comments: () => commentOk() });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    // Poison ONLY the audit write: the GitHub post has already committed by
    // the time the audit insert runs, so the response must stay a 201.
    await harness.raw("alter table audit_log rename to audit_log_poisoned");

    const res = await post(captureApp, cookie, named(draftId));
    expect(res.status).toBe(201);
    const line = capture.lines().find((l) => l["evt"] === "audit.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["operation"]).toBe("create-inline-comment");
    expect(line?.["err"]).toBeDefined();
  });

  it("201 with reviewId omitted when GitHub assigns no wrapping review id", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      comments: () =>
        jsonResponse({ id: 999, pull_request_review_id: null }, 201),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ commentId: 999 });
  });

  it("409s stale anchors when GitHub rejects the pinned head with 422", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      comments: () => commentStatus(422),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await commentAuditCount(harness)).toBe(0);
  });

  it("502s a hard GitHub failure after one comment call, no audit row", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      comments: () => commentStatus(500),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(502);
    expect(counts.comments).toBe(1);
    expect(await commentAuditCount(harness)).toBe(0);
  });

  it("answers 404 when the comment target is gone", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      comments: () => commentStatus(404),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(404);
  });

  it("answers an honest 403 when GitHub forbids the comment", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      comments: () => commentStatus(403),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(403);
    expect(await readWireCode(res)).toBe("github-permission");
  });

  it("refreshes once after a mid-request write 401 and succeeds", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      comments: (i) => (i === 0 ? commentStatus(401) : commentOk()),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(201);
    expect(counts.token).toBe(1);
    expect(counts.comments).toBe(2);
  });

  it("401s a second write rejection after the refresh budget is spent", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      comments: () => commentStatus(401),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(401);
    expect(counts.token).toBe(1);
  });

  it("evicts cached PR conversations after posting a comment", async () => {
    // Read twice to prove a warm cache, then post and read again within the TTL.
    // The post-write read proves app-level success wiring evicted the entry.
    const fake = makeFakeGitHub();
    arrangeFakePullRequest(fake, { repoId: REPO_ID });
    const evictionApp = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      ...buildFakeInstallationDeps(fake),
    });
    stubGitHub({ repositories: () => repoOk(), comments: () => commentOk() });
    await seedPr(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);

    const conversationPath = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/conversation`;
    const get = async () =>
      await evictionApp.request(conversationPath, {
        headers: { cookie: `__Host-mergebrief_session=${cookie}` },
      });

    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    // Second read served from the cache, the TTL is warm.
    expect(fake.listCalls("fetchPullRequestConversation")).toHaveLength(1);

    const posted = await post(evictionApp, cookie, named(draftId));
    expect(posted.status).toBe(201);

    // The post evicted the entry: the next read reaches GitHub again.
    expect((await get()).status).toBe(200);
    expect(fake.listCalls("fetchPullRequestConversation")).toHaveLength(2);
  });

  describe("the draft the request names", () => {
    it("400s a payload that names no draft, and a malformed one", async () => {
      stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      expect((await post(app, cookie, "{not json")).status).toBe(400);
      expect((await post(app, cookie, { draftId: "x" })).status).toBe(400);
    });

    it("404s a draft this session does not hold, no GitHub write", async () => {
      const counts = stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedDraft(harness.handle);
      const res = await post(app, cookie, named(987654321n));
      expect(res.status).toBe(404);
      expect(counts.comments).toBe(0);
    });

    it("409 draft-already-published on a repeat, no second GitHub write", async () => {
      const counts = stubGitHub({ repositories: () => repoOk() });
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
      expect(counts.comments).toBe(0);
    });

    it("409 draft-anchor-orphaned on an orphaned anchor, no GitHub write", async () => {
      const counts = stubGitHub({ repositories: () => repoOk() });
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
      // Refused before the fresh re-resolve: only the gate's lookup ran.
      expect(counts.repositories).toBe(1);
      expect(counts.comments).toBe(0);
      // The draft is still held, nothing is dropped for the reviewer.
      const rows = await harness.raw(
        "select status from review_draft_comment order by id",
      );
      expect(rows[0]?.["status"]).toBe(DraftCommentStatuses.DRAFT);
    });

    it("a moved anchor is not orphaned, it posts at its carried coordinates", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(
        harness.handle,
        "moved note",
        DraftCommentStatuses.DRAFT,
        AnchorStatuses.MOVED,
      );

      expect((await post(app, cookie, named(draftId))).status).toBe(201);
      expect(counts.comments).toBe(1);
    });

    it("409s a frozen session BEFORE spending a GitHub call", async () => {
      const counts = stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);
      await freezeWithNewerBrief(harness.handle);

      const res = await post(app, cookie, named(draftId));
      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("pr-changed-since-read");
      expect(counts.comments).toBe(0);
      // Only the gate's own access check ran: the route never reached its
      // fresh re-resolve, let alone the write.
      expect(counts.repositories).toBe(1);
    });

    it("flips the published draft to submitted", async () => {
      stubGitHub({ repositories: () => repoOk(), comments: () => commentOk() });
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
      stubGitHub({ repositories: () => repoOk(), comments: () => commentOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);

      expect((await post(app, cookie, named(draftId))).status).toBe(201);

      const rows = await harness.raw(
        "select github_review_id from review_submitted_review",
      );
      expect(rows.map((row) => String(row["github_review_id"]))).toEqual([
        "555",
      ]);
    });

    it("logs a plain error, not audit.fail, when the flip fails after the post", async () => {
      // `audit.fail` names an audit ROW that would not persist. A session-row
      // publication flip is a different failure, and raising that event for it
      // alerts the operator on the wrong thing, without its catalogued fields.
      const capture = testLogging();
      const captureApp = createApp({
        logger: capture.logger,
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: buildAuthDeps(kp),
        ...UNUSED_INSTALLATION_DEPS,
      });
      stubGitHub({
        repositories: () => repoOk(),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);
      // Reads still work; only the publication flip is refused.
      await harness.raw(
        "alter table review_draft_comment add constraint no_publish " +
          "check (status <> 'submitted')",
      );

      const res = await post(captureApp, cookie, named(draftId));

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

    /** A review the viewer submitted just now, as GitHub lists it. */
    function makeSubmittedReview(body = ""): unknown {
      return {
        id: 778,
        node_id: "PRR_submitted",
        state: "COMMENTED",
        body,
        user: { id: REVIEWER_ID },
        submitted_at: new Date().toISOString(),
      };
    }

    /** The viewer's pending review holding comment 777, as GitHub lists it. */
    function makePendingReview(): unknown {
      return {
        id: 778,
        node_id: "PRR_pending",
        state: "PENDING",
        body: "",
        user: { id: REVIEWER_ID },
      };
    }

    /** The posted draft as GitHub lists it, by `authorId`. */
    function makeListedComment(
      authorId = REVIEWER_ID,
    ): Record<string, unknown> {
      return {
        id: 777,
        pull_request_review_id: 778,
        user: { id: authorId },
        path: "src/index.ts",
        body: "post now",
        subject_type: "line",
        line: 12,
        side: "RIGHT",
        start_line: 10,
        start_side: "RIGHT",
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
      stubGitHub({
        repositories: () => repoOk(),
        comments: async () => {
          claimedAtCall = (await readDraftRow()).claim;
          return commentOk();
        },
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);

      expect((await post(app, cookie, named(draftId))).status).toBe(201);

      expect(typeof claimedAtCall).toBe("string");
    });

    it("settles a posted draft: submitted, claim cleared", async () => {
      stubGitHub({ repositories: () => repoOk(), comments: () => commentOk() });
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
      stubGitHub({
        repositories: () => repoOk(),
        comments: () => commentStatus(422),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);

      expect((await post(app, cookie, named(draftId))).status).toBe(409);

      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.DRAFT,
        claim: null,
      });
      expect((await editDraft(cookie, draftId)).status).toBe(200);
    });

    it("keeps the claim when GitHub's answer is unknown", async () => {
      stubGitHub({
        repositories: () => repoOk(),
        comments: () => commentStatus(504),
      });
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
      const counts = stubGitHub({
        repositories: () => repoOk(),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, 0);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-publish-pending");
      expect(counts.comments).toBe(0);
      expect(counts.repositories).toBe(1);
    });

    it("settles an in-doubt draft GitHub already holds, posting nothing", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        listComments: () => jsonResponse([makeListedComment()]),
        listReviews: () => jsonResponse([]),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      const claimedAt = await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ commentId: 777, reviewId: 778 });
      expect(counts.comments).toBe(0);
      const since = new URL(counts.listUrls[0] ?? "").searchParams.get("since");
      expect(Date.parse(since ?? "")).toBeLessThanOrEqual(
        claimedAt.getTime() - IN_DOUBT_LOOKUP_MARGIN_MS,
      );
      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.SUBMITTED,
        claim: null,
      });
    });

    it("settles an in-doubt draft whose comment a later push moved", async () => {
      const moved = {
        ...makeListedComment(),
        line: 15,
        start_line: 13,
        original_line: 12,
        original_start_line: 10,
      };
      const counts = stubGitHub({
        repositories: () => repoOk(),
        listComments: () => jsonResponse([moved]),
        listReviews: () => jsonResponse([]),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ commentId: 777, reviewId: 778 });
      expect(counts.comments).toBe(0);
      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.SUBMITTED,
        claim: null,
      });
    });

    it("409s already-published when a claim sibling is on GitHub", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        listComments: () => jsonResponse([makeListedComment()]),
        listReviews: () => jsonResponse([]),
        comments: () => commentOk(),
      });
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
      expect(counts.comments).toBe(0);
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
      const counts = stubGitHub({
        repositories: () => repoOk(),
        listComments: () => jsonResponse([]),
        listReviews: () => jsonResponse([makeSubmittedReview(folded)]),
        comments: () => commentOk(),
      });
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
      expect(counts.comments).toBe(0);
      expect(typeof (await readDraftRow()).claim).toBe("string");
    });

    it("posts once when the only review since is a post-now's wrapper", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        listComments: () => jsonResponse([]),
        listReviews: () => jsonResponse([makeSubmittedReview()]),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(201);
      expect(counts.comments).toBe(1);
      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.SUBMITTED,
        claim: null,
      });
    });

    it("409s in-doubt when the draft sits in the viewer's pending review", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        listComments: () => jsonResponse([makeListedComment()]),
        listReviews: () => jsonResponse([makePendingReview()]),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-publish-in-doubt");
      expect(counts.comments).toBe(0);
      const row = await readDraftRow();
      expect(row.status).toBe(DraftCommentStatuses.DRAFT);
      expect(typeof row.claim).toBe("string");
      const edited = await editDraft(cookie, draftId);
      expect(edited.status).toBe(409);
      expect(await readWireCode(edited)).toBe("draft-publish-in-doubt");
    });

    it("409s in-doubt when nothing is listed and reviews cannot be read", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        listComments: () => jsonResponse([]),
        listReviews: () => jsonResponse({ message: "denied" }, 403),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-publish-in-doubt");
      expect(counts.comments).toBe(0);
      expect(typeof (await readDraftRow()).claim).toBe("string");
    });

    it("posts an in-doubt draft once when GitHub does not hold it", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        // The same words on the same lines, but another reviewer's comment.
        listComments: () => jsonResponse([makeListedComment(REVIEWER_ID + 1)]),
        listReviews: () => jsonResponse([]),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ commentId: 999, reviewId: 555 });
      expect(counts.comments).toBe(1);
      expect(await readDraftRow()).toEqual({
        status: DraftCommentStatuses.SUBMITTED,
        claim: null,
      });
    });

    it("409s draft-publish-in-doubt when the check cannot list comments", async () => {
      const counts = stubGitHub({
        repositories: () => repoOk(),
        listComments: () => jsonResponse({ message: "denied" }, 403),
        listReviews: () => jsonResponse([]),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      const res = await post(app, cookie, named(draftId));

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-publish-in-doubt");
      expect(counts.comments).toBe(0);
      expect(typeof (await readDraftRow()).claim).toBe("string");
    });

    it("deletes an in-doubt draft on the reviewer's word", async () => {
      stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const { briefId, draftId } = await seedDraft(harness.handle);
      await stubClaim(briefId, draftId, IN_DOUBT_AGE_MS);

      expect((await deleteDraft(cookie, draftId)).status).toBe(200);

      const rows = await harness.raw("select id from review_draft_comment");
      expect(rows).toEqual([]);
    });
  });
});
