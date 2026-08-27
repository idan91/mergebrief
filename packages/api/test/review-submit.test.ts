// Submit-route integration tests: `app.request()` against `createApp` over the
// PGlite harness, GitHub stubbed at the global-fetch boundary (same pattern as
// reads.test.ts). Pins that the route never writes the checkpoint — the webhook
// is its only writer.
import { randomBytes } from "node:crypto";
import {
  AnchorStatus,
  createArtifactStore,
  DraftCommentSide,
  encryptToken,
  createTenantRepository,
  createGrantAuth,
  PrState,
  type AppDatabase,
  type BriefRowId,
  type KeyProvider,
} from "persistence";
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
} from "./fixtures";

// POST /pulls/{n}/reviews is on octokit's `triggersNotification` list, so the
// throttling plugin spaces consecutive create-review calls ~3s apart through
// MODULE-GLOBAL Bottleneck groups (shared across every test in this file, and
// unfakeable: freezing/rewinding Date.now poisons the shared limiters — see
// reads.test.ts). Tests that make a second POST therefore legitimately take
// seconds; give the file the headroom instead of fighting the throttle.
vi.setConfig({ testTimeout: 30_000 });

const REPO_ID = 424242;
const COMMIT_ID = "c".repeat(40);
const BASE_SHA = "d".repeat(40);

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch) — dispatches on URL/method, counts calls.
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
function reviewCreated(id = 987001): Response {
  return jsonResponse({ id }, 200);
}
function reviewStatus(
  status: number,
  body: unknown = { message: "denied" },
): Response {
  return jsonResponse(body, status);
}
function anchoring422(): Response {
  return reviewStatus(422, {
    message: "Validation Failed",
    errors: ["Pull request review thread line must be part of the diff"],
  });
}
function unknownCommit422(): Response {
  return reviewStatus(422, {
    message: "Validation Failed",
    errors: [
      { resource: "PullRequestReview", code: "invalid", field: "commit_id" },
    ],
  });
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
  readonly createReview?: (call: number) => Response;
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  repositories: number;
  createReview: number;
  token: number;
  /** Parsed JSON body of each create-review POST, in order. */
  readonly reviewBodies: unknown[];
  /** URL of each create-review POST, in order — pins the target repo slug. */
  readonly reviewUrls: string[];
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = {
    repositories: 0,
    createReview: 0,
    token: 0,
    reviewBodies: [],
    reviewUrls: [],
  };
  const fetchFn = vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/login/oauth/access_token")) {
        const i = counts.token++;
        return cfg.token
          ? cfg.token(i)
          : jsonResponse({ error: "unexpected_token" }, 500);
      }
      if (url.includes("/repositories/")) {
        const i = counts.repositories++;
        return cfg.repositories ? cfg.repositories(i) : repoStatus(404);
      }
      if (/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/.test(url)) {
        const i = counts.createReview++;
        counts.reviewUrls.push(url);
        const raw =
          init?.body ??
          (input instanceof Request ? await input.text() : undefined);
        if (typeof raw === "string") {
          counts.reviewBodies.push(JSON.parse(raw));
        }
        return cfg.createReview ? cfg.createReview(i) : reviewStatus(500);
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

async function seedPullRequest(handle: AppDatabase): Promise<void> {
  await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrState.OPEN,
  });
}

/**
 * The Brief the submit names, plus the drafts the session holds — one
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
      filePath: "src/a.ts",
      side: DraftCommentSide.NEW,
      startLine: 12,
      endLine: 12,
    },
    {
      filePath: "src/b.ts",
      side: DraftCommentSide.OLD,
      startLine: 25,
      endLine: 30,
    },
  ];
  const written = await repo.reviewSessions.writeToSession(
    {
      briefId: brief.value.id,
      reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
      brief: async () => ({ groupIds: [], flags: [] }),
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

function validBody(): Record<string, unknown> {
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

async function draftStatuses(harness: PgliteHarness): Promise<string[]> {
  const rows = await harness.raw(
    "select status from review_draft_comment order by id",
  );
  return rows.map((row) => String(row["status"]));
}

async function submit(
  app: ApiApp,
  cookie: string | undefined,
  body: unknown,
  path = SUBMIT_PATH,
): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie: `rs_session=${cookie}` }),
    },
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
      brief: async () => ({ groupIds: [], flags: [] }),
    },
    async (writer) =>
      await writer.addDraftComment({
        filePath: "src/c.ts",
        side: DraftCommentSide.NEW,
        startLine: 40,
        endLine: 40,
        body,
        anchorStatus,
      }),
  );
  if (!written.ok) throw new Error("seed: carried draft failed");
  return String(written.value.id);
}

/** One two-side draft (old\u2192new) on the session — start leg on the base. */
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
      brief: async () => ({ groupIds: [], flags: [] }),
    },
    async (writer) =>
      await writer.addDraftComment({
        filePath: "src/c.ts",
        side: DraftCommentSide.NEW,
        startSide: DraftCommentSide.OLD,
        startLine: 10,
        endLine: 12,
        body,
      }),
  );
  if (!written.ok) throw new Error("seed: two-side draft failed");
}

function sessionPath(suffix: string): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session${suffix}?base=${BASE_SHA}&head=${COMMIT_ID}`;
}

/** The two operations the attention list names, over HTTP. */
async function reanchorDraft(
  app: ApiApp,
  cookie: string,
  draftId: string,
): Promise<Response> {
  return await app.request(sessionPath(`/comments/${draftId}/anchor`), {
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
  return await app.request(sessionPath(`/comments/${draftId}`), {
    method: "DELETE",
    headers: { cookie: `rs_session=${cookie}` },
  });
}

async function submitAuditCount(harness: PgliteHarness): Promise<number> {
  const rows = await harness.raw(
    // The choke point records every submit attempt; a SUCCESSFUL submit is
    // the one this suite counts.
    "select count(*)::int as n from audit_log where operation = 'submit-review' and outcome = 'ok'",
  );
  const n = rows[0]?.["n"];
  if (typeof n !== "number") throw new Error("unexpected count result");
  return n;
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

  it("401 when no session cookie is present (no GitHub call)", async () => {
    const counts = stubGitHub({});
    const res = await submit(app, undefined, validBody());
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(0);
    expect(counts.createReview).toBe(0);
  });

  it("404 collapse when the viewer has no access to the repo", async () => {
    stubGitHub({ repositories: () => repoStatus(403) });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(404);
  });

  it("400 on an ill-shaped body (bad outcome, missing outcome, non-JSON)", async () => {
    stubGitHub({ repositories: () => repoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    for (const bad of [{ outcome: "ship-it" }, { body: "no outcome" }, {}]) {
      const res = await submit(app, cookie, bad);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("400 on a neutral comment submit the session has nothing for", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle, []);
    const res = await submit(app, cookie, { outcome: "comment" });
    expect(res.status).toBe(400);
    expect(counts.createReview).toBe(0);
  });

  it("400 on request-changes without a body (GitHub requires one) — no GitHub call", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    const res = await submit(app, cookie, { outcome: "request-changes" });
    expect(res.status).toBe(400);
    expect(counts.createReview).toBe(0);
  });

  it("400 when the held drafts could not be folded within the body budget (no GitHub call)", async () => {
    // Every accepted submit must be representable by the degradation fold:
    // individually-valid drafts whose FOLDED body would exceed GitHub's cap
    // are rejected deterministically before any upstream side effect.
    const counts = stubGitHub({ repositories: () => repoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle, [
      "x".repeat(40_000),
      "y".repeat(40_000),
    ]);
    const res = await submit(app, cookie, { outcome: "comment" });
    expect(res.status).toBe(400);
    expect(counts.createReview).toBe(0);
  });

  it("409 draft-anchor-orphaned when the session holds an orphaned draft (no GitHub call)", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    await seedCarriedDraft(harness.handle, briefId, AnchorStatus.ORPHANED);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(409);
    expect(await readWireCode(res)).toBe("draft-anchor-orphaned");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Refused before the mutating write's fresh slug resolve, and long before
    // the review POST: the gate's own lookup is the only upstream call made.
    expect(counts.repositories).toBe(1);
    expect(counts.createReview).toBe(0);
    // Nothing is deleted for the reviewer: every draft is still held.
    expect(await draftStatuses(harness)).toEqual(["draft", "draft", "draft"]);
  });

  it("a moved anchor is not orphaned — the submit posts it at its carried coordinates", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: () => reviewCreated(987001),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    await seedCarriedDraft(
      harness.handle,
      briefId,
      AnchorStatus.MOVED,
      "moved note",
    );

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    expect(counts.createReview).toBe(1);
    const posted = z
      .object({ comments: z.array(z.object({ body: z.string() })) })
      .parse(counts.reviewBodies[0]);
    expect(posted.comments.map((row) => row.body)).toEqual([
      "anchored note",
      "multi-line note",
      "moved note",
    ]);
  });

  it("re-anchoring the orphaned draft clears the refusal", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: () => reviewCreated(987001),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    const draftId = await seedCarriedDraft(
      harness.handle,
      briefId,
      AnchorStatus.ORPHANED,
    );
    expect((await submit(app, cookie, validBody())).status).toBe(409);

    expect((await reanchorDraft(app, cookie, draftId)).status).toBe(200);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    expect(counts.createReview).toBe(1);
    // Re-placed, then published — the draft the reviewer wrote still lands.
    expect(await draftStatuses(harness)).toEqual([
      "submitted",
      "submitted",
      "submitted",
    ]);
  });

  it("deleting the orphaned draft clears the refusal", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: () => reviewCreated(987001),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle);
    const draftId = await seedCarriedDraft(
      harness.handle,
      briefId,
      AnchorStatus.ORPHANED,
    );
    expect((await submit(app, cookie, validBody())).status).toBe(409);

    expect((await deleteDraft(app, cookie, draftId)).status).toBe(200);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    expect(counts.createReview).toBe(1);
    expect(await draftStatuses(harness)).toEqual(["submitted", "submitted"]);
  });

  it("404 when the PR row does not exist in the tenant", async () => {
    stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(404);
  });

  it("posts ONE grouped formal review pinned to commitId; audit row; NO checkpoint", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: () => reviewCreated(987001),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const payload: unknown = await res.json();
    expect(payload).toEqual({ reviewId: 987001, commentsDegraded: false });

    // Exactly ONE per-repo gate ran (mount order: the submit route's gate is
    // the only one a POST traverses), plus the route's own FRESH slug resolve
    // for the mutating write — two /repositories/{id} calls, no more.
    expect(counts.repositories).toBe(2);
    // Exactly one grouped POST, wire shape pinned to the viewed head.
    expect(counts.createReview).toBe(1);
    expect(counts.reviewBodies[0]).toEqual({
      commit_id: COMMIT_ID,
      event: "REQUEST_CHANGES",
      body: "overall verdict",
      comments: [
        { path: "src/a.ts", line: 12, side: "RIGHT", body: "anchored note" },
        {
          path: "src/b.ts",
          line: 30,
          side: "LEFT",
          start_line: 25,
          start_side: "LEFT",
          body: "multi-line note",
        },
      ],
    });

    // Audit: one `submit` row. Checkpoint: NONE — the webhook is the only
    // checkpoint writer; the route must never write it.
    expect(await submitAuditCount(harness)).toBe(1);
    const checkpoints = await harness.raw(
      "select count(*)::int as n from checkpoint",
    );
    expect(checkpoints[0]?.["n"]).toBe(0);
  });

  it("maps a two-side draft to GitHub's start_side on the grouped POST", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: () => reviewCreated(987003),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle, []);
    await seedTwoSideDraft(harness.handle, briefId);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    const posted = z
      .object({ comments: z.array(z.record(z.string(), z.unknown())) })
      .parse(counts.reviewBodies[0]);
    expect(posted.comments).toEqual([
      {
        path: "src/c.ts",
        line: 12,
        side: "RIGHT",
        start_line: 10,
        start_side: "LEFT",
        body: "crosses sides",
      },
    ]);
  });

  it("folds a two-side range with both sides spelled out", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: (call) =>
        call === 0 ? anchoring422() : reviewCreated(987004),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const briefId = await seedSessionDrafts(harness.handle, []);
    await seedTwoSideDraft(harness.handle, briefId);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    const retry = z.object({ body: z.string() }).parse(counts.reviewBodies[1]);
    // Cross-side line numbers mean nothing without their sides.
    expect(retry.body).toContain("src/c.ts:LEFT 10-RIGHT 12");
    expect(retry.body).toContain("crosses sides");
  });

  it("publishes exactly the held drafts and records the review id", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: () => reviewCreated(987001),
    });
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
        brief: async () => ({ groupIds: [], flags: [] }),
      },
      async (writer) => {
        const first = (await writer.draftComments())[0];
        if (first === undefined) throw new Error("no draft to publish");
        await writer.publishDraftComments([first.id]);
      },
    );

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    const posted = z
      .object({ comments: z.array(z.object({ body: z.string() })) })
      .parse(counts.reviewBodies[0]);
    expect(posted.comments.map((row) => row.body)).toEqual(["multi-line note"]);
    expect(await draftStatuses(harness)).toEqual(["submitted", "submitted"]);
    const recorded = await harness.raw(
      "select github_review_id from review_submitted_review",
    );
    expect(recorded.map((row) => String(row["github_review_id"]))).toEqual([
      "987001",
    ]);
  });

  /** A capture-logging app over the same harness, for the two post-write logs. */
  function capturingApp(): {
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

  it("keeps the 201 and logs a plain error when the bookkeeping dies after the post", async () => {
    // The GitHub write is the commit point: a local failure after it must
    // never read as "nothing was submitted", which would invite a second
    // review. `audit.fail` is NOT this failure — it names an audit ROW that
    // would not persist, and raising it here alerts on the wrong thing.
    const { capture, app: captureApp } = capturingApp();
    stubGitHub({
      repositories: () => repoOk(),
      createReview: () => reviewCreated(987001),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    await harness.raw(
      "alter table review_submitted_review rename to review_submitted_review_poisoned",
    );

    const res = await submit(captureApp, cookie, validBody());
    expect(res.status).toBe(201);
    const line = capture
      .lines()
      .find((l) => l["msg"] === "session unrecorded after a submitted review");
    expect(line?.["level"]).toBe("error");
    expect(line?.["evt"]).toBeUndefined();
    expect(line?.["reviewId"]).toBe("987001");
    expect(capture.lines().some((l) => l["evt"] === "audit.fail")).toBe(false);
  });

  it("keeps the 201 and logs audit.fail when the audit row will not persist", async () => {
    // The emit is the router choke point's, so the line names the operation
    // by its descriptor id rather than the route's own bookkeeping.
    const { capture, app: captureApp } = capturingApp();
    stubGitHub({
      repositories: () => repoOk(),
      createReview: () => reviewCreated(987002),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);
    await harness.raw("alter table audit_log rename to audit_log_poisoned");

    const res = await submit(captureApp, cookie, validBody());
    expect(res.status).toBe(201);
    const line = capture.lines().find((l) => l["evt"] === "audit.fail");
    expect(line?.["level"]).toBe("error");
    expect(line?.["operation"]).toBe("submit-review");
    await harness.raw("alter table audit_log_poisoned rename to audit_log");
  });

  it("409s a frozen session before spending a GitHub write", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: () => reviewCreated(),
    });
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
        brief: async () => ({ groupIds: [], flags: [] }),
      },
      (writer) => writer.putReadMark({ chunkId: "c1" }),
    );

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(409);
    expect(await readWireCode(res)).toBe("pr-changed-since-read");
    expect(counts.createReview).toBe(0);
    // Only the gate's own access check ran — the route never re-resolved.
    expect(counts.repositories).toBe(1);
    expect(await draftStatuses(harness)).not.toContain("submitted");
  });

  it("posts to the FRESHLY resolved repo slug, never the gate's cached name", async () => {
    // A mutating write must not trust the gate's positive-cache slug (≤60s
    // stale after a rename + name-reuse): the route re-resolves owner/name by
    // the NUMERIC repo id immediately before the create call.
    const counts = stubGitHub({
      repositories: (call) =>
        call === 0
          ? repoOk() // the gate's access check caches octo/hello
          : jsonResponse({
              id: REPO_ID,
              full_name: "octo/renamed",
              private: true,
            }),
      createReview: () => reviewCreated(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    expect(counts.reviewUrls[0]).toContain(
      "/repos/octo/renamed/pulls/7/reviews",
    );
  });

  it("404 collapse when the fresh resolve is denied (revoked inside the cache TTL)", async () => {
    // The gate passes (positive cache semantics), but access was revoked
    // before the route's fresh resolve — the denial must collapse to the
    // same 404 a cold gate denial produces, never a distinguishable 502.
    const counts = stubGitHub({
      repositories: (call) => (call === 0 ? repoOk() : repoStatus(403)),
      createReview: () => reviewCreated(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(404);
    expect(counts.createReview).toBe(0);
  });

  it("refreshes once on an expired access token mid-submit and completes", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      createReview: (call) =>
        call === 0 ? reviewStatus(401) : reviewCreated(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    expect(counts.token).toBe(1);
    expect(counts.createReview).toBe(2);
    expect(await submitAuditCount(harness)).toBe(1);
  });

  it("anchoring 422 → ONE degradation retry with comments folded into the body", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: (call) =>
        call === 0 ? anchoring422() : reviewCreated(987002),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    const payload: unknown = await res.json();
    expect(payload).toEqual({ reviewId: 987002, commentsDegraded: true });

    expect(counts.createReview).toBe(2);
    const retry = counts.reviewBodies[1];
    if (typeof retry !== "object" || retry === null)
      throw new Error("expected a retry body");
    // No anchored comments on the retry; everything folded into the body.
    expect("comments" in retry).toBe(false);
    const record = retry as Record<string, unknown>;
    expect(record["commit_id"]).toBe(COMMIT_ID);
    const body = record["body"];
    if (typeof body !== "string") throw new Error("expected a folded body");
    expect(body).toContain("overall verdict");
    expect(body).toContain("src/a.ts:12");
    expect(body).toContain("src/b.ts:25-30");
    expect(body).toContain("anchored note");
    expect(body).toContain("multi-line note");
    expect(await submitAuditCount(harness)).toBe(1);
  });

  it("refreshes once when the token expires between the anchored attempt and the degradation retry", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      // Anchoring 422 → degradation retry hits an expired token (401) → one
      // refresh → the folded retry lands.
      createReview: (call) =>
        call === 0
          ? anchoring422()
          : call === 1
            ? reviewStatus(401)
            : reviewCreated(987003),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    const payload: unknown = await res.json();
    expect(payload).toEqual({ reviewId: 987003, commentsDegraded: true });
    expect(counts.token).toBe(1);
    expect(counts.createReview).toBe(3);
  });

  it("degradation retry failing again surfaces a sanitized upstream error", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      createReview: () => anchoring422(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(502);
    const payload: unknown = await res.json();
    expect(JSON.stringify(payload)).not.toContain("thread line");
    expect(await submitAuditCount(harness)).toBe(0);
  });

  it("unknown-commit 422 fails closed with 409 and no retry, no audit", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: () => unknownCommit422(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(409);
    // Error responses keep the gated-route no-store posture too.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(counts.createReview).toBe(1); // never retried at another SHA
    const payload: unknown = await res.json();
    expect(JSON.stringify(payload)).not.toContain("commit_id");
    expect(await submitAuditCount(harness)).toBe(0);
  });

  it("double-submit produces two reviews (documented-allowed; guard is FE-only)", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: (call) => reviewCreated(987001 + call),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    await seedSessionDrafts(harness.handle);

    const first = await submit(app, cookie, validBody());
    const second = await submit(app, cookie, validBody());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(counts.createReview).toBe(2);
    expect(await submitAuditCount(harness)).toBe(2);
  });
});
