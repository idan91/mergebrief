// The session read, end to end over the PGlite harness: it answers on both
// sides of materialization, projects the Attention List off the rows it
// returns, and — the invariant the suite exists for — CREATES NOTHING. Every
// case asserts the `review_session` row count across the call.
import { createHash, randomBytes } from "node:crypto";
import {
  AnchorStatus,
  ChangeGroupCategory,
  DispositionDecision,
  DraftCommentSide,
  PrState,
  artifactStore,
  encryptToken,
  envKeyProvider,
  forTenant,
  grantAuth,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type AppDatabase,
  type BriefRowId,
  type InstallationId,
  type KeyProvider,
  type RepoId,
  type ReviewerId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AuthDeps } from "../src/index";
import { testLogger } from "./logging";

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const INSTALLATION_ID = 987654;
const REVIEWER_ID = 555;
const REPO_ID = 424242;
const REPO_SLUG = "octo/hello";
const PR_NUMBER = 7;

/** Two flags firing on one file, and one change group — the carry inputs. */
const BRIEF_BODY = JSON.stringify({
  summary: "the brief",
  changeGroups: [{ id: "g1", title: "t" }],
  chunks: [
    {
      id: "c1",
      file: "src/app.ts",
      addedRanges: [{ start: 5, end: 40 }],
      removedRanges: [],
      riskSurface: ["no-tests"],
    },
    {
      id: "c2",
      file: "src/other.ts",
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
    },
  ],
});

const NO_ARTIFACT = { groupIds: [], flags: [] };

/** The payload's shape as the assertions read it — the test-side boundary. */
interface SessionBody {
  readonly materialized: boolean;
  readonly carriedFrom: {
    readonly sessionId: string;
    readonly headSha: string;
    readonly revisions: number;
  } | null;
  readonly readMarks: readonly string[];
  readonly draftComments: readonly Record<string, unknown>[];
  readonly reclassifications: readonly Record<string, unknown>[];
  readonly submittedReviewIds: readonly string[];
  readonly attention: readonly {
    readonly kind: string;
    readonly subject: { readonly type: string; readonly id: string | null };
    readonly location: Record<string, unknown> | null;
    readonly clearedBy: readonly string[];
  }[];
}

async function bodyOf(res: Response): Promise<SessionBody> {
  return (await res.json()) as SessionBody;
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
const REVIEWER = brandReviewer(BigInt(REVIEWER_ID));

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** The gate's only outward call: the repo access check. */
function stubGitHub(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = urlOf(input);
      if (url.includes("/repositories/")) {
        return jsonResponse({
          id: REPO_ID,
          full_name: REPO_SLUG,
          private: true,
        });
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    }),
  );
}

async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
  const sealedAccess = await encryptToken(kp, KEY_REF, "ghu_ACCESS");
  const sealedRefresh = await encryptToken(kp, KEY_REF, "ghr_REFRESH");
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed encrypt failed");
  }
  const expiresAt = new Date("2027-01-01T00:00:00Z");
  const grant = await grantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: expiresAt,
  });
  await forTenant(handle, CTX).sessions.create({
    sessionTokenHash: createHash("sha256").update(cookie).digest("hex"),
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt,
  });
  return cookie;
}

async function seedPullRequest(handle: AppDatabase): Promise<void> {
  await forTenant(handle, CTX).pullRequests.upsert({
    repoId: brandRepo(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrState.OPEN,
  });
}

/** One Brief at `head-<index>`; the base never moves. */
async function seedBrief(
  handle: AppDatabase,
  headIndex: number,
  body: string = BRIEF_BODY,
): Promise<BriefRowId> {
  const pr = await forTenant(handle, CTX).pullRequests.getByNumber(
    brandRepo(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) throw new Error("seedBrief: pr missing");
  const written = await artifactStore(handle, CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: "base",
    headSha: `head-${headIndex}`,
    headIndex,
    commitCount: 1,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body,
  });
  if (!written.ok) throw new Error(`seedBrief: ${written.error.code}`);
  return written.value.id;
}

/**
 * A previous session holding work that cannot be re-placed: no `hunk_span`
 * row links the two heads, so the chain is untrustworthy and every anchor
 * orphans — an orphaned draft comment and a reopened disposition.
 */
async function seedPreviousWork(
  handle: AppDatabase,
  briefId: BriefRowId,
): Promise<void> {
  const repo = forTenant(handle, CTX);
  const session = await repo.reviewSessions.upsert({
    briefId,
    reviewerId: REVIEWER,
  });
  if (!session.ok) throw new Error("previous session seed failed");
  const added = await repo.reviewSessions.addDraftComment({
    reviewSessionId: session.value.id,
    filePath: "src/app.ts",
    side: DraftCommentSide.NEW,
    startLine: 10,
    endLine: 12,
    body: "this allocation is unbounded",
  });
  if (!added.ok) throw new Error("previous draft comment seed failed");
  await repo.reviewSessions.putReclassification({
    reviewSessionId: session.value.id,
    changeGroupId: "g1",
    category: ChangeGroupCategory.LOGIC_REFACTOR,
  });
  await repo.reviewSessions.writeToSession(
    { briefId, reviewerId: REVIEWER, brief: async () => NO_ARTIFACT },
    (writer) =>
      writer.putDisposition({
        filePath: "src/app.ts",
        attribute: "no-tests",
        regionStart: 10,
        regionEnd: 12,
        decision: DispositionDecision.DISMISSED,
        reason: "covered by the integration suite",
      }),
  );
}

function sessionPath(head: string): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session?base=base&head=${head}`;
}

describe("read-review-session", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;
  let cookie: string;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = keyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: authDeps(kp),
      github: {
        fetchPullRequestConversation: () => {
          throw new Error("conversation port must not be called");
        },
        listRepoCollaborators: () => {
          throw new Error("collaborators port must not be called");
        },
      },
    });
    stubGitHub();
    cookie = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  async function sessionRows(): Promise<number> {
    const rows = await harness.raw(
      "select count(*)::int as n from review_session",
    );
    return Number(rows[0]?.["n"] ?? -1);
  }

  async function read(head: string): Promise<Response> {
    return app.request(sessionPath(head), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
  }

  it("answers a first-ever session with no carry-over and no row", async () => {
    await seedBrief(harness.handle, 1);

    const res = await read("head-1");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await bodyOf(res);
    expect(body.materialized).toBe(false);
    // Null here is what tells a first-ever session from one that carried and
    // has nothing pending — two different rows in the UI.
    expect(body.carriedFrom).toBeNull();
    expect(body.attention).toEqual([]);
    expect(await sessionRows()).toBe(0);
  });

  it("returns the evaluated carry-over and its attention list, creating nothing", async () => {
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    const before = await sessionRows();

    const res = await read("head-2");

    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.materialized).toBe(false);
    // The span the carry-over row states: where the work came from, and how
    // many pushes since.
    expect(body.carriedFrom).toEqual({
      sessionId: expect.any(String),
      headSha: "head-1",
      revisions: 1,
    });
    // Silent carry: the reclassification's group still exists on the new
    // Brief.
    expect(body.reclassifications).toEqual([
      { changeGroupId: "g1", category: "logic-refactor" },
    ]);
    expect(body.submittedReviewIds).toEqual([]);
    expect(body.draftComments).toEqual([
      expect.objectContaining({
        id: null,
        anchorStatus: AnchorStatus.ORPHANED,
      }),
    ]);
    expect(body.attention).toEqual([
      {
        kind: "orphaned-anchor",
        subject: { type: "draft-comment", id: null },
        location: { filePath: "src/app.ts", startLine: 10, endLine: 12 },
        clearedBy: ["reanchor-draft-comment", "delete-draft-comment"],
      },
      {
        kind: "reopened-disposition",
        subject: { type: "disposition", id: null },
        location: { filePath: "src/app.ts", startLine: 10, endLine: 12 },
        clearedBy: ["address-risk", "dismiss-risk"],
      },
    ]);
    // The proof: a Brief with a previous session, read twice, still no new row.
    await read("head-2");
    expect(await sessionRows()).toBe(before);
  });

  it("returns the session's own rows once it materialized", async () => {
    const previous = await seedBrief(harness.handle, 1);
    const current = await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    const written = await forTenant(
      harness.handle,
      CTX,
    ).reviewSessions.writeToSession(
      {
        briefId: current,
        reviewerId: REVIEWER,
        brief: async () => NO_ARTIFACT,
      },
      async (writer) => {
        await writer.putReadMark({ chunkId: "c1" });
        await writer.recordSubmittedReview({ githubReviewId: 7700n });
      },
    );
    expect(written.ok).toBe(true);
    const before = await sessionRows();

    const res = await read("head-2");

    const body = await bodyOf(res);
    expect(body.materialized).toBe(true);
    expect(body.readMarks).toEqual(["c1"]);
    expect(body.submittedReviewIds).toEqual(["7700"]);
    // Carried in, and it still says so after the write that materialized it.
    expect(body.carriedFrom?.headSha).toBe("head-1");
    // The same list, now off the session's own rows — the subject has an id
    // to act on. The carried disposition dropped: the write that materialized
    // this session named no flags, so it is silent rather than unclearable.
    expect(body.attention).toEqual([
      {
        kind: "orphaned-anchor",
        subject: { type: "draft-comment", id: expect.stringMatching(/^\d+$/) },
        location: { filePath: "src/app.ts", startLine: 10, endLine: 12 },
        clearedBy: ["reanchor-draft-comment", "delete-draft-comment"],
      },
    ]);
    expect(await sessionRows()).toBe(before);
  });

  it("fails the read rather than dropping decisions on an unreadable Brief", async () => {
    // Empty facts would read as "no flag fires any more" and mark every
    // carried decision DROPPED — silently, and on a path that also
    // materializes. A failed read the reviewer can retry is the only
    // acceptable answer.
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2, "{ not json");
    await seedPreviousWork(harness.handle, previous);
    const before = await sessionRows();

    const res = await read("head-2");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal-error" });
    expect(await sessionRows()).toBe(before);
  });

  it("treats a body missing the carry keys as unreadable, not as empty facts", async () => {
    // Valid JSON that says nothing the evaluation needs. Defaulting these two
    // to [] is the same silent mass-DROPPED as a body that will not parse.
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2, '{"summary":"the brief"}');
    await seedPreviousWork(harness.handle, previous);

    const res = await read("head-2");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal-error" });
  });

  it("404s an unknown span and 400s a malformed request", async () => {
    await seedBrief(harness.handle, 1);

    expect((await read("head-9")).status).toBe(404);
    const noHead = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session?base=base`,
      { headers: { Cookie: `rs_session=${cookie}` } },
    );
    expect(noHead.status).toBe(400);
    expect(await sessionRows()).toBe(0);
  });

  it("401s without a session cookie", async () => {
    const res = await app.request(sessionPath("head-1"));
    expect(res.status).toBe(401);
  });
});
