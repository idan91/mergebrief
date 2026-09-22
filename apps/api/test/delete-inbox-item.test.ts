// DELETE /api/inbox/:repoId/:prNumber, the owner-delete. Full wire over
// PGlite. Session-gated only (no GitHub call at all): ownership under the
// viewer's owner scope is the wall, and the erase cascades every artifact.
import { randomBytes, createHash } from "node:crypto";
import {
  createArtifactStore,
  createGrantAuth,
  createTenantRepository,
  encryptToken,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrStates,
  type AppDatabase,
  type KeyProvider,
  type RepoId,
  type ReviewerId,
  type ScopeContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp, type AppDeps } from "../src/index";
import { testLogger } from "./logging";
import { KEY_REF, SECRET, buildAuthDeps, createKeyProvider } from "./fixtures";

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const REPO_ID_NUM = 424242;

function brand<T extends bigint>(
  guard: (v: bigint) => v is T,
  value: number,
): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) throw new Error("bad branded id");
  return asBigInt;
}

const REVIEWER: ReviewerId = brand(isReviewerId, 555);
const REPO: RepoId = brand(isRepoId, REPO_ID_NUM);
const OWNER_CTX: ScopeContext = { ownerUserId: REVIEWER };
const TENANT_CTX: ScopeContext = {
  installationId: brand(isInstallationId, 987654),
};

async function seedOwnerSession(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(cookie).digest("hex");
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
  await createTenantRepository(handle, OWNER_CTX).sessions.create({
    sessionTokenHash: hash,
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return cookie;
}

async function seedBriefedPr(
  handle: AppDatabase,
  ctx: ScopeContext,
): Promise<void> {
  const pr = await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId: REPO,
    prNumber: 7,
    repoSlug: "o/r",
    state: PrStates.OPEN,
  });
  const brief = await createArtifactStore(handle, ctx).briefs.write({
    pullRequestId: pr.id,
    baseSha: "b".repeat(40),
    headSha: "h".repeat(40),
    headIndex: 1,
    commitCount: 1,
    provider: "p",
    model: "m",
    effort: "e",
    body: "{}",
  });
  if (!brief.ok) throw new Error("brief seed failed");
}

const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
};

/** No GitHub call belongs on this path; any fetch is a test failure. */
function stubNoGitHub(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      throw new Error(
        `unexpected fetch in delete suite: ${String(
          input instanceof Request ? input.url : input,
        )}`,
      );
    }),
  );
}

describe("DELETE /api/inbox/:repoId/:prNumber", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let app: ApiApp;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    const deps: AppDeps = {
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: unusedConversationPort,
    };
    app = createApp(deps);
    stubNoGitHub();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  async function del(cookie: string): Promise<Response> {
    return app.request(`/api/inbox/${REPO_ID_NUM}/7`, {
      method: "DELETE",
      headers: { Cookie: `rs_session=${cookie}` },
    });
  }

  it("erases the viewer's own row with no GitHub call", async () => {
    await seedBriefedPr(harness.handle, OWNER_CTX);
    const cookie = await seedOwnerSession(harness.handle, kp);

    const res = await del(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await harness.raw("select id from pull_request")).toHaveLength(0);
    expect(await harness.raw("select id from brief")).toHaveLength(0);

    const audits = await harness.raw(
      "select installation_id, source, operation, outcome from audit_log order by id",
    );
    // Two rows: persistence's own purge `delete` entry + the Product
    // Operation descriptor row, both owner-world.
    expect(audits).toContainEqual({
      installation_id: null,
      source: "url",
      operation: "delete",
      outcome: "ok",
    });
    expect(audits).toContainEqual({
      installation_id: null,
      source: "url",
      operation: "delete-inbox-item",
      outcome: "ok",
    });
  });

  it("a tenant-world row at the same coordinates is an indistinguishable 404", async () => {
    await seedBriefedPr(harness.handle, TENANT_CTX);
    const cookie = await seedOwnerSession(harness.handle, kp);

    const res = await del(cookie);
    expect(res.status).toBe(404);
    expect(await harness.raw("select id from pull_request")).toHaveLength(1);
    expect(await harness.raw("select id from brief")).toHaveLength(1);
  });
});
