// The Review Session suites' shared world: one tenant, one repo, one PR, and
// the seeds that put Briefs and a previous session's work behind it. Shared
// because the read suite and the write suite must agree on the fixture — a
// carry-over the read reports and a write writes is the same work.
import { createHash, randomBytes } from "node:crypto";
import {
  DispositionDecision,
  DraftCommentSide,
  ChangeGroupCategory,
  PrState,
  artifactStore,
  encryptToken,
  envKeyProvider,
  forTenant,
  grantAuth,
  isInstallationId,
  isRepoId,
  isReviewerId,
  tokenAuth,
  type AppDatabase,
  type BriefRowId,
  type InstallationId,
  type KeyProvider,
  type RepoId,
  type ReviewerId,
  type TenantContext,
  type WriteClassification,
} from "persistence";
import { vi } from "vitest";
import type { AuthDeps } from "../../src/index";

export const SECRET = "test-webhook-secret";
export const KEY_REF = "SESSION_KEY_V1";
export const INSTALLATION_ID = 987654;
export const REVIEWER_ID = 555;
export const REPO_ID = 424242;
export const REPO_SLUG = "octo/hello";
export const PR_NUMBER = 7;

/** Two flags firing on one file, and one change group — the carry inputs. */
export const BRIEF_BODY = JSON.stringify({
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

export const NO_ARTIFACT = { groupIds: [], flags: [] };

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

export const CTX: TenantContext = {
  installationId: brandInstallation(BigInt(INSTALLATION_ID)),
};
export const REVIEWER = brandReviewer(BigInt(REVIEWER_ID));

export function keyProvider(): KeyProvider {
  return envKeyProvider({ [KEY_REF]: randomBytes(32).toString("base64") });
}

export function authDeps(kp: KeyProvider): AuthDeps {
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
export function stubGitHub(): void {
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
      if (url.includes("/user/installations")) {
        return jsonResponse({
          total_count: 1,
          installations: [{ id: INSTALLATION_ID }],
        });
      }
      if (url.includes("/installation/repositories")) {
        return jsonResponse({
          total_count: 1,
          repositories: [{ id: REPO_ID, full_name: REPO_SLUG }],
        });
      }
      return jsonResponse({ message: "unexpected endpoint" }, 404);
    }),
  );
}

/** A browser session; returns the cookie value. */
export async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
  const grantId = await seedGrant(handle, kp);
  await forTenant(handle, CTX).sessions.create({
    sessionTokenHash: createHash("sha256").update(cookie).digest("hex"),
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    grantId,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return cookie;
}

/** An API token at `scope`; returns the Bearer plaintext. */
export async function seedApiToken(
  handle: AppDatabase,
  kp: KeyProvider,
  scope: WriteClassification,
): Promise<string> {
  const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
  await tokenAuth(handle).mintToken({
    scope,
    installationId: CTX.installationId,
    userId: REVIEWER,
    userLogin: "octocat",
    name: "ci-token",
    tokenHash: createHash("sha256").update(plaintext).digest("hex"),
    grantId: await seedGrant(handle, kp),
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return plaintext;
}

async function seedGrant(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<
  Awaited<ReturnType<ReturnType<typeof grantAuth>["createGrant"]>>["id"]
> {
  const sealedAccess = await encryptToken(kp, KEY_REF, "ghu_ACCESS");
  const sealedRefresh = await encryptToken(kp, KEY_REF, "ghr_REFRESH");
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed encrypt failed");
  }
  const grant = await grantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return grant.id;
}

export async function seedPullRequest(handle: AppDatabase): Promise<void> {
  await forTenant(handle, CTX).pullRequests.upsert({
    repoId: brandRepo(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrState.OPEN,
  });
}

/** One Brief at `head-<index>`; the base never moves. */
export async function seedBrief(
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
 * The durable hop between two Brief heads. Its one hunk sits above every
 * anchor the fixtures place, so the chain links and nothing moves — which is
 * what lets a carried decision settle rather than reopen.
 */
export async function seedHop(
  handle: AppDatabase,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  await writeHop(handle, fromIndex, toIndex, [
    {
      file: "src/app.ts",
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
    },
  ]);
}

async function writeHop(
  handle: AppDatabase,
  fromIndex: number,
  toIndex: number,
  spans: unknown,
): Promise<void> {
  const pr = await forTenant(handle, CTX).pullRequests.getByNumber(
    brandRepo(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) throw new Error("seedHop: pr missing");
  const written = await artifactStore(handle, CTX).hunkSpans.write({
    pullRequestId: pr.id,
    baselineSha: `head-${fromIndex}`,
    headSha: `head-${toIndex}`,
    spans,
  });
  if (!written.ok) throw new Error(`seedHop: ${written.error.code}`);
}

/** A hop whose hunk lands inside the flagged region, so a decision reopens. */
export async function seedHopInsideFlaggedRegion(
  handle: AppDatabase,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  await writeHop(handle, fromIndex, toIndex, [
    {
      file: "src/app.ts",
      hunks: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 3 }],
    },
  ]);
}

/**
 * A second draft on the previous session, orphaning the same way the first
 * does — an attention list with more than one item to walk.
 */
export async function seedOrphanedDraft(
  handle: AppDatabase,
  briefId: BriefRowId,
): Promise<void> {
  const repo = forTenant(handle, CTX);
  const previous = await repo.reviewSessions.get({
    briefId,
    reviewerId: REVIEWER,
  });
  if (previous === undefined) throw new Error("previous session missing");
  const added = await repo.reviewSessions.addDraftComment({
    reviewSessionId: previous.session.id,
    filePath: "src/other.ts",
    side: DraftCommentSide.NEW,
    startLine: 10,
    endLine: 12,
    body: "and this one too",
  });
  if (!added.ok) throw new Error("second draft comment seed failed");
}

/**
 * A previous session holding work that cannot be re-placed: no `hunk_span`
 * row links the two heads, so the chain is untrustworthy and every anchor
 * orphans — an orphaned draft comment and a reopened disposition.
 */
export async function seedPreviousWork(
  handle: AppDatabase,
  briefId: BriefRowId,
): Promise<void> {
  const repo = forTenant(handle, CTX);
  const opened = await repo.reviewSessions.writeToSession(
    { briefId, reviewerId: REVIEWER, brief: async () => NO_ARTIFACT },
    async (writer) => writer.session.id,
  );
  if (!opened.ok) throw new Error("previous session seed failed");
  const sessionId = opened.value;
  const added = await repo.reviewSessions.addDraftComment({
    reviewSessionId: sessionId,
    filePath: "src/app.ts",
    side: DraftCommentSide.NEW,
    startLine: 10,
    endLine: 12,
    body: "this allocation is unbounded",
  });
  if (!added.ok) throw new Error("previous draft comment seed failed");
  await repo.reviewSessions.putReclassification({
    reviewSessionId: sessionId,
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
