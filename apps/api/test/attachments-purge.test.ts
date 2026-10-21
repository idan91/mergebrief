// DELETE /api/repos/:repoId/attachments, the gated purge of a repository's
// attachments branch. Full wire over PGlite; the gate's GitHub, the fresh
// read and the App's delete through the `github/testing` fake. The owner world is a 404 before any call past the
// gate; the installation world re-reads the repository fresh and needs
// `permissions.admin` from THAT answer.
import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeFailure,
  type FakeGitHub,
} from "github/testing";
import type { KeyProvider } from "persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandRepoId,
  createKeyProvider,
  SAME_ORIGIN_HEADERS,
} from "./fixtures";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  buildFakeAuthDeps,
  buildFakeInstallationDeps,
  DENIED_GATE_CALLS,
  arrangeFakeGate,
  listCallsPastGate,
  type GateGitHubOptions,
} from "./reviewer-github";
import { seedSignIn, seedApiToken } from "./sign-in";
import { AccessLevels } from "types/access-levels";
import { registerSharedPglite, type SharedPglite } from "./shared-pglite";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const REPO = { owner: "octo", repo: "hello" };
const PURGE_PATH = `/api/repos/${REPO_ID}/attachments`;
const ATTACHMENT_BRANCH = "mergebrief/attachments";

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

async function readAudits(harness: SharedPglite): Promise<AuditRow[]> {
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

async function readCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { code?: string };
  return body.code;
}

/** What the fresh read answers: the repository as GitHub shows it now. */
function arrangeFreshRepository(fake: FakeGitHub, viewerIsAdmin: boolean) {
  fake.addRepository({
    repoId: brandRepoId(BigInt(REPO_ID)),
    fullName: REPO_SLUG,
    private: true,
    viewerCanPush: true,
    viewerIsAdmin,
  });
  fake.addBranch(REPO, ATTACHMENT_BRANCH);
}

describe("DELETE /api/repos/:repoId/attachments", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;
  let cookie: string;

  beforeEach(async () => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
    });
    ({ cookie } = await seedSignIn(harness.handle, kp));
  });

  function stubGate(options: Partial<GateGitHubOptions> = {}) {
    return arrangeFakeGate(fake, { repoId: REPO_ID, admin: false, ...options });
  }

  async function purge(
    headers: Record<string, string> = SAME_ORIGIN_HEADERS,
  ): Promise<Response> {
    return app.request(PURGE_PATH, {
      method: "DELETE",
      headers: { ...headers, Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  function listDeletes() {
    return fake.listCalls("deleteAttachmentBranch");
  }

  function failDelete(failure: FakeFailure) {
    const credential = CredentialKinds.INSTALLATION;
    fake.failOn("deleteAttachmentBranch", failure, credential);
  }

  it("deletes the branch when the fresh read says admin", async () => {
    stubGate();
    arrangeFreshRepository(fake, true);
    const lookups = spyPullRequestLookups(harness);

    const res = await purge();

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const pastGate = listCallsPastGate(fake).map((call) => call.operation);
    expect(pastGate).toEqual(["fetchRepositoryById", "deleteAttachmentBranch"]);
    expect(listDeletes()).toEqual([
      {
        operation: "deleteAttachmentBranch",
        credential: {
          kind: CredentialKinds.INSTALLATION,
          installationId: BigInt(INSTALLATION_ID),
        },
        input: { ...REPO, branch: ATTACHMENT_BRANCH },
      },
    ]);
    expect(lookups.count()).toBe(0);
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
    stubGate({ viewerStatus: 404 });
    arrangeFreshRepository(fake, true);

    const res = await purge();

    expect(res.status).toBe(404);
    expect(listCallsPastGate(fake, DENIED_GATE_CALLS)).toEqual([]);
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
    stubGate();
    arrangeFreshRepository(fake, false);

    const res = await purge();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "attachments-admin-only",
    });
    expect(listDeletes()).toEqual([]);
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
    stubGate({ admin: true });
    arrangeFreshRepository(fake, false);

    const res = await purge();

    expect(res.status).toBe(403);
    expect(listDeletes()).toEqual([]);
  });

  it("answers 404 when the fresh read is denied", async () => {
    stubGate();
    arrangeFreshRepository(fake, false);
    expect((await purge()).status).toBe(403);
    // The gate now passes from its cache, so only the fresh read is refused.
    fake.failOn("fetchRepositoryById", FakeFailures.NOT_FOUND);

    const res = await purge();

    expect(res.status).toBe(404);
    expect(listDeletes()).toEqual([]);
  });

  it("a Bearer principal is refused as human-only before any fresh read", async () => {
    stubGate();
    arrangeFreshRepository(fake, true);
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      AccessLevels.EXTERNAL_WRITE,
    );

    const res = await app.request(PURGE_PATH, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${bearer}` },
    });

    expect(res.status).toBe(403);
    expect(await readCode(res)).toBe("human-only");
    expect(listCallsPastGate(fake)).toEqual([]);
    expect(await readAudits(harness)).toContainEqual(
      expect.objectContaining({
        operation: "purge-attachments",
        outcome: "denied",
        target_type: "repository",
        target_id: BigInt(REPO_ID),
      }),
    );
  });

  it("a delete the App itself may not make is github-permission", async () => {
    stubGate();
    arrangeFreshRepository(fake, true);
    failDelete(FakeFailures.FORBIDDEN);

    const res = await purge();

    expect(res.status).toBe(403);
    expect(await readCode(res)).toBe("github-permission");
  });

  it("a delete the repository refuses is attachments-disabled", async () => {
    stubGate();
    arrangeFreshRepository(fake, true);
    failDelete(FakeFailures.RULE_REFUSED);

    const res = await purge();

    expect(res.status).toBe(403);
    expect(await readCode(res)).toBe("attachments-disabled");
    expect(listDeletes()[0]?.input).toEqual({
      ...REPO,
      branch: ATTACHMENT_BRANCH,
    });
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
    stubGate();
    arrangeFreshRepository(fake, true);
    failDelete(FakeFailures.NOT_FOUND);

    const res = await purge();

    expect(res.status).toBe(404);
    expect(await readAudits(harness)).toContainEqual(
      expect.objectContaining({
        operation: "purge-attachments",
        outcome: "denied",
      }),
    );
  });

  it("answers 502 when github rejects the App's own credential", async () => {
    stubGate();
    arrangeFreshRepository(fake, true);
    failDelete(FakeFailures.UNAUTHORIZED);

    const res = await purge();

    expect(res.status).toBe(502);
  });

  it("a cross-origin cookie request is forbidden", async () => {
    stubGate();
    arrangeFreshRepository(fake, true);

    const res = await purge({
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example.test",
    });

    expect(res.status).toBe(403);
    expect(listDeletes()).toEqual([]);
  });
});
