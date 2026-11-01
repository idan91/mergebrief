// `?thumbnail=strip` on both attachment reads over PGlite: the original read
// whole with no `Range`, resized to one WebP size, answered under the same
// sandboxed no-store headers; anything that cannot be resized answers as a
// failed read.
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createTenantRepository,
  type AppDatabase,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import sharp from "sharp";
import { PrStates } from "types/pull-requests";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  SECRET,
  brandInstallationId,
  brandRepoId,
  createKeyProvider,
  getRequestUrl,
} from "./fixtures";
import { testLogger } from "./logging";
import {
  arrangeFakeGate,
  buildFakeAuthDeps,
  buildFakeInstallationDeps,
  makeFakePullRequestInfo,
} from "./reviewer-github";
import { seedSignIn } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

vi.setConfig({ testTimeout: 10_000 });

const REPO_ID = 424242;
const REPO = { owner: "octo", repo: "hello" };
const ASSET_ID = "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00";
const SIGNED_URL = `https://private-user-images.githubusercontent.com/1/2-${ASSET_ID}.png?jwt=abc`;
const SIGNED_VIDEO_URL = SIGNED_URL.replace(".png", ".mp4");
const MP4_HEAD = [0, 0, 0, 0x20, ...new TextEncoder().encode("ftypisom")];
const PR_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`;
const COMMITTED_SOURCE =
  "https://github.com/octo/hello/raw/main/docs/after.png";
const DOWNLOAD_URL =
  "https://raw.githubusercontent.com/octo/hello/main/docs/after.png?token=RAWTOKEN";
const THUMBNAIL_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
const WEBP_TAG = "WEBP";
/** A PNG signature and the start of its header: past the 12 bytes the read sniffs. */
const PNG_HEAD = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48,
  0x44, 0x52,
]);

const INSTALLATION: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};

interface UpstreamCall {
  readonly url: URL;
  readonly range: string | undefined;
}

type UpstreamAnswer = (url: URL) => Response;

function isUpstreamFetch(url: string): boolean {
  return (
    url.startsWith("https://private-user-images.githubusercontent.com/") ||
    url.startsWith("https://raw.githubusercontent.com/") ||
    url.includes("/git/matching-refs/") ||
    url.includes("/contents/")
  );
}

function makeJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** `main` is the only branch; the contents JSON names `DOWNLOAD_URL`; `bytes` answers the rest. */
function answerCommittedFile(bytes: UpstreamAnswer): UpstreamAnswer {
  return (url) => {
    if (url.pathname.includes("/matching-refs/heads/")) {
      return makeJsonResponse([{ ref: "refs/heads/main" }]);
    }
    if (url.pathname.includes("/matching-refs/tags/")) {
      return makeJsonResponse([]);
    }
    if (url.pathname.includes("/contents/")) {
      return makeJsonResponse({ type: "file", download_url: DOWNLOAD_URL });
    }
    return bytes(url);
  };
}

function stubUpstream(
  fake: FakeGitHub,
  answer: UpstreamAnswer,
): UpstreamCall[] {
  arrangeFakeGate(fake, { repoId: REPO_ID });
  const gateFetch = globalThis.fetch;
  const calls: UpstreamCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = getRequestUrl(input);
      if (!isUpstreamFetch(url)) {
        return gateFetch(input, init);
      }
      const range = new Headers(init?.headers).get("range") ?? undefined;
      calls.push({ url: new URL(url), range });
      return answer(new URL(url));
    }),
  );
  return calls;
}

async function makePng(width: number, height: number): Promise<Uint8Array> {
  return sharp({
    create: { width, height, channels: 3, background: "#22aa66" },
  })
    .png()
    .toBuffer();
}

function answerBytes(bytes: Uint8Array, contentType: string): UpstreamAnswer {
  return () =>
    new Response(bytes, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
      },
    });
}

async function readThumbnail(
  response: Response,
): Promise<{ format: string; width?: number; height?: number }> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const tag = new TextDecoder().decode(bytes.subarray(8, 12));
  const { width, height } = await sharp(bytes).metadata();
  return { format: tag, width, height };
}

async function seedPullRequest(handle: AppDatabase): Promise<void> {
  const repoId = brandRepoId(BigInt(REPO_ID));
  await createTenantRepository(handle, INSTALLATION).pullRequests.upsert({
    repoId,
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

describe("thumbnail reads", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let cookie: string;

  beforeEach(async () => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    ({ cookie } = await seedSignIn(harness.handle, kp));
    await seedPullRequest(harness.handle);
  });

  function makeApp(): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...buildFakeInstallationDeps(fake),
    });
  }

  function arrangeRenderedSources(imageSources: readonly string[]): void {
    fake.addPullRequest(
      { ...REPO, prNumber: PR_NUMBER },
      { info: makeFakePullRequestInfo({ repoId: REPO_ID }), imageSources },
    );
  }

  async function requestPath(
    path: string,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return makeApp().request(path, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}`, ...headers },
    });
  }

  function buildCommittedPath(source: string, thumbnail = "strip"): string {
    const query = new URLSearchParams({ source, thumbnail });
    return `${PR_PATH}/committed-file?${query.toString()}`;
  }

  describe("a pasted asset", () => {
    it("answers a webp fitting 496x156 under the attachment headers", async () => {
      arrangeRenderedSources([SIGNED_URL]);
      const png = await makePng(1600, 800);
      stubUpstream(fake, answerBytes(png, "image/png"));

      const response = await requestPath(
        `${PR_PATH}/attachments/${ASSET_ID}?thumbnail=strip`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-disposition")).toBe("inline");
      expect(response.headers.get("content-security-policy")).toBe(
        "default-src 'none'; sandbox",
      );
      expect(response.headers.get("cross-origin-resource-policy")).toBe(
        "same-origin",
      );
      const length = Number(response.headers.get("content-length"));
      expect(await readThumbnail(response)).toEqual({
        format: WEBP_TAG,
        width: 312,
        height: 156,
      });
      expect(length).toBeGreaterThan(0);
    });

    it("answers a head request with the headers and no resize", async () => {
      arrangeRenderedSources([SIGNED_URL]);
      stubUpstream(fake, answerBytes(PNG_HEAD, "image/png"));
      const path = `${PR_PATH}/attachments/${ASSET_ID}?thumbnail=strip`;

      const head = await makeApp().request(path, {
        method: "HEAD",
        headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
      });
      const get = await requestPath(path);

      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toBe("image/webp");
      expect(head.headers.get("cache-control")).toBe("no-store");
      expect(await head.arrayBuffer()).toHaveProperty("byteLength", 0);
      expect(get.status).not.toBe(200);
    });

    it("reads the original whole even when the client sent a range", async () => {
      arrangeRenderedSources([SIGNED_URL]);
      const calls = stubUpstream(
        fake,
        answerBytes(await makePng(40, 40), "image/png"),
      );

      const response = await requestPath(
        `${PR_PATH}/attachments/${ASSET_ID}?thumbnail=strip`,
        { range: "bytes=0-1" },
      );

      expect(response.status).toBe(200);
      expect(calls.map((call) => call.range)).toEqual([undefined]);
    });

    it("answers 404 for a pasted video", async () => {
      arrangeRenderedSources([SIGNED_VIDEO_URL]);
      const video = new Uint8Array(4096);
      video.set(MP4_HEAD);
      const calls = stubUpstream(fake, answerBytes(video, "video/mp4"));

      const response = await requestPath(
        `${PR_PATH}/attachments/${ASSET_ID}?thumbnail=strip`,
      );

      expect(response.status).toBe(404);
      expect(calls.map((call) => call.range)).toEqual([undefined]);
    });

    it("answers 404 when the image does not decode", async () => {
      arrangeRenderedSources([SIGNED_URL]);
      const png = await makePng(40, 40);
      stubUpstream(fake, answerBytes(png.subarray(0, 30), "image/png"));

      const response = await requestPath(
        `${PR_PATH}/attachments/${ASSET_ID}?thumbnail=strip`,
      );

      expect(response.status).toBe(404);
    });

    it("answers 400 for a thumbnail form other than strip", async () => {
      arrangeRenderedSources([SIGNED_URL]);
      const calls = stubUpstream(
        fake,
        answerBytes(await makePng(40, 40), "image/png"),
      );

      const response = await requestPath(
        `${PR_PATH}/attachments/${ASSET_ID}?thumbnail=1200`,
      );

      expect(response.status).toBe(400);
      expect(calls).toEqual([]);
    });
  });

  describe("a committed file", () => {
    it("answers a webp of a committed png read without a range", async () => {
      const png = await makePng(300, 900);
      const calls = stubUpstream(
        fake,
        answerCommittedFile(answerBytes(png, "application/octet-stream")),
      );

      const response = await requestPath(buildCommittedPath(COMMITTED_SOURCE));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(await readThumbnail(response)).toEqual({
        format: WEBP_TAG,
        width: 52,
        height: 156,
      });
      const raw = calls.filter((call) => call.url.host.startsWith("raw."));
      expect(raw.map((call) => call.range)).toEqual([undefined]);
    });

    it.each(["docs/flow.svg", "docs/demo.mp4"])(
      "answers 404 for %s without calling github",
      async (path) => {
        const calls = stubUpstream(
          fake,
          answerCommittedFile(() => makeJsonResponse({})),
        );
        const source = COMMITTED_SOURCE.replace("docs/after.png", path);

        const response = await requestPath(buildCommittedPath(source));

        expect(response.status).toBe(404);
        expect(calls).toEqual([]);
      },
    );

    it("answers 404 for an original past the thumbnail bound", async () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(PNG_HEAD);
        },
        cancel() {
          cancelled = true;
        },
      });
      stubUpstream(
        fake,
        answerCommittedFile(
          () =>
            new Response(body, {
              headers: {
                "content-length": String(THUMBNAIL_SOURCE_MAX_BYTES + 1),
              },
            }),
        ),
      );

      const response = await requestPath(buildCommittedPath(COMMITTED_SOURCE));

      expect(response.status).toBe(404);
      expect(cancelled).toBe(true);
    });

    it("serves the original when no thumbnail is asked", async () => {
      const png = await makePng(40, 40);
      stubUpstream(
        fake,
        answerCommittedFile(answerBytes(png, "application/octet-stream")),
      );
      const query = new URLSearchParams({ source: COMMITTED_SOURCE });

      const response = await requestPath(
        `${PR_PATH}/committed-file?${query.toString()}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      const served = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(served)).toEqual(Array.from(png));
    });
  });
});
