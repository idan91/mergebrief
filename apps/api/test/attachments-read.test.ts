// GET /api/repos/:repoId/pulls/:prNumber/attachments/:assetId over PGlite: a
// GitHub asset found through the sources the pull request renders, read on
// the viewer's binding through the `github/testing` fake, then its bytes
// fetched with no credential; a branch file read with the viewer's token.
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
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  OPERATOR_GATE_CALLS,
  ROTATED_ACCESS_TOKEN,
  buildFakeAuthDeps,
  buildFakeInstallationDeps,
  listCallTokens,
  listCallsPastGate,
  listFakeCallTokens,
  makeFakePullRequestInfo,
  arrangeFakeGate,
  type GateGitHubOptions,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const REPO = { owner: "octo", repo: "hello" };
const OPERATOR_PAT = "ghp_OPERATOR_PAT";
const ASSET_ID = "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00";
const OTHER_ASSET_ID = "96abe080-db23-4366-9eb8-32a76d148ae5";
const SIGNED_URL = `https://private-user-images.githubusercontent.com/1/2-${ASSET_ID}.png?jwt=abc`;
const PUBLIC_URL = `https://github.com/user-attachments/assets/${OTHER_ASSET_ID}`;
const FILE_NAME = `${ASSET_ID}.png`;
const PNG_BYTES = [137, 80, 78, 71];
const ATTACHMENTS_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/attachments`;

const INSTALLATION: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const OWNER: ScopeContext = {
  ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)),
};

type AttachmentAnswer = (url: URL, token: string) => Response;

interface AttachmentFetchCall {
  readonly url: URL;
  readonly token: string;
}

function isAttachmentFetch(url: string): boolean {
  return (
    url.startsWith("https://private-user-images.githubusercontent.com/") ||
    url.startsWith("https://github.com/user-attachments/") ||
    url.includes("/contents/")
  );
}

function readBearer(init: RequestInit | undefined): string {
  const authorization = new Headers(init?.headers).get("authorization") ?? "";
  return authorization.replace(/^Bearer\s+/i, "");
}

/** The gate on `fake`, and the bytes fetches the read makes itself answered by `answer`. */
function stubAttachmentFetch(
  fake: FakeGitHub,
  gate: GateGitHubOptions,
  answer: AttachmentAnswer,
): AttachmentFetchCall[] {
  arrangeFakeGate(fake, gate);
  const gateFetch = globalThis.fetch;
  const calls: AttachmentFetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = getRequestUrl(input);
      if (!isAttachmentFetch(url)) {
        return gateFetch(input, init);
      }
      const call = { url: new URL(url), token: readBearer(init) };
      calls.push(call);
      return answer(call.url, call.token);
    }),
  );
  return calls;
}

function makePngResponse(): Response {
  return new Response(new Uint8Array(PNG_BYTES), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

function makeRawResponse(): Response {
  return new Response(new Uint8Array(PNG_BYTES), {
    status: 200,
    headers: { "content-type": "application/vnd.github.raw; charset=utf-8" },
  });
}

function makeCancelableResponse(
  cancel: () => void,
  contentType: string,
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
    cancel,
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function answerStatus(status: number): AttachmentAnswer {
  return () => new Response(null, { status });
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

function arrangeRenderedSources(
  fake: FakeGitHub,
  imageSources: readonly string[],
): void {
  fake.addPullRequest(
    { ...REPO, prNumber: PR_NUMBER },
    { info: makeFakePullRequestInfo({ repoId: REPO_ID }), imageSources },
  );
}

describe("GET attachments/:assetId", () => {
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

  async function readAttachment(
    app: ApiApp,
    assetId: string,
    method = "GET",
  ): Promise<Response> {
    return app.request(`${ATTACHMENTS_PATH}/${assetId}`, {
      method,
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  describe("a GitHub asset", () => {
    it("streams the asset with its type and the gated no-store posture", async () => {
      arrangeRenderedSources(fake, [SIGNED_URL]);
      stubAttachmentFetch(fake, { repoId: REPO_ID }, makePngResponse);

      const response = await readAttachment(makeApp(), ASSET_ID);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-disposition")).toBe("inline");
      expect(response.headers.get("content-security-policy")).toBe(
        "default-src 'none'; sandbox",
      );
      expect(response.headers.get("cross-origin-resource-policy")).toBe(
        "same-origin",
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(bytes)).toEqual(PNG_BYTES);
    });

    it("reads the sources on the viewer and fetches the bytes anonymously", async () => {
      arrangeRenderedSources(fake, [SIGNED_URL]);
      const fetched = stubAttachmentFetch(
        fake,
        { repoId: REPO_ID },
        makePngResponse,
      );
      const lookups = spyPullRequestLookups(harness);

      await readAttachment(makeApp(), ASSET_ID);

      expect(fake.listCalls("fetchRenderedImageSources")[0]?.input).toEqual({
        ...REPO,
        prNumber: PR_NUMBER,
      });
      expect(listCallTokens(listCallsPastGate(fake))).toEqual([ACCESS_TOKEN]);
      expect(fetched).toEqual([{ url: new URL(SIGNED_URL), token: "" }]);
      expect(lookups.count()).toBe(0);
    });

    it("serves a second image from the cached sources", async () => {
      arrangeRenderedSources(fake, [SIGNED_URL, PUBLIC_URL]);
      stubAttachmentFetch(fake, { repoId: REPO_ID }, makePngResponse);
      const app = makeApp();

      await readAttachment(app, ASSET_ID);
      const second = await readAttachment(app, OTHER_ASSET_ID);

      expect(second.status).toBe(200);
      expect(fake.listCalls("fetchRenderedImageSources")).toHaveLength(1);
    });

    it("answers 404 when the pull request renders no such asset", async () => {
      arrangeRenderedSources(fake, ["https://camo.githubusercontent.com/x"]);
      const fetched = stubAttachmentFetch(
        fake,
        { repoId: REPO_ID },
        makePngResponse,
      );

      const response = await readAttachment(makeApp(), ASSET_ID);

      expect(response.status).toBe(404);
      expect(fetched).toEqual([]);
    });

    it("answers 404 for a malformed asset id without calling github", async () => {
      stubAttachmentFetch(fake, { repoId: REPO_ID }, makePngResponse);

      const response = await readAttachment(makeApp(), "not-a-uuid");

      expect(response.status).toBe(404);
      expect(listCallsPastGate(fake)).toEqual([]);
    });

    it("answers 404 when github denies the pull request", async () => {
      arrangeRenderedSources(fake, [SIGNED_URL]);
      fake.failOn("fetchRenderedImageSources", FakeFailures.FORBIDDEN);
      stubAttachmentFetch(fake, { repoId: REPO_ID }, makePngResponse);

      const response = await readAttachment(makeApp(), ASSET_ID);

      expect(response.status).toBe(404);
    });

    it("answers 404 when the signed url no longer serves an image", async () => {
      arrangeRenderedSources(fake, [SIGNED_URL]);
      stubAttachmentFetch(fake, { repoId: REPO_ID }, answerStatus(404));

      const response = await readAttachment(makeApp(), ASSET_ID);

      expect(response.status).toBe(404);
    });

    it("answers 502 on an upstream failure", async () => {
      arrangeRenderedSources(fake, [SIGNED_URL]);
      fake.failOn("fetchRenderedImageSources", FakeFailures.SERVER_ERROR);
      stubAttachmentFetch(fake, { repoId: REPO_ID }, makePngResponse);

      const response = await readAttachment(makeApp(), ASSET_ID);

      expect(response.status).toBe(502);
    });

    it("retries once on the rotated token after a 401", async () => {
      arrangeRenderedSources(fake, [SIGNED_URL]);
      fake.rejectToken(ACCESS_TOKEN);
      stubAttachmentFetch(fake, { repoId: REPO_ID }, makePngResponse);

      const response = await readAttachment(makeApp(), ASSET_ID);

      expect(response.status).toBe(200);
      // The gate's read spends the one renewal; the walk and the read ride it.
      expect(listFakeCallTokens(fake)).toEqual([
        ACCESS_TOKEN,
        ROTATED_ACCESS_TOKEN,
        ROTATED_ACCESS_TOKEN,
        ROTATED_ACCESS_TOKEN,
        ROTATED_ACCESS_TOKEN,
      ]);
    });

    it("answers 401 when the read still 401s after a good refresh", async () => {
      arrangeRenderedSources(fake, [SIGNED_URL]);
      fake.failOn(
        "fetchRenderedImageSources",
        FakeFailures.UNAUTHORIZED,
        CredentialKinds.REVIEWER,
      );
      stubAttachmentFetch(fake, { repoId: REPO_ID }, makePngResponse);

      const response = await readAttachment(makeApp(), ASSET_ID);

      expect(response.status).toBe(401);
      expect(fake.listCalls("fetchRenderedImageSources")).toHaveLength(2);
    });

    it("answers 404 for an svg and cancels the upstream body", async () => {
      const cancelled = vi.fn();
      arrangeRenderedSources(fake, [SIGNED_URL]);
      stubAttachmentFetch(fake, { repoId: REPO_ID }, () =>
        makeCancelableResponse(cancelled, "image/svg+xml"),
      );

      const response = await readAttachment(makeApp(), ASSET_ID);

      expect(response.status).toBe(404);
      expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it("answers a head request with the headers and no open stream", async () => {
      const cancelled = vi.fn();
      arrangeRenderedSources(fake, [SIGNED_URL]);
      stubAttachmentFetch(fake, { repoId: REPO_ID }, () =>
        makeCancelableResponse(cancelled, "image/png"),
      );

      const response = await readAttachment(makeApp(), ASSET_ID, "HEAD");

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(await response.text()).toBe("");
      expect(cancelled).toHaveBeenCalledTimes(1);
    });
  });

  describe("behind an operator pass", () => {
    beforeEach(async () => {
      ({ cookie } = await seedSignIn(harness.handle, kp));
      await seedPullRequest(harness.handle, OWNER);
      fake.failOn(
        "fetchRenderedImageSources",
        FakeFailures.NOT_FOUND,
        CredentialKinds.REVIEWER,
      );
    });

    it("reads the granted pull request's sources on the operator token", async () => {
      arrangeRenderedSources(fake, [SIGNED_URL]);
      const gate = {
        repoId: REPO_ID,
        viewerStatus: 404,
        inInstallation: false,
      };
      stubAttachmentFetch(fake, gate, makePngResponse);
      const lookups = spyPullRequestLookups(harness);

      const response = await readAttachment(makeApp(OPERATOR_PAT), ASSET_ID);

      expect(response.status).toBe(200);
      const pastGate = listCallsPastGate(fake, OPERATOR_GATE_CALLS);
      expect(listCallTokens(pastGate)).toEqual([ACCESS_TOKEN, OPERATOR_PAT]);
      // The gate rung probes the reader's own url row; the read loads none.
      expect(lookups.count()).toBe(1);
    });

    it("keeps a reviewer-footed denial off the operator token", async () => {
      arrangeRenderedSources(fake, [SIGNED_URL]);
      const gate = { repoId: REPO_ID, inInstallation: false };
      stubAttachmentFetch(fake, gate, makePngResponse);

      const response = await readAttachment(makeApp(OPERATOR_PAT), ASSET_ID);

      expect(response.status).toBe(404);
      expect(listCallTokens(listCallsPastGate(fake))).toEqual([ACCESS_TOKEN]);
    });

    it("never borrows the operator token for a branch file", async () => {
      const gate = {
        repoId: REPO_ID,
        viewerStatus: 404,
        inInstallation: false,
      };
      const fetched = stubAttachmentFetch(fake, gate, answerStatus(404));

      const response = await readAttachment(makeApp(OPERATOR_PAT), FILE_NAME);

      expect(response.status).toBe(404);
      expect(fetched.map((call) => call.token)).toEqual([ACCESS_TOKEN]);
    });
  });

  describe("a branch file", () => {
    it("streams the file with the type its name declares", async () => {
      stubAttachmentFetch(fake, { repoId: REPO_ID }, makeRawResponse);

      const response = await readAttachment(makeApp(), FILE_NAME);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(bytes)).toEqual(PNG_BYTES);
      expect(listCallsPastGate(fake)).toEqual([]);
    });

    it("reads the gated repo's attachments branch with the viewer token", async () => {
      const fetched = stubAttachmentFetch(
        fake,
        { repoId: REPO_ID },
        makeRawResponse,
      );

      await readAttachment(makeApp(), FILE_NAME);

      const [call] = fetched;
      expect(call?.url.pathname).toBe(
        `/repos/octo/hello/contents/${FILE_NAME}`,
      );
      expect(call?.url.searchParams.get("ref")).toBe("mergebrief/attachments");
      expect(call?.token).toBe(ACCESS_TOKEN);
    });

    it("answers 404 for a file outside the image allowlist", async () => {
      const fetched = stubAttachmentFetch(
        fake,
        { repoId: REPO_ID },
        makeRawResponse,
      );

      const response = await readAttachment(makeApp(), `${ASSET_ID}.svg`);

      expect(response.status).toBe(404);
      expect(fetched).toEqual([]);
    });

    it("answers 404 when the branch holds no such file", async () => {
      stubAttachmentFetch(fake, { repoId: REPO_ID }, answerStatus(404));

      const response = await readAttachment(makeApp(), FILE_NAME);

      expect(response.status).toBe(404);
    });

    it("retries once on the rotated token after a 401", async () => {
      const fetched = stubAttachmentFetch(
        fake,
        { repoId: REPO_ID },
        (_url, token) =>
          token === ACCESS_TOKEN
            ? new Response(null, { status: 401 })
            : makeRawResponse(),
      );

      const response = await readAttachment(makeApp(), FILE_NAME);

      expect(response.status).toBe(200);
      expect(fetched.map((call) => call.token)).toEqual([
        ACCESS_TOKEN,
        ROTATED_ACCESS_TOKEN,
      ]);
    });

    it("answers 401 when the rotated token is rejected too", async () => {
      stubAttachmentFetch(fake, { repoId: REPO_ID }, answerStatus(401));

      const response = await readAttachment(makeApp(), FILE_NAME);

      expect(response.status).toBe(401);
    });
  });
});
