// POST /api/repos/:repoId/pulls/:prNumber/attachments over the full wire:
// the admission checks, the fresh re-resolve on the viewer's binding and the
// App's push through the `github/testing` fake, the scope seam in front of
// the action, the Bearer path the CLI takes, and the audit row.
import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeFailure,
  type FakeGitHub,
} from "github/testing";
import { createTenantRepository, type KeyProvider } from "persistence";
import { PrStates, AccessLevels } from "types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  arrangeFakePullRequest,
  arrangeFakeRepository,
  buildFakeAuthDeps,
  buildFakeInstallationDeps,
  arrangeFakeGate,
  listCallsPastGate,
} from "./reviewer-github";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  SAME_ORIGIN_HEADERS,
  SECRET,
  brandRepoId,
  createKeyProvider,
} from "./fixtures";
import { CTX, REPO_ID } from "./session/fixtures";
import { seedSignIn, seedApiToken } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

vi.setConfig({ testTimeout: 10_000 });

const UPLOAD_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/attachments`;
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const OVER_CAP_BYTES = 10 * 1024 * 1024 + 1;
const FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;

const QUOTA = { maxFiles: 2, maxBytes: 1024, windowMs: 60_000 };

interface WireError {
  readonly code: string;
}

async function readCode(response: Response): Promise<string> {
  const body = (await response.json()) as WireError;
  return body.code;
}

function makeOversizedPng(): Uint8Array {
  const oversized = new Uint8Array(OVER_CAP_BYTES);
  oversized.set(PNG_BYTES);
  return oversized;
}

describe("POST /api/repos/:repoId/pulls/:prNumber/attachments", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;
  let cookieHeaders: Record<string, string>;

  beforeEach(async () => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
      attachmentQuota: QUOTA,
    });
    arrangeFakeGate(fake, { repoId: REPO_ID });
    arrangeFakeRepository(fake, REPO_ID);
    arrangeFakePullRequest(fake, { repoId: REPO_ID });
    await createTenantRepository(harness.handle, CTX).pullRequests.upsert({
      repoId: brandRepoId(BigInt(REPO_ID)),
      prNumber: PR_NUMBER,
      repoSlug: REPO_SLUG,
      state: PrStates.OPEN,
    });
    const { cookie } = await seedSignIn(harness.handle, kp);
    cookieHeaders = {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `__Host-mergebrief_session=${cookie}`,
    };
  });

  function upload(
    headers: Record<string, string>,
    body: string | Uint8Array = PNG_BYTES,
  ) {
    return app.request(UPLOAD_PATH, {
      method: "POST",
      headers: { "content-type": "image/png", ...headers },
      body,
    });
  }

  function listCommits() {
    return fake.listCalls("commitAttachment");
  }

  function failCommit(failure: FakeFailure) {
    fake.failOn("commitAttachment", failure, CredentialKinds.INSTALLATION);
  }

  it("commits the image with the app and answers the branch url", async () => {
    const lookups = spyPullRequestLookups(harness);

    const response = await upload(cookieHeaders);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { url: string };
    const fileName = body.url.split("/").at(-1)?.replace("?raw=true", "");
    expect(fileName).toMatch(FILE_NAME_PATTERN);
    expect(body.url).toBe(
      `https://github.com/${REPO_SLUG}/blob/mergebrief/attachments/${fileName}?raw=true`,
    );
    const [commit] = listCommits();
    expect(commit?.credential).toEqual({
      kind: CredentialKinds.INSTALLATION,
      installationId: BigInt(INSTALLATION_ID),
    });
    expect(commit?.input).toEqual({
      owner: "octo",
      repo: "hello",
      branch: "mergebrief/attachments",
      path: fileName,
      bytes: PNG_BYTES,
    });
    expect(lookups.count()).toBe(0);
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

  it("re-resolves the repository fresh on the viewer before the push", async () => {
    await upload(cookieHeaders);

    const pastGate = listCallsPastGate(fake);
    expect(pastGate.map((call) => call.operation)).toEqual([
      "fetchRepositoryById",
      "commitAttachment",
    ]);
    expect(pastGate[0]?.credential.kind).toBe(CredentialKinds.REVIEWER);
  });

  it("answers 429 past the quota, cookie and bearer sharing it", async () => {
    const token = await seedApiToken(
      harness.handle,
      kp,
      AccessLevels.EXTERNAL_WRITE,
    );
    expect((await upload(cookieHeaders)).status).toBe(201);
    expect((await upload({ authorization: `Bearer ${token}` })).status).toBe(
      201,
    );
    const githubCalls = fake.calls.length;

    const refused = await upload(cookieHeaders);

    expect(refused.status).toBe(429);
    expect(await readCode(refused)).toBe("attachment-limit-reached");
    expect(refused.headers.get("cache-control")).toBe("no-store");
    const retryAfterSeconds = Number(refused.headers.get("retry-after"));
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(fake.calls).toHaveLength(githubCalls);
    expect(listCommits()).toHaveLength(2);
  });

  it("charges a failed push and never an oversize or mistyped file", async () => {
    failCommit(FakeFailures.SERVER_ERROR);
    expect((await upload(cookieHeaders, makeOversizedPng())).status).toBe(413);
    expect((await upload(cookieHeaders, "not a png")).status).toBe(400);
    expect((await upload(cookieHeaders)).status).toBe(502);
    expect((await upload(cookieHeaders)).status).toBe(502);

    const response = await upload(cookieHeaders);

    expect(response.status).toBe(429);
    expect(listCommits()).toHaveLength(2);
  });

  it("answers 413 over the cap without calling github", async () => {
    const response = await upload(cookieHeaders, makeOversizedPng());

    expect(response.status).toBe(413);
    expect(await readCode(response)).toBe("request-too-large");
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("answers 400 for a type outside the allowlist", async () => {
    const response = await upload(
      { ...cookieHeaders, "content-type": "image/svg+xml" },
      "<svg/>",
    );

    expect(response.status).toBe(400);
    expect(await readCode(response)).toBe("attachment-unsupported-type");
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("answers 400 when the bytes are not the declared type", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 1]);

    const response = await upload(cookieHeaders, jpegBytes);

    expect(response.status).toBe(400);
    expect(await readCode(response)).toBe("attachment-unsupported-type");
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("answers 403 github-permission when the app itself may not push", async () => {
    failCommit(FakeFailures.FORBIDDEN);

    const response = await upload(cookieHeaders);

    expect(response.status).toBe(403);
    expect(await readCode(response)).toBe("github-permission");
  });

  it("answers 403 attachments-disabled when a rule refuses the push", async () => {
    failCommit(FakeFailures.RULE_REFUSED);

    const response = await upload(cookieHeaders);

    expect(response.status).toBe(403);
    expect(await readCode(response)).toBe("attachments-disabled");
  });

  it("answers 404 when the app no longer holds the repository", async () => {
    failCommit(FakeFailures.NOT_FOUND);

    const response = await upload(cookieHeaders);

    expect(response.status).toBe(404);
  });

  it("answers 502 when github rejects the app's own credential", async () => {
    failCommit(FakeFailures.UNAUTHORIZED);

    const response = await upload(cookieHeaders);

    expect(response.status).toBe(502);
  });

  it("answers 404 when the fresh re-resolve is denied", async () => {
    expect((await upload(cookieHeaders, "not a png")).status).toBe(400);
    // The gate now passes from its cache, so only the re-resolve is refused.
    fake.failOn("fetchRepositoryById", FakeFailures.NOT_FOUND);

    const response = await upload(cookieHeaders);

    expect(response.status).toBe(404);
    expect(listCommits()).toEqual([]);
    const pastGate = listCallsPastGate(fake).map((call) => call.operation);
    expect(pastGate).toEqual(["fetchRepositoryById"]);
  });

  it("a refused upload names the repository on its audit row", async () => {
    const res = await upload(
      { ...cookieHeaders, "content-type": "text/plain" },
      "not an image",
    );

    expect(res.status).toBe(400);
    expect(listCommits()).toEqual([]);
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
    const token = await seedApiToken(harness.handle, kp, AccessLevels.READ);

    const response = await upload({ authorization: `Bearer ${token}` });

    expect(response.status).toBe(403);
    expect(await readCode(response)).toBe("scope-exceeded");
    expect(listCommits()).toEqual([]);
  });
});
