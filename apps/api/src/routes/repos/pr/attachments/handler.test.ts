import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { GitHubApiErrorCodes, fetchRenderedImageSources } from "github";
import type * as githubModule from "github";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isInstallationId,
  isRepoId,
  isReviewerId,
  WriteClassifications,
  type AppDatabase,
} from "persistence";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../../../../shared-errors/on-error";
import type * as refreshModule from "../../../auth/session/logic/refresh";
import { refreshSessionToken } from "../../../auth/session/logic/refresh";
import {
  AuthChannels,
  type ViewerPrincipal,
} from "../../../auth/session/types";
import type { AuthzEnv } from "../../../authz";
import { createTtlCache, type TtlCache } from "../../../ttl-cache";
import type { InstallationGitHubPort } from "../../../github-port";
import { createAttachmentsHandlers } from "./handler";
import type {
  AttachmentsControllerDeps,
  AttachmentsRouteDeps,
  RenderedSources,
} from "./types";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  fetchRenderedImageSources: vi.fn(),
}));

vi.mock("../../../auth/session/logic/refresh", async (importOriginal) => ({
  ...(await importOriginal<typeof refreshModule>()),
  refreshSessionToken: vi.fn(),
}));

const KEY_REF = "SESSION_KEY_TEST";
const keyProvider = createEnvKeyProvider({
  [KEY_REF]: randomBytes(32).toString("base64"),
});
const ASSET_ID = "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00";
const SIGNED_URL = `https://private-user-images.githubusercontent.com/1/2-${ASSET_ID}.png?jwt=abc`;

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

function brand<T extends bigint>(
  value: bigint,
  guard: (candidate: bigint) => candidate is T,
): T {
  if (!guard(value)) {
    throw new Error("fixture id failed its guard");
  }
  return value;
}

const fetchMock = vi.fn<typeof fetch>();
const sourcesMock = vi.mocked(fetchRenderedImageSources);

function stubFetchResponse(response: Response) {
  fetchMock.mockResolvedValueOnce(response);
}

function stubSources(sources: readonly string[]) {
  sourcesMock.mockResolvedValueOnce({ ok: true, value: sources });
}

const DENIED_CODE_BY_STATUS: Readonly<
  Record<number, githubModule.GitHubApiErrorCode>
> = {
  401: GitHubApiErrorCodes.UNAUTHORIZED,
  404: GitHubApiErrorCodes.NOT_FOUND,
};

function stubSourcesDenied(status: number) {
  const code =
    DENIED_CODE_BY_STATUS[status] ?? GitHubApiErrorCodes.REQUEST_FAILED;
  sourcesMock.mockResolvedValueOnce({
    ok: false,
    error: { code, status, message: `fixture ${status}` },
  });
}

function makePngResponse() {
  return new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

function makeCancelableBody(cancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
    cancel,
  });
}

const commitMock = vi.fn<InstallationGitHubPort["commitAttachment"]>();

interface BuildAppOptions {
  /** The gate passed this request on the operator PAT. */
  readonly urlBoxOnly?: boolean;
  /** The repo sits in no installation: the owner world. */
  readonly ownerWorld?: boolean;
  readonly urlBoxFallbackToken?: string;
  /** Replaces the sealed token so the handler's own decrypt fails. */
  readonly ghTokenCiphertext?: string;
  readonly sourcesCache?: TtlCache<RenderedSources>;
  readonly sourcesInFlight?: AttachmentsControllerDeps["sourcesInFlight"];
}

async function buildApp(
  options: BuildAppOptions = {},
): Promise<Hono<AuthzEnv>> {
  const sealed = await encryptToken(keyProvider, KEY_REF, "ghu_fixture");
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  const session: ViewerPrincipal = {
    id: 1n,
    sessionTokenHash: "hash-fixed",
    reviewerId: brand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId: brand(7n, isGrantRowId),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: options.ghTokenCiphertext ?? sealed.value,
    keyRef: KEY_REF,
    scope: WriteClassifications.EXTERNAL_WRITE,
    channel: AuthChannels.COOKIE,
  };
  const deps: AttachmentsRouteDeps = {
    // The handler touches no table; the refresh path is mocked above.
    handle: {} as AppDatabase,
    auth: {
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      keyProvider,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: "https://example.test",
    },
    urlBoxFallbackToken: options.urlBoxFallbackToken,
    github: {
      fetchPullRequestConversation: async () => {
        throw new Error("conversation port must not be called in this suite");
      },
      listRepoCollaborators: async () => {
        throw new Error("collaborators port must not be called in this suite");
      },
      commitAttachment: commitMock,
      deleteAttachmentBranch: async () => {
        throw new Error("attachment port must not be called in this suite");
      },
    },
  };
  const app = new Hono<AuthzEnv>();
  app.onError(createErrorHandler<AuthzEnv>(log));
  app.use(async (c, next) => {
    c.set("logger", log);
    c.set(
      "ctx",
      options.ownerWorld === true
        ? { ownerUserId: brand(42n, isReviewerId) }
        : { installationId: brand(1001n, isInstallationId) },
    );
    c.set("session", session);
    c.set("repoId", brand(555n, isRepoId));
    c.set("repoFullName", "acme/app");
    c.set("viewerCanPush", true);
    if (options.urlBoxOnly === true) {
      c.set("urlBoxOnly", true);
    }
    await next();
  });
  const handlers = createAttachmentsHandlers(
    deps,
    options.sourcesCache ?? createTtlCache<RenderedSources>(10),
    options.sourcesInFlight ?? new Map(),
  );
  app.get("/:prNumber/attachments/:assetId", handlers.readAttachment);
  app.post("/:prNumber/attachments", handlers.uploadAttachment);
  return app;
}

beforeEach(() => {
  fetchMock.mockReset();
  sourcesMock.mockReset();
  commitMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(refreshSessionToken).mockReset();
  vi.mocked(refreshSessionToken).mockResolvedValue({
    ok: false,
    error: { code: "refresh-failed" },
  } as Awaited<ReturnType<typeof refreshSessionToken>>);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET attachments/:assetId", () => {
  it("streams the asset with its type and the gated no-store posture", async () => {
    stubSources([SIGNED_URL]);
    stubFetchResponse(makePngResponse());
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

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
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
  });

  it("reads the rendered sources for the gated repo and fetches anonymously", async () => {
    stubSources([SIGNED_URL]);
    stubFetchResponse(makePngResponse());
    const app = await buildApp();

    await app.request(`/7/attachments/${ASSET_ID}`);

    expect(sourcesMock.mock.calls[0]?.[1]).toEqual({
      owner: "acme",
      repo: "app",
      prNumber: 7,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(SIGNED_URL);
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("serves a second image from the cached sources without github", async () => {
    const other = "96abe080-db23-4366-9eb8-32a76d148ae5";
    const cache = createTtlCache<RenderedSources>(10);
    stubSources([
      SIGNED_URL,
      `https://github.com/user-attachments/assets/${other}`,
    ]);
    stubFetchResponse(makePngResponse());
    stubFetchResponse(makePngResponse());
    const app = await buildApp({ sourcesCache: cache });

    await app.request(`/7/attachments/${ASSET_ID}`);
    const second = await app.request(`/7/attachments/${other}`);

    expect(second.status).toBe(200);
    expect(sourcesMock).toHaveBeenCalledTimes(1);
  });

  it("refetches the sources when an old cached entry lacks the asset", async () => {
    const cache = createTtlCache<RenderedSources>(10);
    cache.set(
      "hash-fixed:555:7",
      { sources: [], fetchedAt: Date.now() - 60_000 },
      Date.now() + 60_000,
    );
    stubSources([SIGNED_URL]);
    stubFetchResponse(makePngResponse());
    const app = await buildApp({ sourcesCache: cache });

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(200);
    expect(sourcesMock).toHaveBeenCalledTimes(1);
  });

  it("answers 404 without github when a young entry lacks the asset", async () => {
    const cache = createTtlCache<RenderedSources>(10);
    cache.set(
      "hash-fixed:555:7",
      { sources: [], fetchedAt: Date.now() },
      Date.now() + 60_000,
    );
    const app = await buildApp({ sourcesCache: cache });

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(404);
    expect(sourcesMock).not.toHaveBeenCalled();
  });

  it("shares one github call across images requested together", async () => {
    const other = "96abe080-db23-4366-9eb8-32a76d148ae5";
    let release: (() => void) | undefined;
    sourcesMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () =>
          resolve({
            ok: true,
            value: [
              SIGNED_URL,
              `https://github.com/user-attachments/assets/${other}`,
            ],
          });
      }),
    );
    stubFetchResponse(makePngResponse());
    stubFetchResponse(makePngResponse());
    const app = await buildApp();

    const pending = Promise.all([
      app.request(`/7/attachments/${ASSET_ID}`),
      app.request(`/7/attachments/${other}`),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release?.();
    const [first, second] = await pending;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(sourcesMock).toHaveBeenCalledTimes(1);
  });

  it("answers 404 when the pull request renders no such asset", async () => {
    stubSources(["https://camo.githubusercontent.com/x"]);
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed asset id without calling github", async () => {
    const app = await buildApp();

    const response = await app.request("/7/attachments/not-a-uuid");

    expect(response.status).toBe(404);
    expect(sourcesMock).not.toHaveBeenCalled();
  });

  it("answers 404 when github denies the pull request", async () => {
    stubSourcesDenied(404);
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(404);
  });

  it("answers 404 when the signed url no longer serves an image", async () => {
    stubSources([SIGNED_URL]);
    stubFetchResponse(new Response(null, { status: 404 }));
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(404);
  });

  it("answers 404 for an svg attachment", async () => {
    stubSources([SIGNED_URL]);
    stubFetchResponse(
      new Response("<svg></svg>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(404);
  });

  it("answers 401 when the token is rejected and the refresh fails", async () => {
    stubSourcesDenied(401);
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(401);
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
  });

  it("answers 401 when the stored token cannot be read", async () => {
    const app = await buildApp({ ghTokenCiphertext: "not-a-sealed-token" });

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(401);
    expect(sourcesMock).not.toHaveBeenCalled();
  });

  it("answers 502 on an upstream failure", async () => {
    stubSourcesDenied(502);
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(502);
  });

  it("answers 400 for a malformed pull number", async () => {
    const app = await buildApp();

    const response = await app.request(`/zero/attachments/${ASSET_ID}`);

    expect(response.status).toBe(400);
    expect(sourcesMock).not.toHaveBeenCalled();
  });

  it("retries once on the rotated token after a refresh", async () => {
    stubSourcesDenied(401);
    stubSources([SIGNED_URL]);
    stubFetchResponse(makePngResponse());
    const app = await buildApp();
    vi.mocked(refreshSessionToken).mockImplementation(
      async (_deps, session) =>
        ({
          ok: true,
          value: { session, accessToken: "ghu_rotated" },
        }) as Awaited<ReturnType<typeof refreshSessionToken>>,
    );

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(200);
    expect(sourcesMock).toHaveBeenCalledTimes(2);
  });

  it("answers 502 when the rotated token is rejected too", async () => {
    stubSourcesDenied(401);
    stubSourcesDenied(401);
    const app = await buildApp();
    vi.mocked(refreshSessionToken).mockImplementation(
      async (_deps, session) =>
        ({
          ok: true,
          value: { session, accessToken: "ghu_rotated" },
        }) as Awaited<ReturnType<typeof refreshSessionToken>>,
    );

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(502);
  });

  it("falls back to the operator pat when the gate passed on it", async () => {
    stubSourcesDenied(404);
    stubSources([SIGNED_URL]);
    stubFetchResponse(makePngResponse());
    const app = await buildApp({
      urlBoxOnly: true,
      urlBoxFallbackToken: "github_pat_fixture",
    });

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(200);
    expect(sourcesMock).toHaveBeenCalledTimes(2);
  });

  it("never borrows the operator pat on an ordinary request", async () => {
    stubSourcesDenied(404);
    const app = await buildApp({ urlBoxFallbackToken: "github_pat_fixture" });

    const response = await app.request(`/7/attachments/${ASSET_ID}`);

    expect(response.status).toBe(404);
    expect(sourcesMock).toHaveBeenCalledTimes(1);
  });

  it("cancels the upstream body it will not serve", async () => {
    const cancelled = vi.fn();
    stubSources([SIGNED_URL]);
    stubFetchResponse(
      new Response(makeCancelableBody(cancelled), {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    const app = await buildApp();

    await app.request(`/7/attachments/${ASSET_ID}`);

    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("answers a head request with the headers and no open stream", async () => {
    const cancelled = vi.fn();
    stubSources([SIGNED_URL]);
    stubFetchResponse(
      new Response(makeCancelableBody(cancelled), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${ASSET_ID}`, {
      method: "HEAD",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("");
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});

describe("GET attachments/:assetId for a branch-hosted file", () => {
  const FILE_NAME = `${ASSET_ID}.png`;

  function makeRawResponse() {
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "application/vnd.github.raw; charset=utf-8" },
    });
  }

  function readFetchCall(index: number): { url: URL; headers: Headers } {
    const [url, init] = fetchMock.mock.calls[index] as unknown as [
      string,
      RequestInit,
    ];
    return { url: new URL(url), headers: new Headers(init.headers) };
  }

  it("streams the file with the type its name declares", async () => {
    stubFetchResponse(makeRawResponse());
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${FILE_NAME}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
    expect(sourcesMock).not.toHaveBeenCalled();
  });

  it("reads the gated repo's attachments branch with the viewer token", async () => {
    stubFetchResponse(makeRawResponse());
    const app = await buildApp();

    await app.request(`/7/attachments/${FILE_NAME}`);

    const { url, headers } = readFetchCall(0);
    expect(url.pathname).toBe(`/repos/acme/app/contents/${FILE_NAME}`);
    expect(url.searchParams.get("ref")).toBe("mergebrief/attachments");
    expect(headers.get("authorization")).toBe("Bearer ghu_fixture");
  });

  it("answers 404 for a file outside the image allowlist", async () => {
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${ASSET_ID}.svg`);

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 404 when the branch holds no such file", async () => {
    stubFetchResponse(new Response(null, { status: 404 }));
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${FILE_NAME}`);

    expect(response.status).toBe(404);
  });

  it("retries once on the rotated token after a refresh", async () => {
    stubFetchResponse(new Response(null, { status: 401 }));
    stubFetchResponse(makeRawResponse());
    const app = await buildApp();
    vi.mocked(refreshSessionToken).mockImplementation(
      async (_deps, session) =>
        ({
          ok: true,
          value: { session, accessToken: "ghu_rotated" },
        }) as Awaited<ReturnType<typeof refreshSessionToken>>,
    );

    const response = await app.request(`/7/attachments/${FILE_NAME}`);

    expect(response.status).toBe(200);
    expect(readFetchCall(1).headers.get("authorization")).toBe(
      "Bearer ghu_rotated",
    );
  });

  it("answers 401 when the token is rejected and the refresh fails", async () => {
    stubFetchResponse(new Response(null, { status: 401 }));
    const app = await buildApp();

    const response = await app.request(`/7/attachments/${FILE_NAME}`);

    expect(response.status).toBe(401);
  });

  it("never borrows the operator pat for a branch file", async () => {
    stubFetchResponse(new Response(null, { status: 404 }));
    stubFetchResponse(makeRawResponse());
    const app = await buildApp({
      urlBoxOnly: true,
      urlBoxFallbackToken: "github_pat_fixture",
    });

    const response = await app.request(`/7/attachments/${FILE_NAME}`);

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST attachments", () => {
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
  ]);
  const FILE_NAME_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;

  function stubRepoResolve() {
    stubFetchResponse(
      new Response(
        JSON.stringify({ id: 555, full_name: "acme/app", private: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }

  function stubCommit(result: Awaited<ReturnType<typeof commitMock>>) {
    commitMock.mockResolvedValueOnce(result);
  }

  async function upload(
    app: Hono<AuthzEnv>,
    body: string | Uint8Array,
    headers: Record<string, string> = { "content-type": "image/png" },
  ) {
    return app.request("/7/attachments", { method: "POST", headers, body });
  }

  it("answers 201 with the branch url of the committed file", async () => {
    stubRepoResolve();
    stubCommit({ ok: true, value: { commitSha: "c1" } });
    const app = await buildApp();

    const response = await upload(app, PNG);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { url: string };
    const fileName = body.url.split("/").at(-1)?.replace("?raw=true", "");
    expect(fileName).toMatch(FILE_NAME_PATTERN);
    expect(body.url).toBe(
      `https://github.com/acme/app/blob/mergebrief/attachments/${fileName}?raw=true`,
    );
    expect(commitMock.mock.calls[0]?.[0]).toBe(1001n);
    expect(commitMock.mock.calls[0]?.[1]).toMatchObject({
      owner: "acme",
      repo: "app",
      branch: "mergebrief/attachments",
      path: fileName,
    });
    expect(Array.from(commitMock.mock.calls[0]?.[1].bytes ?? [])).toEqual(
      Array.from(PNG),
    );
  });

  it("answers 413 over the cap without calling github", async () => {
    const app = await buildApp();
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    oversized.set(PNG);

    const response = await upload(app, oversized);

    expect(response.status).toBe(413);
    expect(((await response.json()) as { code: string }).code).toBe(
      "request-too-large",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("answers 400 for a type outside the allowlist", async () => {
    const app = await buildApp();

    const response = await upload(app, "<svg/>", {
      "content-type": "image/svg+xml",
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      "attachment-unsupported-type",
    );
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("answers 400 when the bytes are not the declared type", async () => {
    const app = await buildApp();

    const response = await upload(app, new Uint8Array([0xff, 0xd8, 0xff, 1]), {
      "content-type": "image/png",
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      "attachment-unsupported-type",
    );
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("answers 404 on a url-box pull request", async () => {
    const app = await buildApp({ ownerWorld: true });

    const response = await upload(app, PNG);

    expect(response.status).toBe(404);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("answers 403 github-permission when the App itself may not push", async () => {
    stubRepoResolve();
    stubCommit({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.FORBIDDEN,
        status: 403,
        message: "fixture denied",
      },
    });
    const app = await buildApp();

    const response = await upload(app, PNG);

    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      "github-permission",
    );
  });

  it("answers 403 attachments-disabled when the repository refuses the push", async () => {
    stubRepoResolve();
    stubCommit({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.RULE_REFUSED,
        status: 422,
        message: "fixture refused",
      },
    });
    const app = await buildApp();

    const response = await upload(app, PNG);

    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      "attachments-disabled",
    );
  });

  it("answers 404 when the app no longer holds the repository", async () => {
    stubRepoResolve();
    stubCommit({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.NOT_FOUND,
        status: 404,
        message: "fixture",
      },
    });
    const app = await buildApp();

    const response = await upload(app, PNG);

    expect(response.status).toBe(404);
  });

  it("answers 502 when the push fails upstream", async () => {
    stubRepoResolve();
    stubCommit({
      ok: false,
      error: { code: GitHubApiErrorCodes.REQUEST_FAILED, message: "fixture" },
    });
    const app = await buildApp();

    const response = await upload(app, PNG);

    expect(response.status).toBe(502);
  });

  it("answers 404 when the fresh re-resolve is denied", async () => {
    stubFetchResponse(new Response(null, { status: 404 }));
    const app = await buildApp();

    const response = await upload(app, PNG);

    expect(response.status).toBe(404);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed pull number", async () => {
    const app = await buildApp();

    const response = await app.request("/zero/attachments", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: PNG,
    });

    expect(response.status).toBe(400);
  });
});
