// Submit-route integration tests: `app.request()` against `createApp` over the
// PGlite harness, GitHub stubbed at the global-fetch boundary. Pins that the
// route never writes the checkpoint, the webhook is its only writer.
import { randomBytes } from "node:crypto";
import {
  AnchorStatuses,
  createArtifactStore,
  DraftCommentSides,
  encryptToken,
  createTenantRepository,
  createGrantAuth,
  PrStates,
  type AppDatabase,
  type BriefRowId,
  type KeyProvider,
  type AnchorStatus,
} from "persistence";
import { CommentAnchorKinds } from "types/comments";
import type * as GithubModule from "github";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
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

// Nothing in this file reaches GitHub, so octokit's one-mutation-per-second
// pacing buys no safety and would only stretch every landing case.
vi.mock("github", async (importOriginal) => {
  const actual = await importOriginal<typeof GithubModule>();
  return {
    ...actual,
    createUserOctokit: (
      token: string,
      options?: GithubModule.UserOctokitOptions,
    ) => actual.createUserOctokit(token, { ...options, throttle: false }),
  };
});

// Headroom for the PGlite harness; fake clocks stay out, they poison octokit.
vi.setConfig({ testTimeout: 30_000 });

const REPO_ID = 424242;
const COMMIT_ID = "c".repeat(40);
const BASE_SHA = "d".repeat(40);

const REVIEW_ID = 987001;
const REVIEW_NODE_ID = "PRR_kwDOpending";
const STALE_REVIEW_ID = 987000;

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch), dispatches on method plus URL, counts calls.
// ---------------------------------------------------------------------------

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

function makeRepoOk(): Response {
  return makeJsonResponse({ id: REPO_ID, full_name: REPO_SLUG, private: true });
}
function makeRepoStatus(status: number): Response {
  return makeJsonResponse({ message: "denied" }, status);
}
function makePendingReview(id = REVIEW_ID, nodeId = REVIEW_NODE_ID): Response {
  return makeJsonResponse({ id, node_id: nodeId }, 201);
}
function makeReviewStatus(
  status: number,
  body: unknown = { message: "denied" },
): Response {
  return makeJsonResponse(body, status);
}
function makePendingExists422(): Response {
  return makeReviewStatus(422, {
    message: "Validation Failed",
    errors: ["User can only have one pending review per pull request"],
  });
}
function makeUnknownCommit422(): Response {
  return makeReviewStatus(422, {
    message: "Validation Failed",
    errors: [
      { resource: "PullRequestReview", code: "invalid", field: "commit_id" },
    ],
  });
}
function makeReviewList(entries: readonly unknown[]): Response {
  return makeJsonResponse(entries);
}
function makeStalePendingEntry(): unknown {
  return { id: STALE_REVIEW_ID, node_id: "PRR_kwDOstale", state: "PENDING" };
}
function makeOwnPendingEntry(): unknown {
  return { id: REVIEW_ID, node_id: REVIEW_NODE_ID, state: "PENDING" };
}
function makeOwnPublishedEntry(): unknown {
  return { id: REVIEW_ID, node_id: REVIEW_NODE_ID, state: "COMMENTED" };
}
function makeThreadCreated(id = "PRRT_1"): Response {
  return makeJsonResponse({
    data: { addPullRequestReviewThread: { thread: { id } } },
  });
}
// GitHub declines an anchor either as HTTP 200 with a null thread or as an
// errors array typed UNPROCESSABLE; both fold.
function makeThreadRejected(): Response {
  return makeJsonResponse({
    data: { addPullRequestReviewThread: { thread: null } },
  });
}
function makeThreadRejectedByError(): Response {
  return makeJsonResponse({
    data: { addPullRequestReviewThread: null },
    errors: [
      {
        type: "UNPROCESSABLE",
        path: ["addPullRequestReviewThread"],
        message: "pull_request_review_thread.line must be part of the diff",
      },
    ],
  });
}
function makeReviewCommentCount(totalCount: number): Response {
  return makeJsonResponse({ data: { node: { comments: { totalCount } } } });
}
function makeSubmitAccepted(id = "PRR_kwDOsubmitted"): Response {
  return makeJsonResponse({
    data: { submitPullRequestReview: { pullRequestReview: { id } } },
  });
}
// HTTP 200 plus an errors array: a 5xx would be retried by octokit's plugin.
function makeGraphqlFailure(): Response {
  return makeJsonResponse({
    data: null,
    errors: [{ type: "INTERNAL", message: "boom" }],
  });
}
function makeGraphqlUnauthorized(): Response {
  return makeJsonResponse({ message: "Bad credentials" }, 401);
}
function makeTokenSuccess(): Response {
  return makeJsonResponse({
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
  readonly createReview?: (call: number) => Response;
  readonly listReviews?: (call: number) => Response;
  readonly reviewCommentCount?: (call: number) => Response;
  readonly deleteReview?: (call: number) => Response;
  readonly thread?: (call: number) => Response;
  readonly submitReview?: (call: number) => Response;
  readonly token?: (call: number) => Response;
}

type MutationInput = Record<string, unknown>;

interface StubCounts {
  repositories: number;
  createReview: number;
  listReviews: number;
  reviewCommentCount: number;
  deleteReview: number;
  thread: number;
  submitReview: number;
  token: number;
  /** Parsed JSON body of each create-review POST, in order. */
  readonly createBodies: unknown[];
  /** URL of each create-review POST, in order, pins the target repo slug. */
  readonly createUrls: string[];
  /** `variables.input` of each thread mutation, in draft order. */
  readonly threadInputs: MutationInput[];
  /** `variables.input` of each submit mutation, in order. */
  readonly submitInputs: MutationInput[];
  /** URL of each pending-review DELETE, in order. */
  readonly deleteUrls: string[];
}

const REVIEW_LIST_PATH = /\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews(\?|$)/;
const REVIEW_ITEM_PATH = /\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews\/\d+$/;

const graphqlQuerySchema = z.object({ query: z.string() });
const graphqlBodySchema = z.object({
  query: z.string(),
  variables: z.object({ input: z.record(z.string(), z.unknown()) }),
});

function readMethod(input: string | URL | Request, init?: RequestInit): string {
  if (init?.method !== undefined) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

async function readRequestBody(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<unknown> {
  const raw =
    init?.body ?? (input instanceof Request ? await input.text() : undefined);
  if (typeof raw !== "string") return undefined;
  return JSON.parse(raw);
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = {
    repositories: 0,
    createReview: 0,
    listReviews: 0,
    reviewCommentCount: 0,
    deleteReview: 0,
    thread: 0,
    submitReview: 0,
    token: 0,
    createBodies: [],
    createUrls: [],
    threadInputs: [],
    submitInputs: [],
    deleteUrls: [],
  };

  async function answerGraphql(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const body = await readRequestBody(input, init);
    const routed = graphqlQuerySchema.safeParse(body);
    if (
      routed.success &&
      routed.data.query.includes("PullRequestReviewCommentCount")
    ) {
      const i = counts.reviewCommentCount++;
      return cfg.reviewCommentCount
        ? cfg.reviewCommentCount(i)
        : makeReviewCommentCount(0);
    }
    const parsed = graphqlBodySchema.safeParse(body);
    if (!parsed.success) {
      return makeJsonResponse({ message: "unreadable graphql body" }, 400);
    }
    const { query, variables } = parsed.data;
    if (query.includes("addPullRequestReviewThread")) {
      const i = counts.thread++;
      counts.threadInputs.push(variables.input);
      return cfg.thread ? cfg.thread(i) : makeGraphqlFailure();
    }
    if (query.includes("submitPullRequestReview")) {
      const i = counts.submitReview++;
      counts.submitInputs.push(variables.input);
      return cfg.submitReview ? cfg.submitReview(i) : makeGraphqlFailure();
    }
    return makeJsonResponse({ message: "unexpected mutation" }, 400);
  }

  async function answerReviewList(
    input: string | URL | Request,
    init?: RequestInit,
    url = "",
  ): Promise<Response> {
    if (readMethod(input, init) === "GET") {
      const i = counts.listReviews++;
      return cfg.listReviews ? cfg.listReviews(i) : makeReviewList([]);
    }
    const i = counts.createReview++;
    counts.createUrls.push(url);
    counts.createBodies.push(await readRequestBody(input, init));
    return cfg.createReview ? cfg.createReview(i) : makeReviewStatus(500);
  }

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
          : makeJsonResponse({ error: "unexpected_token" }, 500);
      }
      const membership = answerInstallationRepositories(url, [REPO_ID]);
      if (membership !== undefined) {
        return membership;
      }
      if (url.includes("/repositories/")) {
        const i = counts.repositories++;
        return cfg.repositories ? cfg.repositories(i) : makeRepoStatus(404);
      }
      if (url.endsWith("/graphql")) {
        return answerGraphql(input, init);
      }
      if (REVIEW_ITEM_PATH.test(url)) {
        const i = counts.deleteReview++;
        counts.deleteUrls.push(url);
        return cfg.deleteReview
          ? cfg.deleteReview(i)
          : makeJsonResponse({}, 200);
      }
      if (REVIEW_LIST_PATH.test(url)) {
        return answerReviewList(input, init, url);
      }
      return makeJsonResponse({ message: "unexpected endpoint" }, 404);
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

async function seedPullRequest(handle: AppDatabase): Promise<void> {
  await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

/**
 * The Brief the submit names, plus the drafts the session holds, one
 * single-line anchor and one multi-line range on the old side. They ARE the
 * review's comments; nothing about them rides on the request.
 */
async function seedSessionDrafts(
  handle: AppDatabase,
  bodies: readonly string[] = ["anchored note", "multi-line note"],
): Promise<BriefRowId> {
  const repo = createTenantRepository(handle, CTX);
  const pr = await repo.pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) throw new Error("seed: pr missing");
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
  if (!brief.ok) throw new Error("seed: brief write failed");
  const anchors = [
    {
      kind: CommentAnchorKinds.LINE,
      filePath: "src/a.ts",
      side: DraftCommentSides.NEW,
      startLine: 12,
      endLine: 12,
    },
    {
      kind: CommentAnchorKinds.LINE,
      filePath: "src/b.ts",
      side: DraftCommentSides.OLD,
      startLine: 25,
      endLine: 30,
    },
  ];
  const written = await repo.reviewSessions.writeToSession(
    {
      briefId: brief.value.id,
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      brief: async () => ({ groupIds: [], flags: [], filePaths: [] }),
    },
    async (writer) => {
      for (const [index, body] of bodies.entries()) {
        const anchor = anchors[index % anchors.length];
        if (anchor === undefined) throw new Error("seed: no anchor");
        await writer.addDraftComment({ ...anchor, body });
      }
    },
  );
  if (!written.ok) throw new Error("seed: drafts failed");
  return brief.value.id;
}

// ---------------------------------------------------------------------------
// Request helpers.
// ---------------------------------------------------------------------------

const SUBMIT_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/review?base=${BASE_SHA}&head=${COMMIT_ID}`;

function makeValidBody(): Record<string, unknown> {
  return { outcome: "request-changes", body: "overall verdict" };
}

/** The wire code an error response carries. */
async function readWireCode(res: Response): Promise<string> {
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || !("code" in body)) {
    throw new Error("no wire code on the response");
  }
  return String(body.code);
}

async function readDraftStatuses(harness: PgliteHarness): Promise<string[]> {
  const rows = await harness.raw(
    "select status from review_draft_comment order by id",
  );
  return rows.map((row) => String(row["status"]));
}

/** The submit mutation's body, which is where a rejected anchor ends up. */
function readSubmitBody(counts: StubCounts): string {
  const input = counts.submitInputs[0];
  if (input === undefined) throw new Error("no submit mutation was made");
  const body = input["body"];
  if (typeof body !== "string") throw new Error("no body on the submit");
  return body;
}

async function postSubmit(
  app: ApiApp,
  cookie: string | undefined,
  body: unknown,
  path = SUBMIT_PATH,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (cookie !== undefined) headers["cookie"] = `rs_session=${cookie}`;

  return await app.request(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * One more draft on the same session, carrying a carry-over verdict on its
 * coordinates. `orphaned` is the one the submit refuses; `moved` still posts.
 */
async function seedCarriedDraft(
  handle: AppDatabase,
  briefId: BriefRowId,
  anchorStatus: AnchorStatus,
  body = "carried note",
): Promise<string> {
  const written = await createTenantRepository(
    handle,
    CTX,
  ).reviewSessions.writeToSession(
    {
      briefId,
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      brief: async () => ({ groupIds: [], flags: [], filePaths: [] }),
    },
    async (writer) =>
      await writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/c.ts",
        side: DraftCommentSides.NEW,
        startLine: 40,
        endLine: 40,
        body,
        anchorStatus,
      }),
  );
  if (!written.ok) throw new Error("seed: carried draft failed");
  return String(written.value.id);
}

/** One draft whose range starts on the base and ends on the head. */
async function seedTwoSideDraft(
  handle: AppDatabase,
  briefId: BriefRowId,
  body = "crosses sides",
): Promise<void> {
  const written = await createTenantRepository(
    handle,
    CTX,
  ).reviewSessions.writeToSession(
    {
      briefId,
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      brief: async () => ({ groupIds: [], flags: [], filePaths: [] }),
    },
    async (writer) =>
      await writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/c.ts",
        side: DraftCommentSides.NEW,
        startSide: DraftCommentSides.OLD,
        startLine: 10,
        endLine: 12,
        body,
      }),
  );
  if (!written.ok) throw new Error("seed: two-side draft failed");
}

async function seedFileDraft(
  handle: AppDatabase,
  briefId: BriefRowId,
  body = "on the file",
): Promise<void> {
  const written = await createTenantRepository(
    handle,
    CTX,
  ).reviewSessions.writeToSession(
    {
      briefId,
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      brief: async () => ({ groupIds: [], flags: [], filePaths: [] }),
    },
    async (writer) =>
      await writer.addDraftComment({
        kind: CommentAnchorKinds.FILE,
        filePath: "src/app.ts",
        body,
      }),
  );
  if (!written.ok) throw new Error("seed: file draft failed");
}

function makeSessionPath(suffix: string): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session${suffix}?base=${BASE_SHA}&head=${COMMIT_ID}`;
}

/** The two operations the attention list names, over HTTP. */
async function reanchorDraft(
  app: ApiApp,
  cookie: string,
  draftId: string,
): Promise<Response> {
  return await app.request(makeSessionPath(`/comments/${draftId}/anchor`), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      cookie: `rs_session=${cookie}`,
    },
    body: JSON.stringify({
      filePath: "src/c.ts",
      side: "new",
      startLine: 5,
      endLine: 5,
    }),
  });
}

async function deleteDraft(
  app: ApiApp,
  cookie: string,
  draftId: string,
): Promise<Response> {
  return await app.request(makeSessionPath(`/comments/${draftId}`), {
    method: "DELETE",
    headers: { cookie: `rs_session=${cookie}` },
  });
}

async function readSubmitAuditCount(harness: PgliteHarness): Promise<number> {
  const rows = await harness.raw(
    // The choke point records every submit attempt; a SUCCESSFUL submit is
    // the one this suite counts.
    "select count(*)::int as n from audit_log where operation = 'submit-review' and outcome = 'ok'",
  );
  const n = rows[0]?.["n"];
  if (typeof n !== "number") throw new Error("unexpected count result");
  return n;
}

/** The happy-path stub every landing case shares. */
function stubSubmitHappyPath(overrides: StubConfig = {}): StubCounts {
  return stubGitHub({
    repositories: () => makeRepoOk(),
    createReview: () => makePendingReview(),
    thread: () => makeThreadCreated(),
    submitReview: () => makeSubmitAccepted(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

// Conversation port stub: a call here is a test bug.
const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
};

describe("POST /api/repos/:repoId/pulls/:prNumber/review", () => {
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
    const res = await postSubmit(app, undefined, makeValidBody());
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(0);
    expect(counts.createReview).toBe(0);
  });

  it("404 collapse when the viewer has no access to the repo", async () => {
    stubGitHub({ repositories: () => makeRepoStatus(403) });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(404);
  });

  it("400s invalid or absent outcomes and non-JSON bodies", async () => {
    stubGitHub({ repositories: () => makeRepoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    for (const bad of [{ outcome: "ship-it" }, { body: "no outcome" }, {}]) {
      const res = await postSubmit(app, cookie, bad);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("400 on a neutral comment submit the session has nothing for", async () => {
    const counts = stubGitHub({ repositories: () => makeRepoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle, []);
    const res = await postSubmit(app, cookie, { outcome: "comment" });
    expect(res.status).toBe(400);
    expect(counts.createReview).toBe(0);
  });

  it("400s bodyless request-changes without calling GitHub", async () => {
    const counts = stubGitHub({ repositories: () => makeRepoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    const res = await postSubmit(app, cookie, { outcome: "request-changes" });
    expect(res.status).toBe(400);
    expect(counts.createReview).toBe(0);
  });

  it("400s drafts exceeding the fold budget without calling GitHub", async () => {
    // Every accepted submit must be representable by the degradation fold:
    // individually-valid drafts whose FOLDED body would exceed GitHub's cap
    // are rejected deterministically before any upstream side effect.
    const counts = stubGitHub({ repositories: () => makeRepoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle, [
      "x".repeat(40_000),
      "y".repeat(40_000),
    ]);
    const res = await postSubmit(app, cookie, { outcome: "comment" });
    expect(res.status).toBe(400);
    expect(counts.createReview).toBe(0);
  });

  it("409s orphaned drafts without calling GitHub", async () => {
    const counts = stubGitHub({ repositories: () => makeRepoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    await seedCarriedDraft(harness.handle, briefId, AnchorStatuses.ORPHANED);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(409);
    expect(await readWireCode(res)).toBe("draft-anchor-orphaned");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Refused before the mutating write's fresh slug resolve, and long before
    // the pending review: the gate's own lookup is the only upstream call.
    expect(counts.repositories).toBe(1);
    expect(counts.createReview).toBe(0);
    // Nothing is deleted for the reviewer: every draft is still held.
    expect(await readDraftStatuses(harness)).toEqual([
      "draft",
      "draft",
      "draft",
    ]);
  });

  it("posts moved anchors at their carried coordinates", async () => {
    const counts = stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    await seedCarriedDraft(
      harness.handle,
      briefId,
      AnchorStatuses.MOVED,
      "moved note",
    );

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(counts.createReview).toBe(1);
    expect(counts.threadInputs.map((input) => input["body"])).toEqual([
      "anchored note",
      "multi-line note",
      "moved note",
    ]);
    expect(counts.threadInputs[2]).toMatchObject({
      path: "src/c.ts",
      line: 40,
      side: "RIGHT",
    });
  });

  it("re-anchoring the orphaned draft clears the refusal", async () => {
    const counts = stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    const draftId = await seedCarriedDraft(
      harness.handle,
      briefId,
      AnchorStatuses.ORPHANED,
    );
    expect((await postSubmit(app, cookie, makeValidBody())).status).toBe(409);

    expect((await reanchorDraft(app, cookie, draftId)).status).toBe(200);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(counts.createReview).toBe(1);
    // Re-placed, then published, the draft the reviewer wrote still lands.
    expect(await readDraftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
      "submitted",
    ]);
  });

  it("deleting the orphaned draft clears the refusal", async () => {
    const counts = stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    const draftId = await seedCarriedDraft(
      harness.handle,
      briefId,
      AnchorStatuses.ORPHANED,
    );
    expect((await postSubmit(app, cookie, makeValidBody())).status).toBe(409);

    expect((await deleteDraft(app, cookie, draftId)).status).toBe(200);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(counts.createReview).toBe(1);
    expect(await readDraftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
    ]);
  });

  it("404 when the PR row does not exist in the tenant", async () => {
    stubGitHub({ repositories: () => makeRepoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(404);
  });

  it("opens a pending review, threads every draft, then submits", async () => {
    const counts = stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const payload: unknown = await res.json();
    expect(payload).toEqual({
      reviewId: REVIEW_ID,
      commentsDegraded: false,
      commentsFolded: 0,
      commentsTotal: 2,
    });

    // Exactly ONE per-repo gate ran (mount order: the submit route's gate is
    // the only one a POST traverses), plus the route's own FRESH slug resolve
    // for the mutating write, two /repositories/{id} calls, no more.
    expect(counts.repositories).toBe(2);
    // The create opens a pending review and nothing else: no event, no body,
    // no comments, or REST would silently drop every file comment.
    expect(counts.createReview).toBe(1);
    expect(counts.createBodies[0]).toEqual({ commit_id: COMMIT_ID });

    expect(counts.thread).toBe(2);
    expect(counts.threadInputs[0]).toEqual({
      pullRequestReviewId: REVIEW_NODE_ID,
      path: "src/a.ts",
      body: "anchored note",
      subjectType: "LINE",
      line: 12,
      side: "RIGHT",
    });
    expect(counts.threadInputs[1]).toEqual({
      pullRequestReviewId: REVIEW_NODE_ID,
      path: "src/b.ts",
      body: "multi-line note",
      subjectType: "LINE",
      line: 30,
      side: "LEFT",
      startLine: 25,
      startSide: "LEFT",
    });

    expect(counts.submitInputs).toEqual([
      {
        pullRequestReviewId: REVIEW_NODE_ID,
        event: "REQUEST_CHANGES",
        body: "overall verdict",
      },
    ]);
    expect(counts.deleteUrls).toEqual([]);

    // Audit: one `submit` row. Checkpoint: NONE, the webhook is the only
    // checkpoint writer; the route must never write it.
    expect(await readSubmitAuditCount(harness)).toBe(1);
    const checkpoints = await harness.raw(
      "select count(*)::int as n from checkpoint",
    );
    expect(checkpoints[0]?.["n"]).toBe(0);
  });

  it("maps a two-side draft to startSide LEFT and side RIGHT", async () => {
    const counts = stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle, []);
    await seedTwoSideDraft(harness.handle, briefId);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(counts.threadInputs).toEqual([
      {
        pullRequestReviewId: REVIEW_NODE_ID,
        path: "src/c.ts",
        body: "crosses sides",
        subjectType: "LINE",
        line: 12,
        side: "RIGHT",
        startLine: 10,
        startSide: "LEFT",
      },
    ]);
  });

  it("threads a File comment with subjectType FILE and no line", async () => {
    const counts = stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle, []);
    await seedFileDraft(harness.handle, briefId);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(counts.threadInputs).toEqual([
      {
        pullRequestReviewId: REVIEW_NODE_ID,
        path: "src/app.ts",
        body: "on the file",
        subjectType: "FILE",
      },
    ]);
  });

  it("folds a rejected File thread while the line threads land", async () => {
    const counts = stubSubmitHappyPath({
      thread: (call) =>
        call === 2 ? makeThreadRejected() : makeThreadCreated(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    await seedFileDraft(harness.handle, briefId);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      reviewId: REVIEW_ID,
      commentsDegraded: true,
      commentsFolded: 1,
      commentsTotal: 3,
    });

    expect(counts.thread).toBe(3);
    const body = readSubmitBody(counts);
    expect(body).toContain("overall verdict");
    expect(body).toContain("---");
    expect(body).toContain(
      "1 of 3 comments could not be anchored to the diff and were folded into this review body (nothing was dropped):",
    );
    expect(body).toContain("**`src/app.ts`**");
    expect(body).not.toContain("src/app.ts:");
    expect(body).toContain("on the file");
    expect(counts.deleteUrls).toEqual([]);
    expect(await readDraftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
      "submitted",
    ]);
  });

  it("folds a thread GitHub refuses with an UNPROCESSABLE error", async () => {
    const counts = stubSubmitHappyPath({
      thread: (call) =>
        call === 2 ? makeThreadRejectedByError() : makeThreadCreated(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    await seedFileDraft(harness.handle, briefId);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      reviewId: REVIEW_ID,
      commentsDegraded: true,
      commentsFolded: 1,
      commentsTotal: 3,
    });
    expect(counts.thread).toBe(3);
    expect(readSubmitBody(counts)).toContain("on the file");
    expect(counts.deleteUrls).toEqual([]);
  });

  it("folds a rejected two-side range with both sides spelled out", async () => {
    const counts = stubSubmitHappyPath({ thread: () => makeThreadRejected() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle, []);
    await seedTwoSideDraft(harness.handle, briefId);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    const body = readSubmitBody(counts);
    // Cross-side line numbers mean nothing without their sides.
    expect(body).toContain("src/c.ts:LEFT 10-RIGHT 12");
    expect(body).toContain("crosses sides");
  });

  it("leaves the body untouched when nothing was rejected", async () => {
    const counts = stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, { outcome: "approve" });
    expect(res.status).toBe(201);
    expect(counts.submitInputs).toEqual([
      { pullRequestReviewId: REVIEW_NODE_ID, event: "APPROVE" },
    ]);
  });

  it("publishes exactly the held drafts and records the review id", async () => {
    const counts = stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    // One draft is already on GitHub: it is not the submit's to post again.
    await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.writeToSession(
      {
        briefId,
        reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
        brief: async () => ({ groupIds: [], flags: [], filePaths: [] }),
      },
      async (writer) => {
        const first = (await writer.draftComments())[0];
        if (first === undefined) throw new Error("no draft to publish");
        await writer.publishDraftComments([first.id]);
      },
    );

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(counts.threadInputs.map((input) => input["body"])).toEqual([
      "multi-line note",
    ]);
    expect(await readDraftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
    ]);
    const recorded = await harness.raw(
      "select github_review_id from review_submitted_review",
    );
    expect(recorded.map((row) => String(row["github_review_id"]))).toEqual([
      String(REVIEW_ID),
    ]);
  });

  /** A capture-logging app over the same harness, for the two post-write logs. */
  function makeCapturingApp(): {
    capture: ReturnType<typeof testLogging>;
    app: ApiApp;
  } {
    const capture = testLogging();
    return {
      capture,
      app: createApp({
        logger: capture.logger,
        handle: harness.handle,
        webhookSecret: SECRET,
        auth: buildAuthDeps(kp),
        github: unusedConversationPort,
      }),
    };
  }

  it("keeps 201 and logs when post-commit bookkeeping fails", async () => {
    // The GitHub write is the commit point: a local failure after it must
    // never read as "nothing was submitted", which would invite a second
    // review. `audit.fail` is NOT this failure, it names an audit ROW that
    // would not persist, and raising it here alerts on the wrong thing.
    const { capture, app: captureApp } = makeCapturingApp();
    stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    await harness.raw(
      "alter table review_submitted_review rename to review_submitted_review_poisoned",
    );

    const res = await postSubmit(captureApp, cookie, makeValidBody());
    expect(res.status).toBe(201);
    const line = capture
      .lines()
      .find((l) => l["msg"] === "session unrecorded after a submitted review");
    expect(line?.["level"]).toBe("error");
    expect(line?.["evt"]).toBeUndefined();
    expect(line?.["reviewId"]).toBe(String(REVIEW_ID));
    expect(capture.lines().some((l) => l["evt"] === "audit.fail")).toBe(false);
  });

  it("keeps the 201 and logs audit.fail when the audit row will not persist", async () => {
    // The emit is the router choke point's, so the line names the operation
    // by its descriptor id rather than the route's own bookkeeping.
    const { capture, app: captureApp } = makeCapturingApp();
    stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    await harness.raw("alter table audit_log rename to audit_log_poisoned");

    const res = await postSubmit(captureApp, cookie, makeValidBody());
    expect(res.status).toBe(201);
    const line = capture.lines().find((l) => l["evt"] === "audit.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["operation"]).toBe("submit-review");
    await harness.raw("alter table audit_log_poisoned rename to audit_log");
  });

  it("409s a frozen session before spending a GitHub write", async () => {
    const counts = stubSubmitHappyPath();
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    // A session on a NEWER Brief of the same PR freezes the one being read.
    const pr = await createTenantRepository(
      harness.handle,
      CTX,
    ).pullRequests.getByNumber(brandRepoId(BigInt(REPO_ID)), PR_NUMBER);
    if (pr === undefined) throw new Error("pr missing");
    const newer = await createArtifactStore(harness.handle, CTX).briefs.write({
      pullRequestId: pr.id,
      baseSha: BASE_SHA,
      headSha: "e".repeat(40),
      headIndex: 2,
      commitCount: 2,
      provider: "anthropic",
      model: "claude",
      effort: "high",
      body: "{}",
    });
    if (!newer.ok) throw new Error("newer brief write failed");
    await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.writeToSession(
      {
        briefId: newer.value.id,
        reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
        brief: async () => ({ groupIds: [], flags: [], filePaths: [] }),
      },
      (writer) => writer.putReadMark({ chunkId: "c1" }),
    );

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(409);
    expect(await readWireCode(res)).toBe("pr-changed-since-read");
    expect(counts.createReview).toBe(0);
    // Only the gate's own access check ran, the route never re-resolved.
    expect(counts.repositories).toBe(1);
    expect(await readDraftStatuses(harness)).not.toContain("submitted");
  });

  it("posts to the FRESHLY resolved repo slug, never the cached name", async () => {
    // A mutating write must not trust the gate's positive-cache slug, which
    // is up to 60s stale after a rename plus name reuse: the route
    // re-resolves owner and name by the NUMERIC repo id before the write.
    const counts = stubSubmitHappyPath({
      repositories: (call) =>
        call === 0
          ? makeRepoOk()
          : makeJsonResponse({
              id: REPO_ID,
              full_name: "octo/renamed",
              private: true,
            }),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(counts.createUrls[0]).toContain(
      "/repos/octo/renamed/pulls/7/reviews",
    );
  });

  it("404s fresh-resolution denial after access was cached", async () => {
    // The gate passes (positive cache semantics), but access was revoked
    // before the route's fresh resolve, the denial must collapse to the
    // same 404 a cold gate denial produces, never a distinguishable 502.
    const counts = stubSubmitHappyPath({
      repositories: (call) => (call === 0 ? makeRepoOk() : makeRepoStatus(403)),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(404);
    expect(counts.createReview).toBe(0);
  });

  it("refreshes once on an expired token at the create and completes", async () => {
    const counts = stubSubmitHappyPath({
      token: () => makeTokenSuccess(),
      createReview: (call) =>
        call === 0 ? makeReviewStatus(401) : makePendingReview(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(counts.token).toBe(1);
    expect(counts.createReview).toBe(2);
    expect(counts.submitReview).toBe(1);
    expect(await readSubmitAuditCount(harness)).toBe(1);
  });

  it("refreshes once on a 401 from a thread mutation and completes", async () => {
    // A thread call's 401 hides inside `request-failed`, so the controller
    // hands `run` its own expiry predicate for the thread step.
    const counts = stubSubmitHappyPath({
      token: () => makeTokenSuccess(),
      thread: (call) =>
        call === 0 ? makeGraphqlUnauthorized() : makeThreadCreated(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(counts.token).toBe(1);
    expect(counts.thread).toBe(3);
    expect(counts.threadInputs.map((input) => input["body"])).toEqual([
      "anchored note",
      "anchored note",
      "multi-line note",
    ]);
    expect(counts.submitReview).toBe(1);
  });

  it("deletes the pending review when a thread mutation fails", async () => {
    const counts = stubSubmitHappyPath({
      thread: (call) =>
        call === 0 ? makeThreadCreated() : makeGraphqlFailure(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(502);
    expect(await readWireCode(res)).toBe("github-unavailable");
    expect(counts.thread).toBe(2);
    expect(counts.submitReview).toBe(0);
    expect(counts.deleteUrls).toEqual([
      `https://api.github.com/repos/octo/hello/pulls/7/reviews/${String(REVIEW_ID)}`,
    ]);
    expect(await readDraftStatuses(harness)).toEqual(["draft", "draft"]);
    expect(await readSubmitAuditCount(harness)).toBe(0);
  });

  it("deletes the pending review when the submit mutation fails", async () => {
    const counts = stubSubmitHappyPath({
      submitReview: () => makeGraphqlFailure(),
      listReviews: () => makeReviewList([makeOwnPendingEntry()]),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(502);
    expect(await readWireCode(res)).toBe("github-unavailable");
    expect(counts.deleteUrls).toEqual([
      `https://api.github.com/repos/octo/hello/pulls/7/reviews/${String(REVIEW_ID)}`,
    ]);
    expect(await readDraftStatuses(harness)).toEqual(["draft", "draft"]);
    expect(await readSubmitAuditCount(harness)).toBe(0);
  });

  it("answers 201 on a lost submit ack once the review lists as published", async () => {
    const counts = stubSubmitHappyPath({
      submitReview: () => makeGraphqlFailure(),
      listReviews: () => makeReviewList([makeOwnPublishedEntry()]),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      reviewId: REVIEW_ID,
      commentsDegraded: false,
      commentsFolded: 0,
      commentsTotal: 2,
    });
    expect(counts.listReviews).toBe(1);
    expect(counts.deleteUrls).toEqual([]);
    expect(await readDraftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
    ]);
  });

  it("deletes and 502s when the failed submit's review is gone from the list", async () => {
    const counts = stubSubmitHappyPath({
      submitReview: () => makeGraphqlFailure(),
      listReviews: () => makeReviewList([]),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(502);
    expect(counts.deleteUrls).toEqual([
      `https://api.github.com/repos/octo/hello/pulls/7/reviews/${String(REVIEW_ID)}`,
    ]);
    expect(await readDraftStatuses(harness)).toEqual(["draft", "draft"]);
  });

  it("clears a stale pending review and retries the create once", async () => {
    const counts = stubSubmitHappyPath({
      createReview: (call) =>
        call === 0 ? makePendingExists422() : makePendingReview(),
      listReviews: () => makeReviewList([makeStalePendingEntry()]),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(counts.createReview).toBe(2);
    expect(counts.listReviews).toBe(1);
    expect(counts.reviewCommentCount).toBe(1);
    expect(counts.deleteUrls).toEqual([
      `https://api.github.com/repos/octo/hello/pulls/7/reviews/${String(STALE_REVIEW_ID)}`,
    ]);
    expect(counts.thread).toBe(2);
    expect(counts.submitReview).toBe(1);
    expect(await readSubmitAuditCount(harness)).toBe(1);
  });

  it("409s pending-review-held instead of deleting a review with comments", async () => {
    const counts = stubSubmitHappyPath({
      createReview: () => makePendingExists422(),
      listReviews: () => makeReviewList([makeStalePendingEntry()]),
      reviewCommentCount: () => makeReviewCommentCount(3),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(409);
    expect(await readWireCode(res)).toBe("pending-review-held");
    expect(counts.createReview).toBe(1);
    expect(counts.deleteUrls).toEqual([]);
    expect(counts.thread).toBe(0);
    expect(await readDraftStatuses(harness)).toEqual(["draft", "draft"]);
    expect(await readSubmitAuditCount(harness)).toBe(0);
  });

  it("unknown-commit 422 fails closed with 409 and no retry, no audit", async () => {
    const counts = stubSubmitHappyPath({
      createReview: () => makeUnknownCommit422(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(409);
    expect(await readWireCode(res)).toBe("pr-rewritten-since-read");
    // Error responses keep the gated-route no-store posture too.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(counts.createReview).toBe(1);
    expect(counts.thread).toBe(0);
    expect(counts.deleteUrls).toEqual([]);
    expect(await readSubmitAuditCount(harness)).toBe(0);
  });

  it("allows two reviews from repeated submissions", async () => {
    const counts = stubSubmitHappyPath({
      createReview: (call) => makePendingReview(REVIEW_ID + call),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const first = await postSubmit(app, cookie, makeValidBody());
    const second = await postSubmit(app, cookie, makeValidBody());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(counts.createReview).toBe(2);
    expect(await readSubmitAuditCount(harness)).toBe(2);
  });
});
