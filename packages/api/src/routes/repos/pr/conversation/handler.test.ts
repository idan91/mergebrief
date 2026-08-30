import { Hono } from "hono";
import { GitHubApiErrorCode, type GitHubApiError } from "github";
import type * as GitHubModule from "github";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  parseTenantContext,
  PrStates,
  WriteClassifications,
  isGrantRowId,
  isReviewerId,
  type RepoId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Result } from "types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../../../../shared-errors/on-error";
import { AuthChannels, type ViewerPrincipal } from "../../../auth/session";
import type { AuthzEnv } from "../../../authz";
import type { InstallationGitHubPort } from "../../../github-port";
import { createTtlCache } from "../../../ttl-cache";
import createConversationHandlers from "./handler";

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

function brand<T extends bigint>(
  value: bigint,
  guard: (v: bigint) => v is T,
): T {
  if (!guard(value)) {
    throw new Error("unbrandable fixture value");
  }
  return value;
}

const EMPTY_CONVERSATION = {
  threads: [],
  reviews: [],
  prComments: [],
  hasMoreThreads: false,
  hasMoreReviews: false,
  hasMorePrComments: false,
};

let harness: PgliteHarness;
let repoId: RepoId;
const PR_NUMBER = 7;
const INSTALLATION_ID = 707n;

beforeAll(async () => {
  harness = await createPgliteHarness();
  repoId = brand(8765n, isRepoId);
  await createTenantRepository(
    harness.handle,
    parseTenantContext({
      installationId: brand(INSTALLATION_ID, isInstallationId),
    }),
  ).pullRequests.upsert({
    repoId,
    prNumber: PR_NUMBER,
    repoSlug: "acme/app",
    title: "Add thing",
    state: PrStates.OPEN,
  });
});
afterAll(async () => {
  await harness.close();
});

function buildApp(
  fetch: InstallationGitHubPort["fetchPullRequestConversation"],
): Hono<AuthzEnv> {
  const session: ViewerPrincipal = {
    id: 1n,
    installationId: brand(INSTALLATION_ID, isInstallationId),
    sessionTokenHash: "hash-conversation-unit",
    reviewerId: brand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId: brand(7n, isGrantRowId),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: "unused",
    keyRef: "unused",
    scope: WriteClassifications.EXTERNAL_WRITE,
    channel: AuthChannels.COOKIE,
  };
  const github: InstallationGitHubPort = {
    listRepoCollaborators: vi.fn(async () => {
      throw new Error("not exercised");
    }),
    fetchPullRequestConversation: fetch,
  };
  const app = new Hono<AuthzEnv>();
  app.onError(createErrorHandler<AuthzEnv>(log));
  app.use(async (c, next) => {
    c.set("logger", log);
    c.set("ctx", { installationId: brand(INSTALLATION_ID, isInstallationId) });
    c.set("session", session);
    c.set("repoId", repoId);
    c.set("repoFullName", "acme/app");
    c.set("viewerCanPush", true);
    await next();
  });
  app.get(
    "/:prNumber/conversation",
    createConversationHandlers(
      {
        handle: harness.handle,
        auth: {
          oauthClientId: "Iv1.test-client-id",
          oauthClientSecret: "test-client-secret",
          keyProvider: createEnvKeyProvider({}),
          sessionKeyRef: "SESSION_KEY_V1",
          publicBaseUrl: "https://example.test",
          cookieSecure: true,
        },
      },
      github,
      createTtlCache<string>(10),
    ).readConversation,
  );
  return app;
}

function okFetch(): InstallationGitHubPort["fetchPullRequestConversation"] {
  return vi.fn(async () => ({ ok: true as const, value: EMPTY_CONVERSATION }));
}

function deniedFetch(
  code: GitHubApiError["code"],
): InstallationGitHubPort["fetchPullRequestConversation"] {
  return vi.fn(
    async (): Promise<Result<never, GitHubApiError>> => ({
      ok: false,
      error: { code, status: 500, message: "denied" },
    }),
  );
}

describe("conversation handler wire posture", () => {
  it("serves the serialized body with json content-type and no-store, cached on repeat", async () => {
    const fetch = okFetch();
    const app = buildApp(fetch);
    const first = await app.request(`/${PR_NUMBER}/conversation`);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("application/json");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual(EMPTY_CONVERSATION);
    const second = await app.request(`/${PR_NUMBER}/conversation`);
    expect(second.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed prNumber with the deterministic 400", async () => {
    const res = await buildApp(okFetch()).request("/nope/conversation");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid-request" });
  });

  it("answers 404 for an unknown PR row", async () => {
    const res = await buildApp(okFetch()).request("/999/conversation");
    expect(res.status).toBe(404);
  });

  it("collapses a GitHub NOT_FOUND to 404 and everything else to 502", async () => {
    const notFound = await buildApp(
      deniedFetch(GitHubApiErrorCode.NOT_FOUND),
    ).request(`/${PR_NUMBER}/conversation`);
    expect(notFound.status).toBe(404);
    const upstream = await buildApp(
      deniedFetch(GitHubApiErrorCode.REQUEST_FAILED),
    ).request(`/${PR_NUMBER}/conversation`);
    expect(upstream.status).toBe(502);
    expect(await upstream.json()).toMatchObject({ code: "github-unavailable" });
  });
});

describe("readConversation — installation-path 401 stays an upstream error", () => {
  it("an App-credential 401 is a 502, never a sign-in prompt", async () => {
    const app = buildApp(
      vi.fn(async () => ({
        ok: false as const,
        error: {
          code: GitHubApiErrorCode.UNAUTHORIZED,
          message: "bad app credentials",
        },
      })),
    );
    const res = await app.request(`/${PR_NUMBER}/conversation`);
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// Owner-world branch: the conversation reads with the VIEWER's token.
// ---------------------------------------------------------------------------
vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof GitHubModule>()),
  createUserOctokit: vi.fn(),
  fetchPullRequestConversation: vi.fn(),
}));

describe("readConversation — owner world (viewer token)", () => {
  async function buildOwnerApp(input: {
    plaintext: string | undefined;
    fetchResult: Result<typeof EMPTY_CONVERSATION, GitHubApiError>;
  }): Promise<{
    app: Hono<AuthzEnv>;
    port: ReturnType<typeof vi.fn>;
    viewerFetch: ReturnType<typeof vi.fn>;
    tokensSeen: string[];
  }> {
    const { createUserOctokit, fetchPullRequestConversation, encryptToken } =
      await import("github").then(async (github) => ({
        createUserOctokit: vi.mocked(github.createUserOctokit),
        fetchPullRequestConversation: vi.mocked(
          github.fetchPullRequestConversation,
        ),
        encryptToken: (await import("persistence")).encryptToken,
      }));
    const ownerId = brand(555n, isReviewerId);
    const ownerHarness = await createPgliteHarness();
    const ownerRepoId = brand(9911n, isRepoId);
    const pr = await createTenantRepository(ownerHarness.handle, {
      ownerUserId: ownerId,
    }).pullRequests.upsert({
      repoId: ownerRepoId,
      prNumber: PR_NUMBER,
      repoSlug: "acme/own",
      state: PrStates.OPEN,
    });
    void pr;

    const keyRef = "SESSION_KEY_V1";
    const kp = createEnvKeyProvider({
      [keyRef]: Buffer.alloc(32, 7).toString("base64"),
    });
    let ciphertext = "undecryptable";
    if (input.plaintext !== undefined) {
      const sealed = await encryptToken(kp, keyRef, input.plaintext);
      if (!sealed.ok) throw new Error("seal failed");
      ciphertext = sealed.value;
    }
    const session: ViewerPrincipal = {
      id: 1n,
      installationId: null,
      sessionTokenHash: "hash-owner-conversation",
      reviewerId: ownerId,
      reviewerLogin: "octocat",
      grantId: brand(7n, isGrantRowId),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      ghTokenCiphertext: ciphertext,
      keyRef,
      scope: WriteClassifications.EXTERNAL_WRITE,
      channel: AuthChannels.COOKIE,
    };

    const tokensSeen: string[] = [];
    createUserOctokit.mockReset();
    fetchPullRequestConversation.mockReset();
    createUserOctokit.mockImplementation((token: string) => {
      tokensSeen.push(token);
      return {} as ReturnType<typeof createUserOctokit>;
    });
    fetchPullRequestConversation.mockResolvedValue(input.fetchResult);

    const installationFetch = vi.fn(async () => {
      throw new Error("installation port must not serve an owner row");
    });
    const app = new Hono<AuthzEnv>();
    app.onError(createErrorHandler<AuthzEnv>(log));
    app.use(async (c, next) => {
      c.set("logger", log);
      c.set("ctx", { ownerUserId: ownerId });
      c.set("session", session);
      c.set("repoId", ownerRepoId);
      c.set("repoFullName", "acme/own");
      c.set("viewerCanPush", true);
      await next();
    });
    app.get(
      "/:prNumber/conversation",
      createConversationHandlers(
        {
          handle: ownerHarness.handle,
          auth: {
            oauthClientId: "Iv1.test-client-id",
            oauthClientSecret: "test-client-secret",
            keyProvider: kp,
            sessionKeyRef: keyRef,
            publicBaseUrl: "https://example.test",
            cookieSecure: true,
          },
        },
        {
          listRepoCollaborators: vi.fn(async () => {
            throw new Error("not exercised");
          }),
          fetchPullRequestConversation: installationFetch,
        },
        createTtlCache<string>(10),
      ).readConversation,
    );
    return {
      app,
      port: installationFetch,
      viewerFetch: fetchPullRequestConversation,
      tokensSeen,
    };
  }

  it("fetches with the viewer's decrypted token, never the installation port", async () => {
    const built = await buildOwnerApp({
      plaintext: "ghu_viewer_token",
      fetchResult: { ok: true, value: EMPTY_CONVERSATION },
    });
    const res = await built.app.request(`/${PR_NUMBER}/conversation`);
    expect(res.status).toBe(200);
    expect(built.port).not.toHaveBeenCalled();
    expect(built.tokensSeen).toEqual(["ghu_viewer_token"]);
  });

  it("an unreadable stored token is re-auth territory (401), never a 404", async () => {
    const built = await buildOwnerApp({
      plaintext: undefined,
      fetchResult: { ok: true, value: EMPTY_CONVERSATION },
    });
    const res = await built.app.request(`/${PR_NUMBER}/conversation`);
    expect(res.status).toBe(401);
    expect(built.viewerFetch).not.toHaveBeenCalled();
  });

  it("an upstream 401 prompts sign-in instead of a retry-looking 502", async () => {
    const built = await buildOwnerApp({
      plaintext: "ghu_viewer_token",
      fetchResult: {
        ok: false,
        error: {
          code: GitHubApiErrorCode.UNAUTHORIZED,
          message: "bad credentials",
        },
      },
    });
    const res = await built.app.request(`/${PR_NUMBER}/conversation`);
    expect(res.status).toBe(401);
  });
});
