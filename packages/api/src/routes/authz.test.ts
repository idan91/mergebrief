import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { GitHubApiErrorCode, fetchRepositoryById } from "github";
import type * as githubModule from "github";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isInstallationId,
  isReviewerId,
  WriteClassification,
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
import { repoAuthzLayer, type AuthzEnv } from "./authz";
import { createErrorHandler } from "../shared-errors/on-error";
import type * as sessionModule from "./auth/session";
import {
  AuthChannel,
  refreshSessionToken,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "./auth/session";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  fetchRepositoryById: vi.fn(),
}));

vi.mock("./auth/session", async (importOriginal) => ({
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
beforeAll(async () => {
  harness = await createPgliteHarness();
});
afterAll(async () => {
  await harness.close();
});

async function buildGateApp(): Promise<Hono<AuthzEnv>> {
  const sealed = await encryptToken(keyProvider, KEY_REF, "stale-token");
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  const session: ViewerPrincipal = {
    id: 1n,
    installationId: brand(10n, isInstallationId),
    sessionTokenHash: "hash-authz-unit",
    reviewerId: brand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId: brand(7n, isGrantRowId),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: sealed.value,
    keyRef: KEY_REF,
    scope: WriteClassification.EXTERNAL_WRITE,
    channel: AuthChannel.COOKIE,
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
    c.set("ctx", { installationId: brand(10n, isInstallationId) });
    c.set("session", session);
    await next();
  });
  app.use("/:repoId/*", repoAuthzLayer(deps));
  app.get("/:repoId/probe", (c) => c.json({ ok: true }));
  return app;
}

function denied(status: number): Result<never, githubModule.GitHubApiError> {
  const code =
    status === 401
      ? GitHubApiErrorCode.UNAUTHORIZED
      : GitHubApiErrorCode.FORBIDDEN;
  return { ok: false, error: { code, status, message: "denied" } };
}

beforeEach(() => {
  vi.mocked(fetchRepositoryById).mockReset();
  vi.mocked(refreshSessionToken).mockReset();
});

describe("repoAuthzLayer refresh disambiguation", () => {
  it("collapses a still-401 retry AFTER a successful refresh to the uniform 404", async () => {
    const app = await buildGateApp();
    vi.mocked(fetchRepositoryById).mockResolvedValue(denied(401));
    vi.mocked(refreshSessionToken).mockImplementation(async (_d, session) => ({
      ok: true,
      value: { session, accessToken: "rotated-token" },
    }));

    const res = await app.request("/9101/probe");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", code: "not-found" });
    // One cold check + exactly one post-refresh retry; one refresh spent.
    expect(fetchRepositoryById).toHaveBeenCalledTimes(2);
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
  });

  it("keeps the refresh-failed 401 posture when no retry was possible", async () => {
    const app = await buildGateApp();
    vi.mocked(fetchRepositoryById).mockResolvedValue(denied(401));
    vi.mocked(refreshSessionToken).mockResolvedValue({
      ok: false,
      error: { code: "refresh-failed", message: "refresh failed" },
    });

    const res = await app.request("/9101/probe");

    expect(res.status).toBe(401);
    expect(fetchRepositoryById).toHaveBeenCalledTimes(1);
  });
});
