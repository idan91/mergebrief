import { Hono } from "hono";
import { GitHubApiErrorCode, type GitHubApiError } from "github";
import type { Logger } from "logging";
import {
  createTenantRepository,
  isInstallationId,
  isRepoId,
  parseTenantContext,
  PrState,
  WriteClassification,
  isGrantRowId,
  isReviewerId,
  type RepoId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Result } from "types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../../../../shared-errors/on-error";
import { AuthChannel, type ViewerPrincipal } from "../../../auth/session";
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
    state: PrState.OPEN,
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
    scope: WriteClassification.EXTERNAL_WRITE,
    channel: AuthChannel.COOKIE,
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
    c.set("ctx", { installationId: session.installationId });
    c.set("session", session);
    c.set("repoId", repoId);
    c.set("repoFullName", "acme/app");
    c.set("viewerCanPush", true);
    await next();
  });
  app.get(
    "/:prNumber/conversation",
    createConversationHandlers(
      harness.handle,
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
