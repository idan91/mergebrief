import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { GitHubApiErrorCode, fetchCompareDiff } from "github";
import type * as githubModule from "github";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isInstallationId,
  isRepoId,
  isReviewerId,
  parseTenantContext,
  PrStates,
  createTenantRepository,
  WriteClassifications,
  type RepoId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Result } from "types";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createErrorHandler } from "../../../../shared-errors/on-error";
import type * as sessionModule from "../../../auth/session";
import {
  AuthChannels,
  refreshSessionToken,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "../../../auth/session";
import type { AuthzEnv } from "../../../authz";
import { createTtlCache } from "../../../ttl-cache";
import createReadsHandlers from "./handler";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  fetchCompareDiff: vi.fn(),
}));

vi.mock("../../../auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof sessionModule>()),
  refreshSessionToken: vi.fn(),
}));

const KEY_REF = "SESSION_KEY_TEST";
const keyProvider = createEnvKeyProvider({
  [KEY_REF]: randomBytes(32).toString("base64"),
});

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

let harness: PgliteHarness;
let repoId: RepoId;
const PR_NUMBER = 7;
const INSTALLATION_ID = 606n;

beforeAll(async () => {
  harness = await createPgliteHarness();
  repoId = brand(7654n, isRepoId);
  const installationId = brand(INSTALLATION_ID, isInstallationId);
  await createTenantRepository(
    harness.handle,
    parseTenantContext({
      installationId,
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

async function buildApp(ciphertextOverride?: string): Promise<Hono<AuthzEnv>> {
  const sealed = await encryptToken(keyProvider, KEY_REF, "stale-token");
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  const session: ViewerPrincipal = {
    id: 1n,
    installationId: brand(INSTALLATION_ID, isInstallationId),
    sessionTokenHash: `hash-${randomBytes(4).toString("hex")}`,
    reviewerId: brand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId: brand(7n, isGrantRowId),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: ciphertextOverride ?? sealed.value,
    keyRef: KEY_REF,
    scope: WriteClassifications.EXTERNAL_WRITE,
    channel: AuthChannels.COOKIE,
  };
  const deps: AuthRouteDeps = {
    handle: harness.handle,
    auth: {
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      keyProvider,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: "https://example.test",
      cookieSecure: false,
    },
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
    "/:prNumber/diff",
    createReadsHandlers(deps, createTtlCache<string>(10)).readDiff,
  );
  return app;
}

function denied(status: number): Result<string, githubModule.GitHubApiError> {
  const code =
    status === 401
      ? GitHubApiErrorCode.UNAUTHORIZED
      : status === 404
        ? GitHubApiErrorCode.NOT_FOUND
        : GitHubApiErrorCode.REQUEST_FAILED;
  return { ok: false, error: { code, status, message: "denied" } };
}

const DIFF_PATH = `/${PR_NUMBER}/diff?base=aaa&head=bbb`;

beforeEach(() => {
  vi.mocked(fetchCompareDiff).mockReset();
  vi.mocked(refreshSessionToken).mockReset();
});

describe("diff proxy posture split", () => {
  it("401 with a FAILED refresh stays a re-login 401", async () => {
    vi.mocked(fetchCompareDiff).mockResolvedValue(denied(401));
    vi.mocked(refreshSessionToken).mockResolvedValue({
      ok: false,
      error: { code: "refresh-failed", message: "refresh failed" },
    });
    const res = await (await buildApp()).request(DIFF_PATH);
    expect(res.status).toBe(401);
    expect(fetchCompareDiff).toHaveBeenCalledTimes(1);
  });

  it("401 after a SUCCESSFUL refresh and retry is an upstream 502", async () => {
    vi.mocked(fetchCompareDiff).mockResolvedValue(denied(401));
    vi.mocked(refreshSessionToken).mockImplementation(async (_d, session) => ({
      ok: true,
      value: { session, accessToken: "rotated-token" },
    }));
    const res = await (await buildApp()).request(DIFF_PATH);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-unavailable" });
    expect(fetchCompareDiff).toHaveBeenCalledTimes(2);
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
  });

  it("compare NOT_FOUND keeps the 404 collapse", async () => {
    vi.mocked(fetchCompareDiff).mockResolvedValue(denied(404));
    const res = await (await buildApp()).request(DIFF_PATH);
    expect(res.status).toBe(404);
  });

  it("406 surfaces as the permanent 413 diff-too-large", async () => {
    vi.mocked(fetchCompareDiff).mockResolvedValue(denied(406));
    const res = await (await buildApp()).request(DIFF_PATH);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "diff-too-large" });
  });

  it("an unreadable stored token is a re-login 401 with no GitHub call", async () => {
    const res = await (await buildApp("not-a-ciphertext")).request(DIFF_PATH);
    expect(res.status).toBe(401);
    expect(fetchCompareDiff).not.toHaveBeenCalled();
  });
});
