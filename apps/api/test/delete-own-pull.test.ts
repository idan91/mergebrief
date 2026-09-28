// DELETE /api/inbox/:repoId/:prNumber, the owner-only purge of one pasted
// row. Full wire over PGlite. Session-gated only, no GitHub call at all:
// ownership under the viewer's owner scope is the wall, so a pasted row
// whose repository nobody can read any more still goes, and the erase
// cascades every artifact.
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
  WriteClassifications,
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
import {
  KEY_REF,
  SECRET,
  buildAuthDeps,
  createKeyProvider,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import { seedApiToken } from "./session/fixtures";

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const REPO_ID_NUM = 424242;
const PR_NUMBER = 7;

function brand<Branded extends bigint>(
  guard: (value: bigint) => value is Branded,
  value: number,
): Branded {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) {
    throw new Error("bad branded id");
  }
  return asBigInt;
}

const REVIEWER: ReviewerId = brand(isReviewerId, 555);
const OTHER_REVIEWER: ReviewerId = brand(isReviewerId, 999);
const REPO: RepoId = brand(isRepoId, REPO_ID_NUM);
const OWNER_CTX: ScopeContext = { ownerUserId: REVIEWER };
const OTHER_OWNER_CTX: ScopeContext = { ownerUserId: OTHER_REVIEWER };
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
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed encrypt failed");
  }
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
    prNumber: PR_NUMBER,
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
  if (!brief.ok) {
    throw new Error("brief seed failed");
  }
}

interface AuditRow {
  readonly installation_id: unknown;
  readonly source: string;
  readonly operation: string;
  readonly outcome: string;
  readonly actor_type: string;
}

async function readAudits(harness: PgliteHarness): Promise<AuditRow[]> {
  const rows = await harness.raw(
    "select installation_id, source, operation, outcome, actor_type from audit_log order by id",
  );
  return rows.map((row) => ({
    installation_id: row["installation_id"],
    source: String(row["source"]),
    operation: String(row["operation"]),
    outcome: String(row["outcome"]),
    actor_type: String(row["actor_type"]),
  }));
}

async function countRows(
  harness: PgliteHarness,
  table: string,
): Promise<number> {
  return (await harness.raw(`select id from ${table}`)).length;
}

const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
  commitAttachment: async () => {
    throw new Error("attachment port must not be called in this suite");
  },
  deleteAttachmentBranch: async () => {
    throw new Error("attachment port must not be called in this suite");
  },
};

/** No GitHub call belongs on this path; any fetch is a test failure. */
function stubNoGitHub(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      throw new Error(
        `unexpected fetch in the own-pull delete suite: ${String(
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

  async function del(
    cookie: string,
    headers: Record<string, string> = SAME_ORIGIN_HEADERS,
  ): Promise<Response> {
    return app.request(`/api/inbox/${REPO_ID_NUM}/${PR_NUMBER}`, {
      method: "DELETE",
      headers: { ...headers, Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("erases the viewer's own pasted row with no GitHub call", async () => {
    await seedBriefedPr(harness.handle, OWNER_CTX);
    const cookie = await seedOwnerSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "brief")).toBe(0);
    const audits = await readAudits(harness);
    expect(audits).toContainEqual({
      installation_id: null,
      source: "url",
      operation: "delete",
      outcome: "ok",
      actor_type: "reviewer",
    });
    expect(audits).toContainEqual(
      expect.objectContaining({
        installation_id: null,
        source: "url",
        operation: "delete-own-pull",
        outcome: "ok",
      }),
    );
  });

  it("a tenant row at the same coordinates is an indistinguishable 404", async () => {
    await seedBriefedPr(harness.handle, TENANT_CTX);
    const cookie = await seedOwnerSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await countRows(harness, "pull_request")).toBe(1);
    expect(await countRows(harness, "brief")).toBe(1);
  });

  it("another reviewer's pasted row at the coordinates survives", async () => {
    await seedBriefedPr(harness.handle, OTHER_OWNER_CTX);
    const cookie = await seedOwnerSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("a Bearer principal is refused as human-only", async () => {
    await seedBriefedPr(harness.handle, OWNER_CTX);
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.EXTERNAL_WRITE,
    );

    const res = await app.request(`/api/inbox/${REPO_ID_NUM}/${PR_NUMBER}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${bearer}` },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("human-only");
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("a cross-origin cookie request is forbidden", async () => {
    await seedBriefedPr(harness.handle, OWNER_CTX);
    const cookie = await seedOwnerSession(harness.handle, kp);

    const res = await del(cookie, {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example.test",
    });

    expect(res.status).toBe(403);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("a malformed repository id is a 404, a bad number a 400", async () => {
    const cookie = await seedOwnerSession(harness.handle, kp);

    const bad = await app.request("/api/inbox/not-an-id/7", {
      method: "DELETE",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${cookie}`,
      },
    });
    const zero = await app.request(`/api/inbox/${REPO_ID_NUM}/0`, {
      method: "DELETE",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${cookie}`,
      },
    });

    expect(bad.status).toBe(404);
    expect(zero.status).toBe(400);
  });
});
