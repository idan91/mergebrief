// POST /api/repos/:repoId/pulls/:prNumber/review over the PGlite harness. The
// route's own GitHub calls reach the `github/testing` fake through the
// reviewer binding; the repo gate and the OAuth refresh still answer over
// `fetch`. Pins that the route never writes the checkpoint, the webhook is
// its only writer. The github suite owns the wire-to-domain mapping.
import {
  GitHubApiErrorCodes,
  type GitHubApiError,
  type ReviewerRepoClient,
} from "github";
import {
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
  type FakeReview,
  type GitHubOperation,
} from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  type AppDatabase,
  type BriefRowId,
  type DraftAnchor,
  type KeyProvider,
  type ScopeContext,
  PUBLISH_CLAIM_LEASE_MS,
} from "persistence";
import {
  type AnchorStatus,
  AnchorStatuses,
  CommentAnchorKinds,
  DiffSides,
  PrStates,
  ReviewOutcomes,
} from "types";
import { stampDraftAnchorStatus } from "persistence/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger, testLogging } from "./logging";
import { BRIEF_BODY } from "./session/fixtures";
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
  DENIED_GATE_CALLS,
  OPERATOR_GATE_CALLS,
  listCallTokens,
  listCallsPastGate,
  type RepoClientOverrides,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";
import {
  openPerTestPglite,
  registerSharedPglite,
  type SharedPglite,
} from "./shared-pglite";

// Headroom for the PGlite harness; fake clocks stay out, they poison octokit.
vi.setConfig({ testTimeout: 30_000 });

const REPO_ID = 424242;
const COMMIT_ID = "c".repeat(40);
const BASE_SHA = "d".repeat(40);
const STALE_REVIEW_ID = 500n;
const OPERATOR_PAT = "ghp_OPERATOR_PAT";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};
const REVIEWER = brandReviewerId(BigInt(REVIEWER_ID));

/** GitHub took the submit and the answer never came back. */
const LOST_ANSWER: GitHubApiError = {
  code: GitHubApiErrorCodes.REQUEST_FAILED,
  status: 502,
  message:
    "failed to submit pull request review: GitHub API returned status 502",
};

// ---------------------------------------------------------------------------
// GitHub as the fake holds it.
// ---------------------------------------------------------------------------

interface GitHubArrangement {
  readonly fullName?: string;
  readonly reviews?: readonly FakeReview[];
  readonly rejectedAnchorPaths?: readonly string[];
}

/** The repository the fresh re-resolve reads and the PR the review lands on. */
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
    rejectedAnchorPaths: arrangement.rejectedAnchorPaths ?? [],
  });
}

/** A pending review an earlier request left on GitHub. */
function makeStalePendingReview(commentCount: number): FakeReview {
  return {
    reviewId: STALE_REVIEW_ID,
    reviewNodeId: "PRR_stale",
    state: "PENDING",
    body: "",
    commentCount,
  };
}

function countCalls(fake: FakeGitHub, operation: GitHubOperation): number {
  return fake.listCalls(operation).length;
}

function listThreadInputs(fake: FakeGitHub): unknown[] {
  return fake.listCalls("addPullRequestReviewThread").map((call) => call.input);
}

function listThreadBodies(fake: FakeGitHub): unknown[] {
  return listThreadInputs(fake).map((input) =>
    typeof input === "object" && input !== null && "body" in input
      ? input.body
      : undefined,
  );
}

function listSubmitInputs(fake: FakeGitHub): unknown[] {
  return fake.listCalls("submitPullRequestReview").map((call) => call.input);
}

/** The submit mutation's body, which is where a rejected anchor ends up. */
function readSubmitBody(fake: FakeGitHub): string {
  const [input] = listSubmitInputs(fake);
  const hasBody =
    typeof input === "object" && input !== null && "body" in input;
  if (!hasBody || typeof input.body !== "string") {
    throw new Error("no body on the submit");
  }
  return input.body;
}

/** The pending review's node id the submit mutation named. */
function readSubmittedNodeId(fake: FakeGitHub): string {
  const [input] = listSubmitInputs(fake);
  const hasNodeId =
    typeof input === "object" && input !== null && "reviewNodeId" in input;
  if (!hasNodeId || typeof input.reviewNodeId !== "string") {
    throw new Error("no submit mutation was made");
  }
  return input.reviewNodeId;
}

/** A second reviewer client on the fake, to read GitHub after the request. */
function bindProbeClient(fake: FakeGitHub): ReviewerRepoClient {
  const credential = {
    readToken: async () => ({ ok: true, value: "probe-token" }) as const,
    renewToken: async () => undefined,
  };
  const [owner = "", repo = ""] = REPO_SLUG.split("/");
  return fake
    .bindReviewerGitHub(credential, { log: testLogger() })
    .forRepo({ owner, repo });
}

async function findPendingReview(fake: FakeGitHub): Promise<unknown> {
  const pending =
    await bindProbeClient(fake).findPendingPullRequestReview(PR_NUMBER);
  return pending.ok ? pending.value : pending.error;
}

async function readReviewPublished(
  fake: FakeGitHub,
  reviewId: number,
): Promise<boolean> {
  const published = await bindProbeClient(fake).hasPullRequestReviewPublished({
    prNumber: PR_NUMBER,
    reviewId: BigInt(reviewId),
  });
  return published.ok && published.value;
}

// ---------------------------------------------------------------------------
// Seeding.
// ---------------------------------------------------------------------------

async function seedPullRequest(
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

/**
 * The Brief the submit names, plus the drafts the session holds, one
 * single-line anchor and one multi-line range on the old side. They ARE the
 * review's comments; nothing about them rides on the request.
 */
async function seedSessionDrafts(
  handle: AppDatabase,
  bodies: readonly string[] = ["anchored note", "multi-line note"],
  scope: ScopeContext = CTX,
): Promise<BriefRowId> {
  const repo = createTenantRepository(handle, scope);
  const pr = await repo.pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) {
    throw new Error("seed: pr missing");
  }
  const brief = await createArtifactStore(handle, scope).briefs.write({
    pullRequestId: pr.id,
    baseSha: BASE_SHA,
    headSha: COMMIT_ID,
    headIndex: 1,
    commitCount: 1,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: "{}",
    usedGroupIds: [],
  });
  const anchors: DraftAnchor[] = [
    {
      kind: CommentAnchorKinds.LINE,
      file: "src/a.ts",
      side: DiffSides.NEW,
      startLine: 12,
      endLine: 12,
    },
    {
      kind: CommentAnchorKinds.LINE,
      file: "src/b.ts",
      side: DiffSides.OLD,
      startLine: 25,
      endLine: 30,
    },
  ];
  for (const [index, body] of bodies.entries()) {
    const anchor = anchors[index % anchors.length];
    if (anchor === undefined) {
      throw new Error("seed: no anchor");
    }
    await writeDraft(handle, brief.id, anchor, body, scope);
  }
  return brief.id;
}

/** One draft through the reviewer's own draft action; answers its row id. */
async function writeDraft(
  handle: AppDatabase,
  briefId: BriefRowId,
  anchor: DraftAnchor,
  body: string,
  scope: ScopeContext = CTX,
): Promise<bigint> {
  const written = await createTenantRepository(
    handle,
    scope,
  ).reviewSessions.addDraft(
    { briefId, reviewerId: REVIEWER },
    { anchor, body },
  );
  if (!written.ok) {
    throw new Error("seed: draft failed");
  }
  return written.value.id;
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

/** The review id a 201 answered with. */
async function readReviewId(res: Response): Promise<number> {
  const body: unknown = await res.json();
  const hasId = typeof body === "object" && body !== null && "reviewId" in body;
  if (!hasId || typeof body.reviewId !== "number") {
    throw new Error("no review id on the response");
  }
  return body.reviewId;
}

async function readDraftStatuses(harness: SharedPglite): Promise<string[]> {
  const rows = await harness.raw(
    "select status from review_draft_comment order by id",
  );
  return rows.map((row) => String(row["status"]));
}

async function postSubmit(
  app: ApiApp,
  cookie: string | undefined,
  body: unknown,
  path = SUBMIT_PATH,
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
  const draftId = await writeDraft(
    handle,
    briefId,
    {
      kind: CommentAnchorKinds.LINE,
      file: "src/c.ts",
      side: DiffSides.NEW,
      startLine: 40,
      endLine: 40,
    },
    body,
  );
  await stampDraftAnchorStatus(handle, draftId, anchorStatus);
  return String(draftId);
}

/** One draft whose range starts on the base and ends on the head. */
async function seedTwoSideDraft(
  handle: AppDatabase,
  briefId: BriefRowId,
  body = "crosses sides",
): Promise<void> {
  await writeDraft(
    handle,
    briefId,
    {
      kind: CommentAnchorKinds.LINE,
      file: "src/c.ts",
      side: DiffSides.NEW,
      startSide: DiffSides.OLD,
      startLine: 10,
      endLine: 12,
    },
    body,
  );
}

async function seedFileDraft(
  handle: AppDatabase,
  briefId: BriefRowId,
  body = "on the file",
): Promise<void> {
  await writeDraft(
    handle,
    briefId,
    { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
    body,
  );
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
      ...SAME_ORIGIN_HEADERS,
      "content-type": "application/json",
      cookie: `__Host-mergebrief_session=${cookie}`,
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
    headers: {
      ...SAME_ORIGIN_HEADERS,
      cookie: `__Host-mergebrief_session=${cookie}`,
    },
  });
}

async function readSubmitAuditCount(harness: SharedPglite): Promise<number> {
  const rows = await harness.raw(
    // The choke point records every submit attempt; a SUCCESSFUL submit is
    // the one this suite counts.
    "select count(*)::int as n from audit_log where operation = 'submit-review' and outcome = 'ok'",
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

describe("POST /api/repos/:repoId/pulls/:prNumber/review", () => {
  const harness = registerSharedPglite();
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

  /** A capture-logging app over the same harness, for the post-write logs. */
  function buildCaptureApp(
    capture: ReturnType<typeof testLogging>,
    handle: AppDatabase = harness.handle,
  ): ApiApp {
    return createApp({
      logger: capture.logger,
      handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
    });
  }

  beforeEach(() => {
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

  /** A refused outcome stops at the parse, past the gate that caches its pass. */
  async function cacheGatePass(cookie: string): Promise<void> {
    const refused = await postSubmit(app, cookie, { outcome: "ship-it" });
    expect(refused.status).toBe(400);
  }

  async function readClaims(): Promise<unknown[]> {
    const rows = await harness.raw(
      "select publish_claim from review_draft_comment order by id",
    );
    return rows.map((row) => row["publish_claim"]);
  }

  async function editDraft(cookie: string, draftId: string) {
    return app.request(makeSessionPath(`/comments/${draftId}`), {
      method: "PATCH",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        "content-type": "application/json",
        cookie: `__Host-mergebrief_session=${cookie}`,
      },
      body: JSON.stringify({ body: "edited" }),
    });
  }

  async function readFirstDraftId(): Promise<string> {
    const rows = await harness.raw(
      "select id from review_draft_comment order by id",
    );
    return String(rows[0]?.["id"]);
  }

  it("401s absent session cookies without calling GitHub", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    const res = await postSubmit(app, undefined, makeValidBody());
    expect(res.status).toBe(401);
    expect(gate.repositoryReads()).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("404 collapse when the viewer has no access to the repo", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 403 });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake, DENIED_GATE_CALLS)).toEqual([]);
  });

  it("400s invalid or absent outcomes and non-JSON bodies", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    for (const bad of [{ outcome: "ship-it" }, { body: "no outcome" }, {}]) {
      const res = await postSubmit(app, cookie, bad);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("400s bodyless request-changes without calling GitHub", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    const res = await postSubmit(app, cookie, { outcome: "request-changes" });
    expect(res.status).toBe(400);
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("400s drafts exceeding the fold budget without calling GitHub", async () => {
    // Every accepted submit must be representable by the degradation fold:
    // individually-valid drafts whose FOLDED body would exceed GitHub's cap
    // are rejected deterministically before any upstream side effect.
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle, [
      "x".repeat(40_000),
      "y".repeat(40_000),
    ]);
    const res = await postSubmit(app, cookie, { outcome: "comment" });
    expect(res.status).toBe(400);
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("409s orphaned drafts without calling GitHub", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    await seedCarriedDraft(harness.handle, briefId, AnchorStatuses.ORPHANED);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(409);
    expect(await readWireCode(res)).toBe("draft-anchor-orphaned");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Refused before the mutating write's fresh re-resolve, and long before
    // the pending review: the gate's own pass is the only upstream call.
    expect(listCallsPastGate(fake)).toEqual([]);
    // Nothing is deleted for the reviewer: every draft is still held.
    expect(await readDraftStatuses(harness)).toEqual([
      "draft",
      "draft",
      "draft",
    ]);
  });

  it("posts moved anchors at their carried coordinates", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    await seedCarriedDraft(
      harness.handle,
      briefId,
      AnchorStatuses.MOVED,
      "moved note",
    );

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(countCalls(fake, "createPullRequestReview")).toBe(1);
    expect(listThreadBodies(fake)).toEqual([
      "anchored note",
      "multi-line note",
      "moved note",
    ]);
    expect(listThreadInputs(fake)[2]).toMatchObject({
      path: "src/c.ts",
      line: 40,
      side: "RIGHT",
    });
  });

  it("re-anchoring the orphaned draft clears the refusal", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    const draftId = await seedCarriedDraft(
      harness.handle,
      briefId,
      AnchorStatuses.ORPHANED,
    );
    expect((await postSubmit(app, cookie, makeValidBody())).status).toBe(409);

    expect((await reanchorDraft(app, cookie, draftId)).status).toBe(204);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(countCalls(fake, "createPullRequestReview")).toBe(1);
    // Re-placed, then published, the draft the reviewer wrote still lands.
    expect(await readDraftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
      "submitted",
    ]);
  });

  it("deleting the orphaned draft clears the refusal", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    const draftId = await seedCarriedDraft(
      harness.handle,
      briefId,
      AnchorStatuses.ORPHANED,
    );
    expect((await postSubmit(app, cookie, makeValidBody())).status).toBe(409);

    expect((await deleteDraft(app, cookie, draftId)).status).toBe(204);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(countCalls(fake, "createPullRequestReview")).toBe(1);
    expect(await readDraftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
    ]);
  });

  it("404 when the PR row does not exist in the tenant", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("opens a pending review, threads every draft, then submits", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    const lookups = spyPullRequestLookups(harness);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const reviewId = await readReviewId(res.clone());
    expect(await res.json()).toEqual({
      reviewId,
      commentsDegraded: false,
      commentsFolded: 0,
      commentsTotal: 2,
    });
    expect(lookups.count()).toBe(1);

    // Exactly ONE per-repo gate ran, plus the route's own FRESH re-resolve
    // for the mutating write: one read each, no more.
    const freshReads = listCallsPastGate(fake).filter(
      (call) => call.operation === "fetchRepositoryById",
    );
    expect(freshReads).toHaveLength(1);
    const created = fake.listCalls("createPullRequestReview");
    expect(created.map((call) => call.input)).toEqual([
      {
        owner: "octo",
        repo: "hello",
        prNumber: PR_NUMBER,
        commitId: COMMIT_ID,
      },
    ]);

    const reviewNodeId = readSubmittedNodeId(fake);
    expect(listThreadInputs(fake)).toEqual([
      {
        reviewNodeId,
        subjectType: "line",
        path: "src/a.ts",
        body: "anchored note",
        line: 12,
        side: "RIGHT",
      },
      {
        reviewNodeId,
        subjectType: "line",
        path: "src/b.ts",
        body: "multi-line note",
        line: 30,
        side: "LEFT",
        startLine: 25,
        startSide: "LEFT",
      },
    ]);
    expect(listSubmitInputs(fake)).toEqual([
      { reviewNodeId, event: "REQUEST_CHANGES", body: "overall verdict" },
    ]);
    expect(countCalls(fake, "deletePendingPullRequestReview")).toBe(0);
    // Every call, the pending-review writes included, rode the viewer alone.
    expect(new Set(listFakeCallTokens(fake))).toEqual(new Set([ACCESS_TOKEN]));
    expect(await readReviewPublished(fake, reviewId)).toBe(true);

    // Audit: one `submit` row. Checkpoint: NONE, the webhook is the only
    // checkpoint writer; the route must never write it.
    expect(await readSubmitAuditCount(harness)).toBe(1);
    const checkpoints = await harness.raw(
      "select count(*)::int as n from checkpoint",
    );
    expect(checkpoints[0]?.["n"]).toBe(0);
  });

  it("folds a rejected File thread while the line threads land", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake, { rejectedAnchorPaths: ["src/app.ts"] });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    await seedFileDraft(harness.handle, briefId);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      reviewId: expect.any(Number),
      commentsDegraded: true,
      commentsFolded: 1,
      commentsTotal: 3,
    });

    expect(countCalls(fake, "addPullRequestReviewThread")).toBe(3);
    const body = readSubmitBody(fake);
    expect(body).toContain("overall verdict");
    expect(body).toContain("---");
    expect(body).toContain(
      "1 of 3 comments could not be anchored to the diff and were folded into this review body (nothing was dropped):",
    );
    expect(body).toContain("**`src/app.ts`**");
    expect(body).not.toContain("src/app.ts:");
    expect(body).toContain("on the file");
    expect(countCalls(fake, "deletePendingPullRequestReview")).toBe(0);
    expect(await readDraftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
      "submitted",
    ]);
  });

  it("folds a rejected two-side range with both sides spelled out", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake, { rejectedAnchorPaths: ["src/c.ts"] });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle, []);
    await seedTwoSideDraft(harness.handle, briefId);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    const body = readSubmitBody(fake);
    // Cross-side line numbers mean nothing without their sides.
    expect(body).toContain("src/c.ts:LEFT 10-RIGHT 12");
    expect(body).toContain("crosses sides");
  });

  it("leaves the body untouched when nothing was rejected", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, { outcome: "approve" });
    expect(res.status).toBe(201);
    expect(listSubmitInputs(fake)).toEqual([
      { reviewNodeId: expect.any(String), event: "APPROVE" },
    ]);
  });

  it("publishes exactly the held drafts and records the review id", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    // One draft is already on GitHub: it is not the submit's to post again.
    const sessions = createTenantRepository(harness.handle, CTX).reviewSessions;
    const key = { briefId, reviewerId: REVIEWER };
    const held = await sessions.listDrafts(key);
    const first = held.ok ? held.value[0] : undefined;
    if (first === undefined) {
      throw new Error("no draft to publish");
    }
    await sessions.recordPublishedDrafts(key, { draftIds: [first.id] });

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    const reviewId = await readReviewId(res);
    expect(listThreadBodies(fake)).toEqual(["multi-line note"]);
    expect(await readDraftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
    ]);
    const recorded = await harness.raw(
      "select github_review_id from review_submitted_review",
    );
    expect(recorded.map((row) => String(row["github_review_id"]))).toEqual([
      String(reviewId),
    ]);
  });

  it("keeps 201 and logs when post-commit bookkeeping fails", async () => {
    // The GitHub write is the commit point: a local failure after it must
    // never read as "nothing was submitted", which would invite a second
    // review. `audit.fail` is NOT this failure, it names an audit ROW that
    // would not persist, and raising it here alerts on the wrong thing.
    const capture = testLogging();
    const own = await openPerTestPglite();
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(own.handle);
    const { cookie } = await seedSignIn(own.handle, kp);
    await seedSessionDrafts(own.handle);
    // Reads still work; only recording the review is refused.
    await own.raw(
      "alter table review_submitted_review add constraint no_record " +
        "check (github_review_id < 0)",
    );

    const res = await postSubmit(
      buildCaptureApp(capture, own.handle),
      cookie,
      makeValidBody(),
    );
    expect(res.status).toBe(201);
    const reviewId = await readReviewId(res);
    const line = capture
      .lines()
      .find((l) => l["msg"] === "session unrecorded after a submitted review");
    expect(line?.["level"]).toBe("error");
    expect(line?.["evt"]).toBeUndefined();
    expect(line?.["reviewId"]).toBe(String(reviewId));
    expect(capture.lines().some((l) => l["evt"] === "audit.fail")).toBe(false);
  });

  it("keeps the 201 and logs audit.fail when the audit row will not persist", async () => {
    // The emit is the router choke point's, so the line names the operation
    // by its descriptor id rather than the route's own bookkeeping.
    const capture = testLogging();
    const own = await openPerTestPglite();
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(own.handle);
    const { cookie } = await seedSignIn(own.handle, kp);
    await seedSessionDrafts(own.handle);
    await own.raw("alter table audit_log rename to audit_log_poisoned");

    const res = await postSubmit(
      buildCaptureApp(capture, own.handle),
      cookie,
      makeValidBody(),
    );
    expect(res.status).toBe(201);
    const line = capture.lines().find((l) => l["evt"] === "audit.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["operation"]).toBe("submit-review");
  });

  it("409s a frozen session before spending a GitHub write", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    // A session on a NEWER Brief of the same PR freezes the one being read.
    const pr = await createTenantRepository(
      harness.handle,
      CTX,
    ).pullRequests.getByNumber(brandRepoId(BigInt(REPO_ID)), PR_NUMBER);
    if (pr === undefined) {
      throw new Error("pr missing");
    }
    const newer = await createArtifactStore(harness.handle, CTX).briefs.write({
      pullRequestId: pr.id,
      baseSha: BASE_SHA,
      headSha: "e".repeat(40),
      headIndex: 2,
      commitCount: 2,
      provider: "anthropic",
      model: "claude",
      effort: "high",
      body: JSON.stringify({ changeGroups: [], chunks: [] }),
      usedGroupIds: [],
    });
    await createTenantRepository(harness.handle, CTX).reviewSessions.setOutcome(
      { briefId: newer.id, reviewerId: REVIEWER },
      ReviewOutcomes.COMMENT,
    );

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(409);
    expect(await readWireCode(res)).toBe("pr-changed-since-read");
    // Only the gate's own pass ran, the route never re-resolved.
    expect(listCallsPastGate(fake)).toEqual([]);
    expect(await readDraftStatuses(harness)).not.toContain("submitted");
  });

  it("posts to the FRESHLY resolved repo slug, never the cached name", async () => {
    // A mutating write must not trust the gate's positive-cache slug, which
    // is up to 60s stale after a rename plus name reuse: the route
    // re-resolves owner and name by the NUMERIC repo id before the write.
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    await cacheGatePass(cookie);
    arrangeGitHub(fake, { fullName: "octo/renamed" });

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(fake.listCalls("createPullRequestReview")).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({ owner: "octo", repo: "renamed" }),
      }),
    ]);
  });

  it("404s fresh-resolution denial after access was cached", async () => {
    // The gate passes (positive cache semantics), but access was revoked
    // before the route's fresh resolve, the denial must collapse to the
    // same 404 a cold gate denial produces, never a distinguishable 502.
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    await cacheGatePass(cookie);
    fake.failOn("fetchRepositoryById", FakeFailures.FORBIDDEN);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(404);
    const pastGate = listCallsPastGate(fake).map((call) => call.operation);
    expect(pastGate).toEqual(["fetchRepositoryById"]);
    expect(countCalls(fake, "createPullRequestReview")).toBe(0);
    expect(await readDraftStatuses(harness)).toEqual(["draft", "draft"]);
  });

  it("refuses a submit behind an operator pass with no-repo-write-access", async () => {
    // The reader sees the brief on the operator's pass; a write on the
    // operator's token would misattribute their review, so it never runs.
    arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 404 });
    arrangeGitHub(fake);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedPullRequest(harness.handle, OWNER);
    await seedSessionDrafts(harness.handle, undefined, OWNER);
    const operatorApp = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
      operatorToken: buildOperatorToken(OPERATOR_PAT),
    });

    const res = await postSubmit(operatorApp, cookie, makeValidBody());

    expect(res.status).toBe(403);
    expect(await readWireCode(res)).toBe("no-repo-write-access");
    const pastGate = listCallsPastGate(fake, OPERATOR_GATE_CALLS);
    expect(listCallTokens(pastGate)).toEqual([ACCESS_TOKEN]);
    expect(countCalls(fake, "createPullRequestReview")).toBe(0);
    expect(await readDraftStatuses(harness)).toEqual(["draft", "draft"]);
  });

  it("renews once on a 401 at the create and completes", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    const expiring = buildOverriddenApp((client) => ({
      async createPullRequestReview(input) {
        fake.rejectToken(ACCESS_TOKEN);
        return client.createPullRequestReview(input);
      },
    }));

    const res = await postSubmit(expiring, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(
      fake.listCalls("createPullRequestReview").map((c) => c.credential),
    ).toEqual([
      { kind: "reviewer", token: ACCESS_TOKEN },
      { kind: "reviewer", token: ROTATED_ACCESS_TOKEN },
    ]);
    expect(countCalls(fake, "submitPullRequestReview")).toBe(1);
    expect(await readSubmitAuditCount(harness)).toBe(1);
  });

  it("renews once on a 401 from a thread mutation and completes", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    const expiring = buildOverriddenApp((client) => ({
      async addPullRequestReviewThread(input) {
        fake.rejectToken(ACCESS_TOKEN);
        return client.addPullRequestReviewThread(input);
      },
    }));

    const res = await postSubmit(expiring, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(gate.tokenRefreshes()).toBe(1);
    expect(listThreadBodies(fake)).toEqual([
      "anchored note",
      "anchored note",
      "multi-line note",
    ]);
    expect(countCalls(fake, "submitPullRequestReview")).toBe(1);
  });

  it("deletes the pending review when a thread mutation fails", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    fake.failOn("addPullRequestReviewThread", FakeFailures.SERVER_ERROR);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(502);
    expect(await readWireCode(res)).toBe("github-unavailable");
    expect(countCalls(fake, "addPullRequestReviewThread")).toBe(1);
    expect(countCalls(fake, "submitPullRequestReview")).toBe(0);
    expect(countCalls(fake, "deletePendingPullRequestReview")).toBe(1);
    expect(await findPendingReview(fake)).toBeUndefined();
    expect(await readDraftStatuses(harness)).toEqual(["draft", "draft"]);
    expect(await readClaims()).toEqual([null, null]);
    expect(await readSubmitAuditCount(harness)).toBe(0);
    const edited = await editDraft(cookie, await readFirstDraftId());
    expect(edited.status).toBe(204);
  });

  it("deletes the review and 502s when a failed submit did not publish", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    fake.failOn("submitPullRequestReview", FakeFailures.SERVER_ERROR);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(502);
    expect(await readWireCode(res)).toBe("github-unavailable");
    expect(countCalls(fake, "hasPullRequestReviewPublished")).toBe(1);
    expect(countCalls(fake, "deletePendingPullRequestReview")).toBe(1);
    expect(await findPendingReview(fake)).toBeUndefined();
    expect(await readDraftStatuses(harness)).toEqual(["draft", "draft"]);
    expect(await readSubmitAuditCount(harness)).toBe(0);
  });

  it("logs at warn when the pending review cannot be deleted", async () => {
    const capture = testLogging();
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    fake.failOn("addPullRequestReviewThread", FakeFailures.SERVER_ERROR);
    fake.failOn("deletePendingPullRequestReview", FakeFailures.SERVER_ERROR);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(
      buildCaptureApp(capture),
      cookie,
      makeValidBody(),
    );
    expect(res.status).toBe(502);
    const line = capture
      .lines()
      .find(
        (l) => l["msg"] === "pending review left behind after a failed submit",
      );
    expect(line?.["level"]).toBe("warn");
  });

  it("answers 201 on a lost submit ack once the review lists as published", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    const lostAnswer = buildOverriddenApp((client) => ({
      async submitPullRequestReview(input) {
        const applied = await client.submitPullRequestReview(input);
        if (!applied.ok) {
          return applied;
        }
        return { ok: false, error: LOST_ANSWER };
      },
    }));

    const res = await postSubmit(lostAnswer, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      reviewId: expect.any(Number),
      commentsDegraded: false,
      commentsFolded: 0,
      commentsTotal: 2,
    });
    expect(countCalls(fake, "submitPullRequestReview")).toBe(1);
    expect(countCalls(fake, "hasPullRequestReviewPublished")).toBe(1);
    expect(countCalls(fake, "deletePendingPullRequestReview")).toBe(0);
    expect(await readDraftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
    ]);
  });

  it("clears a stale pending review and retries the create once", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake, { reviews: [makeStalePendingReview(0)] });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(201);
    expect(countCalls(fake, "createPullRequestReview")).toBe(2);
    expect(fake.listCalls("findPendingPullRequestReview")).toHaveLength(1);
    expect(fake.listCalls("countPendingReviewComments")).toHaveLength(1);
    expect(
      fake.listCalls("deletePendingPullRequestReview").map((c) => c.input),
    ).toEqual([expect.objectContaining({ reviewId: STALE_REVIEW_ID })]);
    expect(countCalls(fake, "addPullRequestReviewThread")).toBe(2);
    expect(countCalls(fake, "submitPullRequestReview")).toBe(1);
    expect(await readSubmitAuditCount(harness)).toBe(1);
  });

  it("409s pending-review-held instead of deleting a review with comments", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake, { reviews: [makeStalePendingReview(3)] });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(409);
    expect(await readWireCode(res)).toBe("pending-review-held");
    expect(countCalls(fake, "createPullRequestReview")).toBe(1);
    expect(countCalls(fake, "deletePendingPullRequestReview")).toBe(0);
    expect(countCalls(fake, "addPullRequestReviewThread")).toBe(0);
    expect(await findPendingReview(fake)).toEqual(
      expect.objectContaining({ reviewId: STALE_REVIEW_ID }),
    );
    expect(await readDraftStatuses(harness)).toEqual(["draft", "draft"]);
    expect(await readSubmitAuditCount(harness)).toBe(0);
  });

  it("unknown-commit 422 fails closed with 409 and no retry, no audit", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    fake.failOn("createPullRequestReview", FakeFailures.UNKNOWN_COMMIT);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await postSubmit(app, cookie, makeValidBody());
    expect(res.status).toBe(409);
    expect(await readWireCode(res)).toBe("pr-rewritten-since-read");
    // Error responses keep the gated-route no-store posture too.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(countCalls(fake, "createPullRequestReview")).toBe(1);
    expect(countCalls(fake, "addPullRequestReviewThread")).toBe(0);
    expect(countCalls(fake, "deletePendingPullRequestReview")).toBe(0);
    expect(await readSubmitAuditCount(harness)).toBe(0);
  });

  it("allows a second review that carries only the verdict", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeGitHub(fake);
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSignIn(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const first = await postSubmit(app, cookie, makeValidBody());
    const second = await postSubmit(app, cookie, makeValidBody());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(countCalls(fake, "createPullRequestReview")).toBe(2);
    // The drafts went out with the first review; the second posts none again.
    expect(countCalls(fake, "addPullRequestReviewThread")).toBe(2);
    expect(await readSubmitAuditCount(harness)).toBe(2);
  });

  describe("the claim a submit holds", () => {
    const PREVIOUS_HEAD = "e".repeat(40);

    async function countRows(table: string): Promise<number> {
      const rows = await harness.raw(`select count(*)::int as n from ${table}`);
      return Number(rows[0]?.["n"]);
    }

    async function writeBrief(
      headSha: string,
      headIndex: number,
    ): Promise<BriefRowId> {
      const pr = await createTenantRepository(
        harness.handle,
        CTX,
      ).pullRequests.getByNumber(brandRepoId(BigInt(REPO_ID)), PR_NUMBER);
      if (pr === undefined) {
        throw new Error("seed: pr missing");
      }
      const written = await createArtifactStore(
        harness.handle,
        CTX,
      ).briefs.write({
        pullRequestId: pr.id,
        baseSha: BASE_SHA,
        headSha,
        headIndex,
        commitCount: headIndex,
        provider: "anthropic",
        model: "claude",
        effort: "high",
        body: BRIEF_BODY,
        anchorState: "anchored",
        usedGroupIds: [],
      });
      return written.id;
    }

    /**
     * Drafts on a session one Brief back, so the Brief the submit names has
     * no session yet. `linked` writes the hop that lets them carry in place;
     * without it every carried anchor orphans.
     */
    async function seedPreviousDrafts(
      bodies: readonly string[],
      linked: boolean,
    ): Promise<void> {
      const previous = await writeBrief(PREVIOUS_HEAD, 1);
      await writeBrief(COMMIT_ID, 2);
      for (const body of bodies) {
        await writeDraft(
          harness.handle,
          previous,
          {
            kind: CommentAnchorKinds.LINE,
            file: "src/a.ts",
            side: DiffSides.NEW,
            startLine: 12,
            endLine: 12,
          },
          body,
        );
      }
      if (!linked) {
        return;
      }
      const pr = await createTenantRepository(
        harness.handle,
        CTX,
      ).pullRequests.getByNumber(brandRepoId(BigInt(REPO_ID)), PR_NUMBER);
      if (pr === undefined) {
        throw new Error("seed: pr missing");
      }
      await createArtifactStore(harness.handle, CTX).hunkSpans.write({
        pullRequestId: pr.id,
        baselineSha: PREVIOUS_HEAD,
        headSha: COMMIT_ID,
        spans: [
          {
            file: "src/app.ts",
            hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
          },
        ],
      });
    }

    it("creates no session for a submit with nothing to say", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPullRequest(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedSessionDrafts(harness.handle, []);

      const res = await postSubmit(app, cookie, { outcome: "comment" });

      expect(res.status).toBe(400);
      expect(listCallsPastGate(fake)).toEqual([]);
      expect(await countRows("review_session")).toBe(0);
    });

    it("creates no session for a submit refused on an orphaned draft", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPullRequest(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPreviousDrafts(["lost its place"], false);

      const res = await postSubmit(app, cookie, makeValidBody());

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-anchor-orphaned");
      expect(listCallsPastGate(fake)).toEqual([]);
      expect(await countRows("review_session")).toBe(1);
    });

    it("creates no session for a submit over the fold budget", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPullRequest(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPreviousDrafts(["x".repeat(40_000), "y".repeat(40_000)], true);

      const res = await postSubmit(app, cookie, { outcome: "comment" });

      expect(res.status).toBe(400);
      expect(listCallsPastGate(fake)).toEqual([]);
      expect(await countRows("review_session")).toBe(1);
    });

    it("posts the carried drafts once the claim saves the session", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPullRequest(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedPreviousDrafts(["carried across"], true);

      const res = await postSubmit(app, cookie, makeValidBody());

      expect(res.status).toBe(201);
      expect(listThreadBodies(fake)).toEqual(["carried across"]);
      expect(await countRows("review_session")).toBe(2);
    });

    it("saves the claim before GitHub is called", async () => {
      let claimsAtCall: unknown[] = [];
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPullRequest(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedSessionDrafts(harness.handle);
      const watched = buildOverriddenApp((client) => ({
        async createPullRequestReview(input) {
          claimsAtCall = await readClaims();
          return client.createPullRequestReview(input);
        },
      }));

      expect((await postSubmit(watched, cookie, makeValidBody())).status).toBe(
        201,
      );

      expect(claimsAtCall).toHaveLength(2);
      expect(claimsAtCall.every((claim) => typeof claim === "string")).toBe(
        true,
      );
    });

    it("settles the submitted drafts and clears their claim", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPullRequest(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedSessionDrafts(harness.handle);

      expect((await postSubmit(app, cookie, makeValidBody())).status).toBe(201);

      expect(await readDraftStatuses(harness)).toEqual([
        "submitted",
        "submitted",
      ]);
      expect(await readClaims()).toEqual([null, null]);
    });

    it("keeps the claim when the submit cannot be confirmed", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      fake.failOn("submitPullRequestReview", FakeFailures.SERVER_ERROR);
      fake.failOn("hasPullRequestReviewPublished", FakeFailures.FORBIDDEN);
      await seedPullRequest(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedSessionDrafts(harness.handle);

      const res = await postSubmit(app, cookie, makeValidBody());

      expect(res.status).toBe(502);
      expect(countCalls(fake, "deletePendingPullRequestReview")).toBe(1);
      expect(await readDraftStatuses(harness)).toEqual(["draft", "draft"]);
      const claims = await readClaims();
      expect(claims.every((claim) => typeof claim === "string")).toBe(true);
      const edited = await editDraft(cookie, await readFirstDraftId());
      expect(edited.status).toBe(409);
      expect(await readWireCode(edited)).toBe("draft-publish-pending");
    });

    it("409s draft-publish-in-doubt while a held draft is in doubt", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      await seedPullRequest(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      const briefId = await seedSessionDrafts(harness.handle);
      const claimed = await createTenantRepository(
        harness.handle,
        CTX,
      ).reviewSessions.claimDrafts(
        { briefId, reviewerId: REVIEWER },
        {
          draftIds: [BigInt(await readFirstDraftId())],
          now: new Date(Date.now() - PUBLISH_CLAIM_LEASE_MS - 60_000),
        },
      );
      if (!claimed.ok) {
        throw new Error("claim seed failed");
      }

      const res = await postSubmit(app, cookie, makeValidBody());

      expect(res.status).toBe(409);
      expect(await readWireCode(res)).toBe("draft-publish-in-doubt");
      expect(listCallsPastGate(fake)).toEqual([]);
    });

    it("answers an honest 403 when GitHub forbids the review", async () => {
      arrangeFakeGate(fake, { repoId: REPO_ID });
      arrangeGitHub(fake);
      fake.failOn("createPullRequestReview", FakeFailures.FORBIDDEN);
      await seedPullRequest(harness.handle);
      const { cookie } = await seedSignIn(harness.handle, kp);
      await seedSessionDrafts(harness.handle);

      const res = await postSubmit(app, cookie, makeValidBody());

      expect(res.status).toBe(403);
      expect(await readWireCode(res)).toBe("github-permission");
      expect(await readClaims()).toEqual([null, null]);
    });
  });
});
