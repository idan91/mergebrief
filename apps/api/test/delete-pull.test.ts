// DELETE /api/repos/:repoId/pulls/:prNumber, the gated delete of one pull
// request's briefs. Full wire over PGlite, GitHub stubbed at the global
// fetch boundary. The owner world erases the viewer's own url row with no
// call past the gate; the installation world re-reads the repository fresh
// and needs `permissions.admin` from THAT answer, never the walk's cache.
import { randomBytes } from "node:crypto";
import {
  createArtifactStore,
  createGrantAuth,
  createTenantRepository,
  encryptToken,
  PrStates,
  WriteClassifications,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
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
  answerUserInstallations,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import { seedApiToken } from "./session/fixtures";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const FALLBACK_PAT = "ghp_OPERATOR_PAT";
const OTHER_INSTALLATION_ID = 777;
const OTHER_REVIEWER_ID = 999;

const TENANT: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};
const OTHER_TENANT: ScopeContext = {
  installationId: brandInstallationId(BigInt(OTHER_INSTALLATION_ID)),
};
const OTHER_OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(OTHER_REVIEWER_ID)),
};

const DELETE_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

function answerRepo(admin: boolean): Response {
  return jsonResponse({
    id: REPO_ID,
    full_name: REPO_SLUG,
    private: true,
    permissions: { admin, push: true, pull: true },
  });
}

interface StubConfig {
  /** The installation's listing holds the repo; false is the owner world. */
  readonly inInstallation: boolean;
  /** `permissions.admin` on the walk's listing, the cached hint. */
  readonly walkAdmin?: boolean;
  /** `GET /repositories/{id}` per call: the gate first, then the fresh read. */
  readonly repository: (call: number) => Response;
  /** The viewer's own token is refused on `GET /repositories/{id}`; only another token reaches `repository`. */
  readonly viewerDenied?: boolean;
}

interface StubCounts {
  repositories: number;
}

function stubGitHub(cfg: StubConfig): StubCounts {
  const counts: StubCounts = { repositories: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request, init?: RequestInit): Promise<Response> => {
      const url = getRequestUrl(input);
      const headers = new Headers(
        input instanceof Request ? input.headers : init?.headers,
      );
      const token = (headers.get("authorization") ?? "").replace(
        /^(token|Bearer)\s+/i,
        "",
      );
      if (url.endsWith("/user/installations?per_page=100")) {
        return answerUserInstallations([INSTALLATION_ID]);
      }
      if (
        url.includes("/user/installations/") &&
        url.includes("/repositories")
      ) {
        const repositories = cfg.inInstallation
          ? [
              {
                id: REPO_ID,
                full_name: REPO_SLUG,
                permissions: { admin: cfg.walkAdmin ?? false },
              },
            ]
          : [];
        return jsonResponse({
          total_count: repositories.length,
          repositories,
        });
      }
      if (url.includes("/repositories/")) {
        const call = counts.repositories;
        counts.repositories += 1;
        if (cfg.viewerDenied === true && token === ACCESS_TOKEN) {
          return jsonResponse({ message: "Not Found" }, 404);
        }
        return cfg.repository(call);
      }
      throw new Error(`unexpected fetch in delete-pull suite: ${url}`);
    }),
  );
  return counts;
}

async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
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
  await createTenantRepository(handle, OWNER).sessions.create({
    sessionTokenHash: hashSha256Hex(cookie),
    reviewerId: brandReviewerId(BigInt(REVIEWER_ID)),
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
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
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
  readonly installation_id: bigint | null;
  readonly source: string;
  readonly operation: string;
  readonly outcome: string;
  readonly actor_type: string;
  readonly actor_id: bigint | null;
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" || typeof value === "string") {
    return BigInt(value);
  }
  return null;
}

async function readAudits(harness: PgliteHarness): Promise<AuditRow[]> {
  const rows = await harness.raw(
    "select installation_id, source, operation, outcome, actor_type, actor_id from audit_log order by id",
  );
  return rows.map((row) => ({
    installation_id: readBigInt(row["installation_id"]),
    source: String(row["source"]),
    operation: String(row["operation"]),
    outcome: String(row["outcome"]),
    actor_type: String(row["actor_type"]),
    actor_id: readBigInt(row["actor_id"]),
  }));
}

async function readOwners(harness: PgliteHarness): Promise<string[]> {
  const rows = await harness.raw(
    "select owner_user_id from pull_request order by id",
  );
  return rows.map((row) => String(row["owner_user_id"]));
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
};

describe("DELETE /api/repos/:repoId/pulls/:prNumber", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let app: ApiApp;

  function buildApp(fallbackToken?: string): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: unusedConversationPort,
      urlBoxFallbackToken: fallbackToken,
    });
  }

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    app = buildApp();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  async function del(
    cookie: string,
    path = DELETE_PATH,
    headers: Record<string, string> = SAME_ORIGIN_HEADERS,
    target: ApiApp = app,
  ): Promise<Response> {
    return target.request(path, {
      method: "DELETE",
      headers: { ...headers, Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("erases the viewer's own url row with no call past the gate", async () => {
    const counts = stubGitHub({
      inInstallation: false,
      repository: () => answerRepo(false),
    });
    await seedBriefedPr(harness.handle, OWNER);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(counts.repositories).toBe(1);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "brief")).toBe(0);
    const audits = await readAudits(harness);
    expect(audits).toContainEqual({
      installation_id: null,
      source: "url",
      operation: "delete",
      outcome: "ok",
      actor_type: "reviewer",
      actor_id: BigInt(REVIEWER_ID),
    });
    expect(audits).toContainEqual(
      expect.objectContaining({ operation: "delete-pull", outcome: "ok" }),
    );
  });

  it("erases an installation row when the fresh read says admin", async () => {
    const counts = stubGitHub({
      inInstallation: true,
      repository: () => answerRepo(true),
    });
    await seedBriefedPr(harness.handle, TENANT);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(200);
    expect(counts.repositories).toBe(2);
    expect(await countRows(harness, "pull_request")).toBe(0);
    expect(await countRows(harness, "brief")).toBe(0);
    expect(await readAudits(harness)).toContainEqual({
      installation_id: BigInt(INSTALLATION_ID),
      source: "installation",
      operation: "delete",
      outcome: "ok",
      actor_type: "reviewer",
      actor_id: BigInt(REVIEWER_ID),
    });
  });

  it("refuses a non-admin with repo-admin-only and erases nothing", async () => {
    stubGitHub({ inInstallation: true, repository: () => answerRepo(false) });
    await seedBriefedPr(harness.handle, TENANT);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "repo-admin-only",
    });
    expect(await countRows(harness, "pull_request")).toBe(1);
    expect(await countRows(harness, "brief")).toBe(1);
    expect(await readAudits(harness)).toContainEqual(
      expect.objectContaining({ operation: "delete-pull", outcome: "denied" }),
    );
  });

  it("the fresh read decides, never the walk's cached admin bit", async () => {
    stubGitHub({
      inInstallation: true,
      walkAdmin: true,
      repository: (call) => answerRepo(call === 0),
    });
    await seedBriefedPr(harness.handle, TENANT);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(403);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("an admin delete takes the viewer's shadowed url row with it", async () => {
    stubGitHub({ inInstallation: true, repository: () => answerRepo(true) });
    await seedBriefedPr(harness.handle, TENANT);
    await seedBriefedPr(harness.handle, OWNER);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(200);
    expect(await countRows(harness, "pull_request")).toBe(0);
    const purges = (await readAudits(harness)).filter(
      (row) => row.operation === "delete",
    );
    expect(purges.map((row) => row.source).toSorted()).toEqual([
      "installation",
      "url",
    ]);
  });

  it("erases the viewer's own url row under an installation holding no row", async () => {
    const counts = stubGitHub({
      inInstallation: true,
      repository: () => answerRepo(false),
    });
    await seedBriefedPr(harness.handle, OWNER);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(200);
    expect(counts.repositories).toBe(1);
    expect(await countRows(harness, "pull_request")).toBe(0);
    const audits = await readAudits(harness);
    expect(audits).toContainEqual(
      expect.objectContaining({ operation: "delete", source: "url" }),
    );
    expect(audits).toContainEqual(
      expect.objectContaining({
        operation: "delete-pull",
        outcome: "ok",
        installation_id: null,
        source: "url",
      }),
    );
  });

  it("another reviewer's url row at the coordinates survives the owner world", async () => {
    stubGitHub({ inInstallation: false, repository: () => answerRepo(false) });
    await seedBriefedPr(harness.handle, OTHER_OWNER);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await readOwners(harness)).toEqual([String(OTHER_REVIEWER_ID)]);
  });

  it("another reviewer's url row survives an admin's installation delete", async () => {
    stubGitHub({ inInstallation: true, repository: () => answerRepo(true) });
    await seedBriefedPr(harness.handle, TENANT);
    await seedBriefedPr(harness.handle, OTHER_OWNER);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(200);
    expect(await readOwners(harness)).toEqual([String(OTHER_REVIEWER_ID)]);
  });

  it("a row in an installation the viewer cannot reach survives", async () => {
    stubGitHub({ inInstallation: false, repository: () => answerRepo(true) });
    await seedBriefedPr(harness.handle, OTHER_TENANT);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("the operator-PAT rung reaches the viewer's own url row alone", async () => {
    const counts = stubGitHub({
      inInstallation: true,
      viewerDenied: true,
      repository: () => answerRepo(true),
    });
    await seedBriefedPr(harness.handle, TENANT);
    await seedBriefedPr(harness.handle, OWNER);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(
      cookie,
      DELETE_PATH,
      SAME_ORIGIN_HEADERS,
      buildApp(FALLBACK_PAT),
    );

    expect(res.status).toBe(200);
    expect(counts.repositories).toBe(2);
    expect(await readOwners(harness)).toEqual(["null"]);
    const purges = (await readAudits(harness)).filter(
      (row) => row.operation === "delete",
    );
    expect(purges.map((row) => row.source)).toEqual(["url"]);
  });

  it("a fresh read GitHub refuses is a 404 with nothing erased", async () => {
    stubGitHub({
      inInstallation: true,
      repository: (call) =>
        call === 0
          ? answerRepo(false)
          : jsonResponse({ message: "Not Found" }, 404),
    });
    await seedBriefedPr(harness.handle, TENANT);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
    expect(await countRows(harness, "pull_request")).toBe(1);
    expect(await countRows(harness, "brief")).toBe(1);
  });

  it("an unknown pull request in the resolved world is a 404", async () => {
    stubGitHub({ inInstallation: true, repository: () => answerRepo(true) });
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie);

    expect(res.status).toBe(404);
  });

  it("a Bearer principal is refused as human-only before any fresh read", async () => {
    const counts = stubGitHub({
      inInstallation: true,
      repository: () => answerRepo(true),
    });
    await seedBriefedPr(harness.handle, TENANT);
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.EXTERNAL_WRITE,
    );

    const res = await app.request(DELETE_PATH, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${bearer}` },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("human-only");
    expect(counts.repositories).toBe(1);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("a cross-origin cookie request is forbidden", async () => {
    stubGitHub({ inInstallation: true, repository: () => answerRepo(true) });
    await seedBriefedPr(harness.handle, TENANT);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie, DELETE_PATH, {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example.test",
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("forbidden");
    expect(await countRows(harness, "pull_request")).toBe(1);
  });

  it("the old inbox delete path is gone", async () => {
    stubGitHub({ inInstallation: false, repository: () => answerRepo(false) });
    await seedBriefedPr(harness.handle, OWNER);
    const cookie = await seedSession(harness.handle, kp);

    const res = await del(cookie, `/api/inbox/${REPO_ID}/${PR_NUMBER}`);

    expect(res.status).toBe(404);
    expect(await countRows(harness, "pull_request")).toBe(1);
  });
});
