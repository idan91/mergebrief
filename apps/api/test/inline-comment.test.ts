// Inline-comment route integration tests: `app.request()` against `createApp`
// over the PGlite harness, GitHub stubbed at the global-fetch boundary (same
// pattern as mark-ready.test.ts).
import { randomBytes } from "node:crypto";
import {
  AnchorStatuses,
  createArtifactStore,
  DraftCommentSides,
  DraftCommentStatuses,
  encryptToken,
  createTenantRepository,
  createGrantAuth,
  PrStates,
  type AppDatabase,
  type BriefRowId,
  type KeyProvider,
  type AnchorStatus,
  type DraftCommentSide,
  type DraftCommentStatus,
} from "persistence";
import { CommentAnchorKinds } from "types/comments";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger, testLogging } from "./logging";
import {
  INSTALLATION_ID,
  KEY_REF,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  buildAuthDeps,
  createKeyProvider,
  hashSha256Hex,
  getRequestUrl,
  answerInstallationRepositories,
} from "./fixtures";

// Not the harness: POST .../comments is on octokit's `triggersNotification`
// list, so consecutive writes are spaced ~3s by module-global Bottleneck
// groups, and the hard-failure case rides the retry ladder on top (measured
// 17.0s). Matches the timeout its two throttle-bound siblings carry.
vi.setConfig({ testTimeout: 30_000 });

const REPO_ID = 424242;
const COMMIT_ID = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };

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
  readonly comments?: (call: number) => Response;
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  repositories: number;
  comments: number;
  token: number;
  readonly commentBodies: Array<Record<string, unknown>>;
  /** Full URL of each comment POST, in order, pins the fresh-slug target. */
  readonly commentUrls: string[];
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = {
    repositories: 0,
    comments: 0,
    token: 0,
    commentBodies: [],
    commentUrls: [],
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
      if (/\/pulls\/\d+\/comments$/.test(url)) {
        const i = counts.comments++;
        counts.commentUrls.push(url);
        const raw =
          init?.body ??
          (input instanceof Request ? await input.text() : undefined);
        if (typeof raw === "string") {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === "object" && parsed !== null)
            counts.commentBodies.push({ ...parsed });
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

async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<{ cookie: string }> {
  const cookie = randomBytes(32).toString("base64url");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok)
    throw new Error("seed encrypt failed");
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  await createTenantRepository(handle, CTX).sessions.create({
    sessionTokenHash: hashSha256Hex(cookie),
    reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return { cookie };
}

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
  startSide: DraftCommentSide | null = null,
): Promise<{ briefId: BriefRowId; draftId: bigint }> {
  const repo = createTenantRepository(handle, CTX);
  const pr = await repo.pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) throw new Error("seedDraft: pr missing");
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
  if (!brief.ok) throw new Error("seedDraft: brief write failed");
  const written = await repo.reviewSessions.writeToSession(
    {
      briefId: brief.value.id,
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      brief: async () => ({ groupIds: [], flags: [], filePaths: [] }),
    },
    (writer) =>
      writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/index.ts",
        side: DraftCommentSides.NEW,
        startSide,
        startLine: 10,
        endLine: 12,
        body,
        status,
        anchorStatus,
      }),
  );
  if (!written.ok) throw new Error("seedDraft: draft write failed");
  return { briefId: brief.value.id, draftId: written.value.id };
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
  if (pr === undefined) throw new Error("seedFileDraft: pr missing");
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
  if (!brief.ok) throw new Error("seedFileDraft: brief write failed");
  const written = await repo.reviewSessions.writeToSession(
    {
      briefId: brief.value.id,
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      brief: async () => ({ groupIds: [], flags: [], filePaths: [] }),
    },
    (writer) =>
      writer.addDraftComment({
        kind: CommentAnchorKinds.FILE,
        filePath: "src/app.ts",
        body,
      }),
  );
  if (!written.ok) throw new Error("seedFileDraft: draft write failed");
  return { briefId: brief.value.id, draftId: written.value.id };
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
  if (pr === undefined) throw new Error("freeze: pr missing");
  const newer = await createArtifactStore(handle, CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: BASE_SHA,
    headSha: "c".repeat(40),
    headIndex: 2,
    commitCount: 2,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: "{}",
  });
  if (!newer.ok) throw new Error("freeze: brief write failed");
  const opened = await repo.reviewSessions.writeToSession(
    {
      briefId: newer.value.id,
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      brief: async () => ({ groupIds: [], flags: [], filePaths: [] }),
    },
    (writer) => writer.putReadMark({ chunkId: "c1" }),
  );
  if (!opened.ok) throw new Error("freeze: newer session failed");
}

async function commentAuditCount(harness: PgliteHarness): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as n from audit_log where target_type = 'review_comment'",
  );
  const n = rows[0]?.["n"];
  if (typeof n !== "number") throw new Error("unexpected count result");
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
    "content-type": "application/json",
  };

  if (cookie !== undefined)
    headers["cookie"] = `__Host-mergebrief_session=${cookie}`;

  return await app.request(path, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
};

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
      github: unusedConversationPort,
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
    const { cookie } = await seedSession(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(404);
    expect(counts.comments).toBe(0);
  });

  it("404s PRs outside the tenant without writing to GitHub", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
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
    const { cookie } = await seedSession(harness.handle, kp);
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
    const { cookie } = await seedSession(harness.handle, kp);
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
    const { cookie } = await seedSession(harness.handle, kp);
    const { draftId } = await seedDraft(
      harness.handle,
      "spans both sides",
      DraftCommentStatuses.DRAFT,
      null,
      DraftCommentSides.OLD,
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
    const { cookie } = await seedSession(harness.handle, kp);
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
    if (body === undefined) throw new Error("expected a posted comment");
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
      github: unusedConversationPort,
    });
    stubGitHub({ repositories: () => repoOk(), comments: () => commentOk() });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
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
    const { cookie } = await seedSession(harness.handle, kp);
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
    const { cookie } = await seedSession(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await commentAuditCount(harness)).toBe(0);
  });

  it("502 on a hard GitHub failure; no audit row", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      comments: () => commentStatus(500),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(502);
    expect(await commentAuditCount(harness)).toBe(0);
  });

  it.each([403, 404])(
    "collapses in-route write denial %i to a uniform 404",
    async (denialStatus) => {
      // Both denial statuses must be indistinguishable from a cold gate 404:
      // a FORBIDDEN (revoked access inside the cache TTL) and a NOT_FOUND
      // (comment target gone) exercise separate mapping branches.
      stubGitHub({
        repositories: () => repoOk(),
        comments: () => commentStatus(denialStatus),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      const { draftId } = await seedDraft(harness.handle);
      const res = await post(app, cookie, named(draftId));
      expect(res.status).toBe(404);
    },
  );

  it("refreshes once after a mid-request write 401 and succeeds", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      comments: (i) => (i === 0 ? commentStatus(401) : commentOk()),
    });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
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
    const { cookie } = await seedSession(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);
    const res = await post(app, cookie, named(draftId));
    expect(res.status).toBe(401);
    expect(counts.token).toBe(1);
  });

  it("evicts cached PR conversations after posting a comment", async () => {
    // Read twice to prove a warm cache, then post and read again within the TTL.
    // The post-write port call proves app-level success wiring evicted the conversation entry.
    let conversationFetches = 0;
    const countingPort = {
      fetchPullRequestConversation: async () => {
        conversationFetches += 1;
        return {
          ok: true as const,
          value: {
            threads: [],
            reviews: [],
            prComments: [],
            hasMoreThreads: false,
            hasMoreReviews: false,
            hasMorePrComments: false,
          },
        };
      },
      listRepoCollaborators: async (): Promise<never> => {
        throw new Error("collaborators port must not be called in this suite");
      },
    };
    const evictionApp = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: countingPort,
    });
    stubGitHub({ repositories: () => repoOk(), comments: () => commentOk() });
    await seedPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const { draftId } = await seedDraft(harness.handle);

    const conversationPath = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/conversation`;
    const get = async () =>
      await evictionApp.request(conversationPath, {
        headers: { cookie: `__Host-mergebrief_session=${cookie}` },
      });

    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    // Second read served from the cache, the TTL is warm.
    expect(conversationFetches).toBe(1);

    const posted = await post(evictionApp, cookie, named(draftId));
    expect(posted.status).toBe(201);

    // The post evicted the entry: the next read reaches the port again.
    expect((await get()).status).toBe(200);
    expect(conversationFetches).toBe(2);
  });

  describe("the draft the request names", () => {
    it("400s a payload that names no draft, and a malformed one", async () => {
      stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      expect((await post(app, cookie, "{not json")).status).toBe(400);
      expect((await post(app, cookie, { draftId: "x" })).status).toBe(400);
    });

    it("404s a draft this session does not hold, no GitHub write", async () => {
      const counts = stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
      await seedDraft(harness.handle);
      const res = await post(app, cookie, named(987654321n));
      expect(res.status).toBe(404);
      expect(counts.comments).toBe(0);
    });

    it("409 draft-already-published on a repeat, no second GitHub write", async () => {
      const counts = stubGitHub({ repositories: () => repoOk() });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
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
      const { cookie } = await seedSession(harness.handle, kp);
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
      const { cookie } = await seedSession(harness.handle, kp);
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
      const { cookie } = await seedSession(harness.handle, kp);
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
      const { cookie } = await seedSession(harness.handle, kp);
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
      const { cookie } = await seedSession(harness.handle, kp);
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
        github: unusedConversationPort,
      });
      stubGitHub({
        repositories: () => repoOk(),
        comments: () => commentOk(),
      });
      await seedPr(harness.handle);
      const { cookie } = await seedSession(harness.handle, kp);
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
});
