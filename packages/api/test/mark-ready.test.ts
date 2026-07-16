// Mark-ready route integration tests (BRIEF-43 PR 2): `app.request()` against
// `createApp` over the PGlite harness, GitHub stubbed at the global-fetch seam
// (same pattern as review-submit.test.ts). Covers: gate posture (401/404
// collapse), the fresh-flip happy path (row draft flipped + audit emitted),
// already-ready convergence (200, no error), the GraphQL "not a draft" race
// convergence, a hard GitHub failure leaving the row untouched, refresh-once
// mid-request, and the double-POST idempotency guard.
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

// Some cases make several full requests over the PGlite harness (double-POST,
// refresh-once). GraphQL is not throttled, but give the file headroom.
vi.setConfig({ testTimeout: 20_000 });

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_ID = 424242;
const REPO_SLUG = "octo/hello";
const PR_NUMBER = 7;
const NODE_ID = "PR_kwDOABCD";

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
// GitHub HTTP stub (global fetch) — REST /repositories/:id + the GraphQL POST.
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
function nodeIdGraphql(isDraft: boolean): Response {
  return jsonResponse({ data: { repository: { pullRequest: { id: NODE_ID, isDraft } } } });
}
function mutationGraphql(): Response {
  return jsonResponse({
    data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } },
  });
}
function notADraftGraphql(): Response {
  // GitHub's GraphQL error envelope for marking a non-draft PR ready.
  return jsonResponse({ data: null, errors: [{ message: "Pull request is not a draft" }] });
}
function graphqlError(): Response {
  // A GraphQL-level error (HTTP 200 + errors) — maps to REQUEST_FAILED → 502.
  // NOT an HTTP 5xx, which octokit's retry plugin would back off and retry.
  return jsonResponse({ data: null, errors: [{ type: "INTERNAL", message: "boom" }] });
}
function forbiddenGraphql(): Response {
  // GitHub's GraphQL FORBIDDEN envelope for the mark-ready MUTATION when the
  // App lacks `contents: write` — the community-documented permission gap.
  return jsonResponse({
    data: null,
    errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }],
  });
}
function graphqlUnauthorized(): Response {
  // HTTP 401 → octokit.graphql throws a RequestError(401) → UNAUTHORIZED.
  return jsonResponse({ message: "Bad credentials" }, 401);
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
  /** Each GraphQL POST in order (resolve, then mutation). */
  readonly graphql?: (call: number) => Response;
  readonly token?: (call: number) => Response;
}
interface StubCounts {
  repositories: number;
  graphql: number;
  token: number;
  /** Parsed JSON body of each GraphQL POST, in order. */
  readonly graphqlBodies: Array<Record<string, unknown>>;
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = { repositories: 0, graphql: 0, token: 0, graphqlBodies: [] };
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
    if (url.endsWith("/graphql")) {
      const i = counts.graphql++;
      const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
      if (typeof raw === "string") {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          counts.graphqlBodies.push({ ...parsed });
        }
      }
      return cfg.graphql ? cfg.graphql(i) : jsonResponse({ data: null }, 500);
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

async function seedDraftPr(handle: AppDatabase, draft = true): Promise<void> {
  await forTenant(handle, CTX).pullRequests.upsert({
    repoId: brandRepo(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    draft,
    state: PrState.OPEN,
  });
}

async function readDraft(handle: AppDatabase): Promise<boolean | undefined> {
  const row = await forTenant(handle, CTX).pullRequests.getByNumber(
    brandRepo(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  return row?.draft;
}

async function markReadyAuditCount(harness: PgliteHarness): Promise<number> {
  const rows = await harness.raw("select count(*)::int as n from audit_log where action = 'mark-ready'");
  const n = rows[0]?.["n"];
  if (typeof n !== "number") throw new Error("unexpected count result");
  return n;
}

// ---------------------------------------------------------------------------
// Request helper.
// ---------------------------------------------------------------------------

const READY_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/ready`;

async function markReady(app: Hono, cookie: string | undefined, path = READY_PATH): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie: `rs_session=${cookie}` }),
    },
  });
}

// Conversation port stub (BRIEF-25): never exercised by this route.
const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
};

describe("POST /api/repos/:repoId/pulls/:prNumber/ready", () => {
  let harness: PgliteHarness;
  let app: Hono;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = keyProvider();
    app = createApp({ handle: harness.handle, webhookSecret: SECRET, auth: authDeps(kp), github: unusedConversationPort });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  it("401 when no session cookie is present (no GitHub call)", async () => {
    const counts = stubGitHub({});
    const res = await markReady(app, undefined);
    expect(res.status).toBe(401);
    expect(counts.repositories).toBe(0);
    expect(counts.graphql).toBe(0);
  });

  it("404 collapse when the viewer has no access to the repo", async () => {
    stubGitHub({ repositories: () => repoStatus(403) });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await markReady(app, cookie);
    expect(res.status).toBe(404);
    // Row untouched — the mutation never ran.
    expect(await readDraft(harness.handle)).toBe(true);
  });

  it("404 collapse when the IN-ROUTE fresh repo resolve is denied (gate passed)", async () => {
    // The gate's access check (call 0) passes; the route's own fresh
    // fetchRepositoryById (call 1) is denied — a viewer whose access was
    // revoked inside the positive-cache TTL. Must collapse to the gate's 404
    // posture, run no mutation, and leave the row untouched.
    const counts = stubGitHub({
      repositories: (i) => (i === 0 ? repoOk() : repoStatus(403)),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await markReady(app, cookie);
    expect(res.status).toBe(404);
    expect(counts.graphql).toBe(0);
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await markReadyAuditCount(harness)).toBe(0);
  });

  it("resolves the PR against the FRESHLY fetched owner/name, never the gate's cached slug", async () => {
    // A mutating write must not trust the gate's positive-cache slug (≤60s
    // stale after a rename + name-reuse): the GraphQL resolve must carry the
    // owner/name from the route's own fresh /repositories/{id} fetch.
    const counts = stubGitHub({
      repositories: (i) =>
        i === 0
          ? repoOk() // the gate's access check caches octo/hello
          : jsonResponse({ id: REPO_ID, full_name: "octo/renamed", private: true }),
      graphql: (i) => (i === 0 ? nodeIdGraphql(true) : mutationGraphql()),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await markReady(app, cookie);
    expect(res.status).toBe(200);
    expect(counts.graphqlBodies[0]).toMatchObject({
      variables: { owner: "octo", repo: "renamed", prNumber: PR_NUMBER },
    });
  });

  it("401 when a second GitHub 401 lands after the one refresh (budget spent, no second refresh)", async () => {
    // One refresh-once budget per REQUEST: the first GraphQL 401 spends it;
    // when the retried call 401s again the route must NOT refresh a second
    // time — it returns 401 and leaves the row untouched.
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      graphql: () => graphqlUnauthorized(),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await markReady(app, cookie);
    expect(res.status).toBe(401);
    expect(counts.token).toBe(1);
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await markReadyAuditCount(harness)).toBe(0);
  });

  it("404 when the PR is not in the tenant (no GitHub mutation)", async () => {
    const counts = stubGitHub({ repositories: () => repoOk() });
    const { cookie } = await seedSession(harness.handle, kp);
    const res = await markReady(app, cookie);
    expect(res.status).toBe(404);
    expect(counts.graphql).toBe(0);
  });

  it("200 on the fresh-flip happy path: mutation runs, row flips, audit emitted", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) => (i === 0 ? nodeIdGraphql(true) : mutationGraphql()),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await markReady(app, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ draft: false });
    // Resolve + mutation = two GraphQL calls; the mutation carries the node id.
    expect(counts.graphql).toBe(2);
    const mutationBody = counts.graphqlBodies[1];
    expect(JSON.stringify(mutationBody)).toContain(NODE_ID);
    // Local mirror flipped and the mark-ready audit row is present.
    expect(await readDraft(harness.handle)).toBe(false);
    expect(await markReadyAuditCount(harness)).toBe(1);
  });

  it("200 converged when the PR is already out of draft (no mutation), still audits + flips", async () => {
    const counts = stubGitHub({
      repositories: () => repoOk(),
      graphql: () => nodeIdGraphql(false),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await markReady(app, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ draft: false });
    // Only the resolve call — the read-time non-draft short-circuits.
    expect(counts.graphql).toBe(1);
    expect(await readDraft(harness.handle)).toBe(false);
    expect(await markReadyAuditCount(harness)).toBe(1);
  });

  it("200 converged when the mutation races a concurrent ready ('not a draft')", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) => (i === 0 ? nodeIdGraphql(true) : notADraftGraphql()),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await markReady(app, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ draft: false });
    expect(await readDraft(harness.handle)).toBe(false);
  });

  it("502 and row untouched on a hard GitHub mutation failure", async () => {
    stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) => (i === 0 ? nodeIdGraphql(true) : graphqlError()),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await markReady(app, cookie);
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Draft NOT flipped: GitHub is the source of truth and it rejected.
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await markReadyAuditCount(harness)).toBe(0);
  });

  it("403 github-permission (NOT the 404 collapse) on a MUTATION-stage FORBIDDEN — the App lacks contents:write", async () => {
    // The gate AND the fresh re-resolve both succeed (the viewer has proven
    // repo access), then the node-id resolve succeeds and only the mutation
    // 403s: an App permission gap, not an access revocation. It must be a
    // distinct, honestly-actionable 403 — never the existence-hiding 404 —
    // while leaving the row untouched, emitting no audit, and staying no-store.
    const counts = stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) => (i === 0 ? nodeIdGraphql(true) : forbiddenGraphql()),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await markReady(app, cookie);
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "github-permission" });
    // Reached the mutation (resolve + mutation = 2 GraphQL calls).
    expect(counts.graphql).toBe(2);
    // Row untouched, no audit — GitHub rejected the write.
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await markReadyAuditCount(harness)).toBe(0);
  });

  it("fresh-resolve FORBIDDEN still collapses to 404 (existence-leak posture unchanged)", async () => {
    // Distinct from the mutation-stage 403 above: a FORBIDDEN at the in-route
    // fresh /repositories/{id} resolve (BEFORE the viewer re-proves access this
    // request) must keep collapsing to the gate's 404 posture.
    const counts = stubGitHub({
      repositories: (i) => (i === 0 ? repoOk() : repoStatus(403)),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await markReady(app, cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(counts.graphql).toBe(0);
    expect(await readDraft(harness.handle)).toBe(true);
    expect(await markReadyAuditCount(harness)).toBe(0);
  });

  it("refreshes the token once when a GraphQL call 401s mid-request, then succeeds", async () => {
    // The route's refresh-once budget is shared across the whole op: the first
    // resolve 401s (expired token), the route refreshes once, and the retried
    // op (resolve + mutation) lands. Gate + route-resolve keep repositories at 2.
    const counts = stubGitHub({
      repositories: () => repoOk(),
      token: () => tokenSuccess(),
      graphql: (i) =>
        i === 0 ? graphqlUnauthorized() : i === 1 ? nodeIdGraphql(true) : mutationGraphql(),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const res = await markReady(app, cookie);
    expect(res.status).toBe(200);
    expect(counts.token).toBe(1);
    expect(counts.repositories).toBe(2);
    expect(counts.graphql).toBe(3);
    expect(await readDraft(harness.handle)).toBe(false);
  });

  it("double-POST: both converge to 200 and the row stays draft=false (idempotent)", async () => {
    // First POST flips via the mutation; the second reads isDraft=false at
    // resolve time (GitHub is now non-draft) and converges without mutating.
    stubGitHub({
      repositories: () => repoOk(),
      graphql: (i) => (i === 0 ? nodeIdGraphql(true) : i === 1 ? mutationGraphql() : nodeIdGraphql(false)),
    });
    await seedDraftPr(harness.handle);
    const { cookie } = await seedSession(harness.handle, kp);

    const first = await markReady(app, cookie);
    const second = await markReady(app, cookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await readDraft(harness.handle)).toBe(false);
    // Two audit rows — each accepted request records its action.
    expect(await markReadyAuditCount(harness)).toBe(2);
  });
});
