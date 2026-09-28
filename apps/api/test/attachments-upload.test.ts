// POST /api/repos/:repoId/pulls/:prNumber/attachments over the full wire:
// the scope seam in front of the action, the Bearer path the CLI takes, and
// the audit row. The App's push is stubbed at the installation port.
import {
  createTenantRepository,
  PrStates,
  WriteClassifications,
  type KeyProvider,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import type { InstallationGitHubPort } from "../src/routes/github-port";
import { testLogger } from "./logging";
import {
  PR_NUMBER,
  REPO_SLUG,
  SAME_ORIGIN_HEADERS,
  SECRET,
  brandRepoId,
  buildAuthDeps,
  createKeyProvider,
} from "./fixtures";
import {
  CTX,
  REPO_ID,
  seedApiToken,
  seedSession,
  stubGitHub,
} from "./session/fixtures";

vi.setConfig({ testTimeout: 10_000 });

const UPLOAD_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/attachments`;
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;

function makePort(commit = vi.fn()): {
  port: InstallationGitHubPort;
  commit: ReturnType<typeof vi.fn>;
} {
  commit.mockResolvedValue({ ok: true, value: { commitSha: "abc" } });
  const port: InstallationGitHubPort = {
    fetchPullRequestConversation: async () => {
      throw new Error("conversation port must not be called in this suite");
    },
    listRepoCollaborators: async () => {
      throw new Error("collaborators port must not be called in this suite");
    },
    commitAttachment: commit,
    deleteAttachmentBranch: async () => {
      throw new Error("attachment port must not be called in this suite");
    },
  };
  return { port, commit };
}

describe("POST /api/repos/:repoId/pulls/:prNumber/attachments", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let app: ApiApp;
  let commit: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    const made = makePort();
    commit = made.commit;
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: made.port,
    });
    stubGitHub();
    await createTenantRepository(harness.handle, CTX).pullRequests.upsert({
      repoId: brandRepoId(BigInt(REPO_ID)),
      prNumber: PR_NUMBER,
      repoSlug: REPO_SLUG,
      state: PrStates.OPEN,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  function upload(headers: Record<string, string>) {
    return app.request(UPLOAD_PATH, {
      method: "POST",
      headers: { "content-type": "image/png", ...headers },
      body: PNG_BYTES,
    });
  }

  it("commits the image with the app and answers the branch url", async () => {
    const cookie = await seedSession(harness.handle, kp);

    const response = await upload({
      ...SAME_ORIGIN_HEADERS,
      Cookie: `__Host-mergebrief_session=${cookie}`,
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { url: string };
    const fileName = body.url.split("/").at(-1)?.replace("?raw=true", "");
    expect(fileName).toMatch(FILE_NAME_PATTERN);
    expect(body.url).toBe(
      `https://github.com/${REPO_SLUG}/blob/mergebrief/attachments/${fileName}?raw=true`,
    );
    expect(commit.mock.calls[0]?.[1]).toMatchObject({
      owner: "octo",
      repo: "hello",
      branch: "mergebrief/attachments",
      path: fileName,
    });
    const rows = await harness.raw(
      "select operation, outcome, target_type from audit_log order by id",
    );
    expect(rows).toEqual([
      {
        operation: "upload-attachment",
        outcome: "ok",
        target_type: "repository",
      },
    ]);
  });

  it("lets an external-write bearer token attach, as the cli does", async () => {
    const token = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.EXTERNAL_WRITE,
    );

    const response = await upload({ authorization: `Bearer ${token}` });

    expect(response.status).toBe(201);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("a refused upload names the repository on its audit row", async () => {
    const cookie = await seedSession(harness.handle, kp);

    const res = await app.request(UPLOAD_PATH, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${cookie}`,
      },
      body: "not an image",
    });

    expect(res.status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
    const rows = await harness.raw(
      "select operation, outcome, target_type, target_id from audit_log order by id",
    );
    expect(rows).toEqual([
      {
        operation: "upload-attachment",
        outcome: "denied",
        target_type: "repository",
        target_id: expect.anything(),
      },
    ]);
  });

  it("refuses a read-scoped bearer token at the router seam", async () => {
    const token = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.READ,
    );

    const response = await upload({ authorization: `Bearer ${token}` });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      "scope-exceeded",
    );
    expect(commit).not.toHaveBeenCalled();
  });
});
