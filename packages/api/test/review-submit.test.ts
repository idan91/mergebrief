// Submit-route integration tests (BRIEF-23 PR 2): `app.request()` against
// `createApp` over the PGlite harness, GitHub stubbed at the global-fetch seam
// (same pattern as reads.test.ts). Covers: gate posture (401/404 collapse),
// body validation, the grouped create-review POST pinned to commitId,
// refresh-once mid-submit, the one degradation retry on an anchoring 422, the
// fail-closed unknown-commit 409, audit-on-success, checkpoint NOT written by
// the route (webhook-only writer), and double-submit = two reviews.
import { createHash, randomBytes } from "node:crypto";
import type { Hono } from "hono";
import {
  encryptToken,
  envKeyProvider,
  forTenant,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrState,
  type AppDatabase,
  type InstallationId,
  type KeyProvider,
  type RepoId,
  type ReviewerId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type AuthDeps } from "../src/lib";

// POST /pulls/{n}/reviews is on octokit's `triggersNotification` list, so the
// throttling plugin spaces consecutive create-review calls ~3s apart through
// MODULE-GLOBAL Bottleneck groups (shared across every test in this file, and
// unfakeable: freezing/rewinding Date.now poisons the shared limiters — see
// reads.test.ts). Tests that make a second POST therefore legitimately take
// seconds; give the file the headroom instead of fighting the throttle.
vi.setConfig({ testTimeout: 30_000 });

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_ID = 424242;
const REPO_SLUG = "octo/hello";
const PR_NUMBER = 7;
const COMMIT_ID = "c".repeat(40);

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";

function keyProvider(): KeyProvider {
  return envKeyProvider({ [KEY_REF]: randomBytes(32).toString("base64") });
}

function authDeps(kp: KeyProvider): AuthDeps {
  return {
    oauthClientId: "Iv1.test-client-id",
    oauthClientSecret: "test-client-secret",
    keyProvider: kp,
    sessionKeyRef: KEY_REF,
    publicBaseUrl: "https://app.example.test",
    cookieSecure: true,
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function brandInstallation(value: bigint): InstallationId {
  if (!isInstallationId(value)) throw new Error("bad installation id");
  return value;
}
function brandReviewer(value: bigint): ReviewerId {
  if (!isReviewerId(value)) throw new Error("bad reviewer id");
  return value;
}
function brandRepo(value: bigint): RepoId {
  if (!isRepoId(value)) throw new Error("bad repo id");
  return value;
}

const CTX = { installationId: brandInstallation(BigInt(INSTALLATION_ID)) };

// ---------------------------------------------------------------------------
// GitHub HTTP stub (global fetch) — dispatches on URL/method, counts calls.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", date: new Date().toUTCString() },
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
function reviewStatus(status: number, body: unknown = { message: "denied" }): Response {
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
    errors: [{ resource: "PullRequestReview", code: "invalid", field: "commit_id" }],
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
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/login/oauth/access_token")) {
      const i = counts.token++;
      return cfg.token ? cfg.token(i) : jsonResponse({ error: "unexpected_token" }, 500);
    }
    if (url.includes("/repositories/")) {
      const i = counts.repositories++;
      return cfg.repositories ? cfg.repositories(i) : repoStatus(404);
    }
    if (/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/.test(url)) {
      const i = counts.createReview++;
      counts.reviewUrls.push(url);
      const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
      if (typeof raw === "string") {
        counts.reviewBodies.push(JSON.parse(raw));
      }
      return cfg.createReview ? cfg.createReview(i) : reviewStatus(500);
    }
    return jsonResponse({ message: "unexpected endpoint" }, 404);
  });
  vi.stubGlobal("fetch", fetchFn);
  return counts;
}

// ---------------------------------------------------------------------------
// Seeding.
// ---------------------------------------------------------------------------

async function seedSession(handle: AppDatabase, kp: KeyProvider): Promise<{ cookie: string }> {
  const cookie = randomBytes(32).toString("base64url");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok) throw new Error("seed encrypt failed");
  await forTenant(handle, CTX).sessions.create({
    sessionTokenHash: sha256Hex(cookie),
    reviewerId: brandReviewer(BigInt(REVIEWER_ID)),
    reviewerLogin: "octocat",
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return { cookie };
}

async function seedPullRequest(handle: AppDatabase): Promise<void> {
  await forTenant(handle, CTX).pullRequests.upsert({
    repoId: brandRepo(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrState.OPEN,
  });
}

// ---------------------------------------------------------------------------
// Request helpers.
// ---------------------------------------------------------------------------

const SUBMIT_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/review`;

function validBody(): Record<string, unknown> {
  return {
    outcome: "request-changes",
    commitId: COMMIT_ID,
    body: "overall verdict",
    comments: [
      { path: "src/a.ts", line: 12, side: "RIGHT", body: "anchored note" },
      {
        path: "src/b.ts",
        line: 30,
        side: "LEFT",
        startLine: 25,
        startSide: "LEFT",
        body: "multi-line note",
        selectedText: "const x = 1;\nconst y = 2;",
      },
    ],
  };
}

async function submit(app: Hono, cookie: string | undefined, body: unknown, path = SUBMIT_PATH): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie: `rs_session=${cookie}` }),
    },
    body: JSON.stringify(body),
  });
}

async function submitAuditCount(harness: PgliteHarness): Promise<number> {
  const rows = await harness.raw("select count(*)::int as n from audit_log where action = 'submit'");
  const n = rows[0]?.["n"];
  if (typeof n !== "number") throw new Error("unexpected count result");
  return n;
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------

describe("POST /api/repos/:repoId/pulls/:prNumber/review", () => {
  let harness: PgliteHarness;
  let app: Hono;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = keyProvider();
    app = createApp({ handle: harness.handle, webhookSecret: SECRET, auth: authDeps(kp) });
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
    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(404);
  });

  it("400 on an ill-shaped body (bad outcome / non-SHA commitId / bad side)", async () => {
    stubGitHub({ repositories: () => repoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    for (const bad of [
      { ...validBody(), outcome: "ship-it" },
      { ...validBody(), commitId: "main" },
      { ...validBody(), comments: [{ path: "a", line: 1, side: "old", body: "x" }] },
      { ...validBody(), comments: [{ path: "a", line: 0, side: "RIGHT", body: "x" }] },
    ]) {
      const res = await submit(app, cookie, bad);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("400 on a neutral comment submit with no content", async () => {
    stubGitHub({ repositories: () => repoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await submit(app, cookie, { outcome: "comment", commitId: COMMIT_ID, comments: [] });
    expect(res.status).toBe(400);
  });

  it("400 on request-changes without a body (GitHub requires one) — no GitHub call", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await submit(app, cookie, {
      outcome: "request-changes",
      commitId: COMMIT_ID,
      comments: [{ path: "src/a.ts", line: 1, side: "RIGHT", body: "x" }],
    });
    expect(res.status).toBe(400);
    expect(counts.createReview).toBe(0);
  });

  it("400 when the comments could not be folded within the body budget (no GitHub call)", async () => {
    // Every accepted request must be representable by the degradation fold:
    // individually-valid comments whose FOLDED body would exceed GitHub's cap
    // are rejected deterministically before any upstream side effect.
    const counts = stubGitHub({ repositories: () => repoOk() });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await submit(app, cookie, {
      outcome: "comment",
      commitId: COMMIT_ID,
      comments: [
        { path: "src/a.ts", line: 1, side: "RIGHT", body: "x".repeat(40_000) },
        { path: "src/b.ts", line: 2, side: "RIGHT", body: "y".repeat(40_000) },
      ],
    });
    expect(res.status).toBe(400);
    expect(counts.createReview).toBe(0);
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
    const checkpoints = await harness.raw("select count(*)::int as n from checkpoint");
    expect(checkpoints[0]?.["n"]).toBe(0);
  });

  it("posts to the FRESHLY resolved repo slug, never the gate's cached name", async () => {
    // A mutating write must not trust the gate's positive-cache slug (≤60s
    // stale after a rename + name-reuse): the route re-resolves owner/name by
    // the NUMERIC repo id immediately before the create call.
    const counts = stubGitHub({
      repositories: (call) =>
        call === 0
          ? repoOk() // the gate's access check caches octo/hello
          : jsonResponse({ id: REPO_ID, full_name: "octo/renamed", private: true }),
      createReview: () => reviewCreated(),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    expect(counts.reviewUrls[0]).toContain("/repos/octo/renamed/pulls/7/reviews");
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

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(404);
    expect(counts.createReview).toBe(0);
  });

  it("refreshes once on an expired access token mid-submit and completes", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      createReview: (call) => (call === 0 ? reviewStatus(401) : reviewCreated()),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    expect(counts.token).toBe(1);
    expect(counts.createReview).toBe(2);
    expect(await submitAuditCount(harness)).toBe(1);
  });

  it("anchoring 422 → ONE degradation retry with comments folded into the body", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      createReview: (call) => (call === 0 ? anchoring422() : reviewCreated(987002)),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await submit(app, cookie, validBody());
    expect(res.status).toBe(201);
    const payload: unknown = await res.json();
    expect(payload).toEqual({ reviewId: 987002, commentsDegraded: true });

    expect(counts.createReview).toBe(2);
    const retry = counts.reviewBodies[1];
    if (typeof retry !== "object" || retry === null) throw new Error("expected a retry body");
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
    expect(body).toContain("const x = 1;");
    expect(await submitAuditCount(harness)).toBe(1);
  });

  it("refreshes once when the token expires between the anchored attempt and the degradation retry", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      // Anchoring 422 → degradation retry hits an expired token (401) → one
      // refresh → the folded retry lands.
      createReview: (call) =>
        call === 0 ? anchoring422() : call === 1 ? reviewStatus(401) : reviewCreated(987003),
    });
    await seedPullRequest(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

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

    const first = await submit(app, cookie, validBody());
    const second = await submit(app, cookie, validBody());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(counts.createReview).toBe(2);
    expect(await submitAuditCount(harness)).toBe(2);
  });
});
