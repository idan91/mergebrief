// GET /api/repos/:repoId/pulls/:prNumber/video-assets over PGlite: the
// pasted assets GitHub rendered as a video, read from the same rendered
// sources the attachment read resolves through, on the viewer's binding.
import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import {
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  buildOperatorToken,
  createKeyProvider,
  getRequestUrl,
} from "./fixtures";
import { testLogger } from "./logging";
import {
  OPERATOR_GATE_CALLS,
  arrangeFakeGate,
  buildFakeAuthDeps,
  buildFakeInstallationDeps,
  listCallTokens,
  listCallsPastGate,
  makeFakePullRequestInfo,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const REPO = { owner: "octo", repo: "hello" };
const OPERATOR_PAT = "ghp_OPERATOR_PAT";
const PRIVATE_ID = "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00";
const PUBLIC_ID = "96abe080-db23-4366-9eb8-32a76d148ae5";
const OLDER_ID = "0f6c1f2e-61b3-4d55-9c1a-0b2d7f3e9a10";
const IMAGE_ID = "5b1c2d3e-4f50-4a61-8b72-9c83d4e5f601";
const SIGNED_VIDEO = `https://private-user-images.githubusercontent.com/1/2-${PRIVATE_ID}.mp4?jwt=abc`;
const PUBLIC_VIDEO = `https://github.com/user-attachments/assets/${PUBLIC_ID}`;
const OLDER_VIDEO = `https://github.com/octo/hello/assets/12345/${OLDER_ID}`;
const SIGNED_IMAGE = `https://private-user-images.githubusercontent.com/1/2-${IMAGE_ID}.png?jwt=abc`;
const SIGNED_HOST = "https://private-user-images.githubusercontent.com/";
const VIDEO_ASSETS_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/video-assets`;

const INSTALLATION: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};

interface RenderedMedia {
  readonly imageSources?: readonly string[];
  readonly videoSources?: readonly string[];
}

async function seedPullRequest(
  handle: AppDatabase,
  scope: ScopeContext,
): Promise<void> {
  await createTenantRepository(handle, scope).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

function arrangeRenderedMedia(fake: FakeGitHub, media: RenderedMedia): void {
  fake.addPullRequest(
    { ...REPO, prNumber: PR_NUMBER },
    { info: makeFakePullRequestInfo({ repoId: REPO_ID }), ...media },
  );
}

/** The signed host answers 404; every other fetch goes where the gate sent it. */
function stubSignedHostFetch(): void {
  const gateFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (getRequestUrl(input).startsWith(SIGNED_HOST)) {
        return new Response(null, { status: 404 });
      }
      return gateFetch(input, init);
    }),
  );
}

describe("GET video-assets", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let cookie: string;

  beforeEach(async () => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    ({ cookie } = await seedSignIn(harness.handle, kp));
    await seedPullRequest(harness.handle, INSTALLATION);
  });

  function makeApp(operatorToken?: string): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
      operatorToken:
        operatorToken === undefined
          ? undefined
          : buildOperatorToken(operatorToken),
    });
  }

  async function readPath(app: ApiApp, path: string): Promise<Response> {
    return app.request(path, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("lists every asset github rendered as a video, once each", async () => {
    arrangeRenderedMedia(fake, {
      imageSources: [SIGNED_IMAGE],
      videoSources: [SIGNED_VIDEO, PUBLIC_VIDEO, OLDER_VIDEO, SIGNED_VIDEO],
    });
    arrangeFakeGate(fake, { repoId: REPO_ID });

    const response = await readPath(makeApp(), VIDEO_ASSETS_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      assetIds: [PRIVATE_ID, PUBLIC_ID, OLDER_ID],
    });
  });

  it("lists no video served from anywhere but github's asset hosts", async () => {
    arrangeRenderedMedia(fake, {
      videoSources: [
        "https://camo.githubusercontent.com/x.mp4",
        `https://github.com/attacker/pub/raw/main/${PRIVATE_ID}.mp4`,
        `${PUBLIC_VIDEO}?download=1`,
      ],
    });
    arrangeFakeGate(fake, { repoId: REPO_ID });

    const response = await readPath(makeApp(), VIDEO_ASSETS_PATH);

    expect(await response.json()).toEqual({ assetIds: [] });
  });

  it("reads the rendered sources on the viewer's token", async () => {
    arrangeRenderedMedia(fake, { videoSources: [SIGNED_VIDEO] });
    arrangeFakeGate(fake, { repoId: REPO_ID });

    await readPath(makeApp(), VIDEO_ASSETS_PATH);

    expect(fake.listCalls("fetchRenderedMediaSources")[0]?.input).toEqual({
      ...REPO,
      prNumber: PR_NUMBER,
    });
    expect(listCallTokens(listCallsPastGate(fake))).toEqual([ACCESS_TOKEN]);
  });

  it("shares the rendered sources the attachment read cached", async () => {
    arrangeRenderedMedia(fake, { videoSources: [SIGNED_VIDEO] });
    arrangeFakeGate(fake, { repoId: REPO_ID });
    const app = makeApp();
    const attachmentsPath = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/attachments`;
    stubSignedHostFetch();

    await readPath(app, `${attachmentsPath}/${PRIVATE_ID}`);
    const response = await readPath(app, VIDEO_ASSETS_PATH);

    expect(await response.json()).toEqual({ assetIds: [PRIVATE_ID] });
    expect(fake.listCalls("fetchRenderedMediaSources")).toHaveLength(1);
  });

  it("re-reads young sources once for the id a page says is missing", async () => {
    arrangeRenderedMedia(fake, { videoSources: [SIGNED_VIDEO] });
    arrangeFakeGate(fake, { repoId: REPO_ID });
    const app = makeApp();
    const missingPath = `${VIDEO_ASSETS_PATH}?missing=${PUBLIC_ID}`;

    await readPath(app, VIDEO_ASSETS_PATH);
    arrangeRenderedMedia(fake, { videoSources: [SIGNED_VIDEO, PUBLIC_VIDEO] });
    const reread = await readPath(app, missingPath);
    await readPath(app, missingPath);
    await readPath(app, `${VIDEO_ASSETS_PATH}?missing=not-an-id`);

    expect(await reread.json()).toEqual({ assetIds: [PRIVATE_ID, PUBLIC_ID] });
    expect(fake.listCalls("fetchRenderedMediaSources")).toHaveLength(2);
  });

  it("answers 404 when github denies the pull request", async () => {
    arrangeRenderedMedia(fake, { videoSources: [SIGNED_VIDEO] });
    fake.failOn("fetchRenderedMediaSources", FakeFailures.FORBIDDEN);
    arrangeFakeGate(fake, { repoId: REPO_ID });

    const response = await readPath(makeApp(), VIDEO_ASSETS_PATH);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 502 on an upstream failure", async () => {
    arrangeRenderedMedia(fake, { videoSources: [SIGNED_VIDEO] });
    fake.failOn("fetchRenderedMediaSources", FakeFailures.SERVER_ERROR);
    arrangeFakeGate(fake, { repoId: REPO_ID });

    const response = await readPath(makeApp(), VIDEO_ASSETS_PATH);

    expect(response.status).toBe(502);
  });

  it("answers 404 for a repository the viewer cannot read", async () => {
    arrangeRenderedMedia(fake, { videoSources: [SIGNED_VIDEO] });
    arrangeFakeGate(fake, { repoId: REPO_ID, viewerStatus: 404 });

    const response = await readPath(makeApp(), VIDEO_ASSETS_PATH);

    expect(response.status).toBe(404);
    expect(fake.listCalls("fetchRenderedMediaSources")).toEqual([]);
  });

  describe("behind an operator pass", () => {
    beforeEach(async () => {
      ({ cookie } = await seedSignIn(harness.handle, kp));
      await seedPullRequest(harness.handle, OWNER);
      fake.failOn(
        "fetchRenderedMediaSources",
        FakeFailures.NOT_FOUND,
        CredentialKinds.REVIEWER,
      );
    });

    it("reads the granted pull request's sources on the operator token", async () => {
      arrangeRenderedMedia(fake, { videoSources: [SIGNED_VIDEO] });
      arrangeFakeGate(fake, {
        repoId: REPO_ID,
        viewerStatus: 404,
        inInstallation: false,
      });

      const response = await readPath(makeApp(OPERATOR_PAT), VIDEO_ASSETS_PATH);

      expect(await response.json()).toEqual({ assetIds: [PRIVATE_ID] });
      const pastGate = listCallsPastGate(fake, OPERATOR_GATE_CALLS);
      expect(listCallTokens(pastGate)).toEqual([ACCESS_TOKEN, OPERATOR_PAT]);
    });
  });
});
