// DELETE /api/repos/:repoId/attachments, the gated purge of a repository's
// attachments branch. Full wire over PGlite, GitHub stubbed at the global
// fetch boundary, the App's port stubbed at its seam. The owner world is a
// 404 before any call past the gate; the installation world re-reads the
// repository fresh and needs `permissions.admin` from THAT answer.
import { randomBytes } from "node:crypto";
import {
  createGrantAuth,
  createTenantRepository,
  encryptToken,
  WriteClassifications,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import type { InstallationGitHubPort } from "../src/routes/github-port";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  KEY_REF,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
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
const PURGE_PATH = `/api/repos/${REPO_ID}/attachments`;

const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};

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
}

function stubGitHub(cfg: StubConfig): { repositories: number } {
  const counts = { repositories: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request): Promise<Response> => {
      const url = getRequestUrl(input);
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
        return cfg.repository(call);
      }
      throw new Error(`unexpected fetch in attachments-purge suite: ${url}`);
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

interface AuditRow {
  readonly installation_id: bigint | null;
  readonly source: string;
  readonly operation: string;
  readonly outcome: string;
  readonly actor_id: bigint | null;
  readonly target_type: string | null;
  readonly target_id: bigint | null;
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
    "select installation_id, source, operation, outcome, actor_id, target_type, target_id from audit_log order by id",
  );
  return rows.map((row) => ({
    installation_id: readBigInt(row["installation_id"]),
    source: String(row["source"]),
    operation: String(row["operation"]),
    outcome: String(row["outcome"]),
    actor_id: readBigInt(row["actor_id"]),
    target_type:
      typeof row["target_type"] === "string" ? row["target_type"] : null,
    target_id: readBigInt(row["target_id"]),
  }));
}

function makePort(): {
  port: InstallationGitHubPort;
  deleteBranch: ReturnType<typeof vi.fn>;
} {
  const deleteBranch = vi
    .fn()
    .mockResolvedValue({ ok: true, value: { existed: true } });
  const port: InstallationGitHubPort = {
    fetchPullRequestConversation: async () => {
      throw new Error("conversation port must not be called in this suite");
    },
    listRepoCollaborators: async () => {
      throw new Error("collaborators port must not be called in this suite");
    },
    commitAttachment: async () => {
      throw new Error("commit port must not be called in this suite");
    },
    deleteAttachmentBranch: deleteBranch,
  };
  return { port, deleteBranch };
}

describe("DELETE /api/repos/:repoId/attachments", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let app: ApiApp;
  let deleteBranch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    const made = makePort();
    deleteBranch = made.deleteBranch;
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: made.port,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  async function purge(
    cookie: string,
    headers: Record<string, string> = SAME_ORIGIN_HEADERS,
  ): Promise<Response> {
    return app.request(PURGE_PATH, {
      method: "DELETE",
      headers: { ...headers, Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("deletes the branch when the fresh read says admin", async () => {
    const counts = stubGitHub({
      inInstallation: true,
      repository: () => answerRepo(true),
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await purge(cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(counts.repositories).toBe(2);
    expect(deleteBranch).toHaveBeenCalledTimes(1);
    expect(deleteBranch.mock.calls[0]).toEqual([
      BigInt(INSTALLATION_ID),
      { owner: "octo", repo: "hello", branch: "mergebrief/attachments" },
    ]);
    expect(await readAudits(harness)).toContainEqual({
      installation_id: BigInt(INSTALLATION_ID),
      source: "installation",
      operation: "purge-attachments",
      outcome: "ok",
      actor_id: BigInt(REVIEWER_ID),
      target_type: "repository",
      target_id: BigInt(REPO_ID),
    });
  });

  it("audits the repo gate's uniform 404 as a refused purge", async () => {
    stubGitHub({
      inInstallation: true,
      repository: () => jsonResponse({ message: "Not Found" }, 404),
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await purge(cookie);

    expect(res.status).toBe(404);
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(await readAudits(harness)).toContainEqual(
      expect.objectContaining({
        operation: "purge-attachments",
        outcome: "denied",
        target_type: "repo",
        target_id: BigInt(REPO_ID),
      }),
    );
  });

  it("refuses a non-admin with attachments-admin-only and deletes nothing", async () => {
    stubGitHub({ inInstallation: true, repository: () => answerRepo(false) });
    const cookie = await seedSession(harness.handle, kp);

    const res = await purge(cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "attachments-admin-only",
    });
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(await readAudits(harness)).toContainEqual(
      expect.objectContaining({
        operation: "purge-attachments",
        outcome: "denied",
        target_type: "repository",
        target_id: BigInt(REPO_ID),
      }),
    );
  });

  it("the fresh read decides, never the walk's cached admin bit", async () => {
    stubGitHub({
      inInstallation: true,
      walkAdmin: true,
      repository: (call) => answerRepo(call === 0),
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await purge(cookie);

    expect(res.status).toBe(403);
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it("the owner world is a 404 with no call past the gate", async () => {
    const counts = stubGitHub({
      inInstallation: false,
      repository: () => answerRepo(true),
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await purge(cookie);

    expect(res.status).toBe(404);
    expect(counts.repositories).toBe(1);
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it("a Bearer principal is refused as human-only before any fresh read", async () => {
    const counts = stubGitHub({
      inInstallation: true,
      repository: () => answerRepo(true),
    });
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.EXTERNAL_WRITE,
    );

    const res = await app.request(PURGE_PATH, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${bearer}` },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("human-only");
    expect(counts.repositories).toBe(1);
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it("a delete the App itself may not make is github-permission", async () => {
    stubGitHub({ inInstallation: true, repository: () => answerRepo(true) });
    deleteBranch.mockResolvedValue({
      ok: false,
      error: { code: "forbidden", status: 403, message: "denied" },
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await purge(cookie);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "github-permission",
    );
  });

  it("a delete the repository refuses is attachments-disabled", async () => {
    stubGitHub({ inInstallation: true, repository: () => answerRepo(true) });
    deleteBranch.mockResolvedValue({
      ok: false,
      error: { code: "rule-refused", status: 422, message: "refused" },
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await purge(cookie);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "attachments-disabled",
    );
    expect(deleteBranch.mock.calls[0]).toEqual([
      BigInt(INSTALLATION_ID),
      { owner: "octo", repo: "hello", branch: "mergebrief/attachments" },
    ]);
    expect(await readAudits(harness)).toContainEqual(
      expect.objectContaining({
        operation: "purge-attachments",
        outcome: "denied",
        target_type: "repository",
        target_id: BigInt(REPO_ID),
      }),
    );
  });

  it("a repository the App lost is a 404, never a silent success", async () => {
    stubGitHub({ inInstallation: true, repository: () => answerRepo(true) });
    deleteBranch.mockResolvedValue({
      ok: false,
      error: { code: "not-found", status: 404, message: "gone" },
    });
    const cookie = await seedSession(harness.handle, kp);

    const res = await purge(cookie);

    expect(res.status).toBe(404);
    expect(await readAudits(harness)).toContainEqual(
      expect.objectContaining({
        operation: "purge-attachments",
        outcome: "denied",
      }),
    );
  });

  it("a cross-origin cookie request is forbidden", async () => {
    stubGitHub({ inInstallation: true, repository: () => answerRepo(true) });
    const cookie = await seedSession(harness.handle, kp);

    const res = await purge(cookie, {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example.test",
    });

    expect(res.status).toBe(403);
    expect(deleteBranch).not.toHaveBeenCalled();
  });
});
