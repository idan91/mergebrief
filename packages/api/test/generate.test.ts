// POST /api/generate route tests (BRIEF-97): session gate, URL validation,
// dedupe-by-head, single-flight, refresh-once, and the sanitized denial
// posture — all against a fake UrlBriefEngine (the real engine is the web
// composition root's concern). Harness mirrors installations.test.ts:
// app.request() over PGlite, GitHub's token endpoint stubbed at global fetch.
import { randomBytes, createHash } from "node:crypto";
import {
  encryptToken,
  envKeyProvider,
  forTenant,
  grantAuth,
  isInstallationId,
  isReviewerId,
  type AppDatabase,
  type KeyProvider,
  type ReviewerId,
  type TenantContext,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  createApp,
  UrlBriefErrorKind,
  type ApiApp,
  type AppDeps,
  type AuthDeps,
  type UrlBriefEngine,
} from "../src/index";
import { testLogger } from "./logging";

const SECRET = "test-webhook-secret";
const KEY_REF = "SESSION_KEY_V1";
const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_PLAINTEXT";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_PLAINTEXT";
const ROTATED_ACCESS = "ghu_ROTATED_ACCESS_PLAINTEXT";
const ROTATED_REFRESH = "ghr_ROTATED_REFRESH_PLAINTEXT";
const PR_URL = "https://github.com/o/r/pull/7";
const HEAD = "a".repeat(40);

function brand<T extends bigint>(
  guard: (v: bigint) => v is T,
  value: number,
): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) throw new Error("bad branded id");
  return asBigInt;
}

const CTX: TenantContext = { installationId: brand(isInstallationId, 987654) };
const REVIEWER: ReviewerId = brand(isReviewerId, 555);

function keyProvider(): KeyProvider {
  return envKeyProvider({ [KEY_REF]: randomBytes(32).toString("base64") });
}

function authDeps(kp: KeyProvider): AuthDeps {
  return {
    oauthClientId: "Iv1.test-client-id",
    oauthClientSecret: "test-client-secret",
    keyProvider: kp,
    sessionKeyRef: KEY_REF,
    publicBaseUrl: "https://app.example.test",
    cookieSecure: true,
  };
}

async function seedSession(
  handle: AppDatabase,
  kp: KeyProvider,
): Promise<string> {
  const cookie = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(cookie).digest("hex");
  const sealedAccess = await encryptToken(kp, KEY_REF, ACCESS_TOKEN);
  const sealedRefresh = await encryptToken(kp, KEY_REF, REFRESH_TOKEN);
  if (!sealedAccess.ok || !sealedRefresh.ok)
    throw new Error("seed encrypt failed");
  const grant = await grantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  await forTenant(handle, CTX).sessions.create({
    sessionTokenHash: hash,
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    grantId: grant.id,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return cookie;
}

const unusedConversationPort = {
  fetchPullRequestConversation: async () => {
    throw new Error("conversation port must not be called in this suite");
  },
  listRepoCollaborators: async () => {
    throw new Error("collaborators port must not be called in this suite");
  },
};

interface EngineMocks {
  fetchHeadSha: Mock<UrlBriefEngine["fetchHeadSha"]>;
  lookupIndex: Mock<UrlBriefEngine["lookupIndex"]>;
  generate: Mock<UrlBriefEngine["generate"]>;
}

/** A controllable engine; every method observable and overridable per test. */
function fakeEngine(
  overrides: Partial<EngineMocks> = {},
): UrlBriefEngine & EngineMocks {
  return {
    fetchHeadSha: vi.fn(async () => ({ ok: true as const, value: HEAD })),
    lookupIndex: vi.fn(async () => null),
    generate: vi.fn(async () => ({
      ok: true as const,
      value: { repo: "o/r", number: 7, index: 1, head: HEAD },
    })),
    ...overrides,
  };
}

function stubTokenEndpoint(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/login/oauth/access_token")) {
        return new Response(
          JSON.stringify({
            access_token: ROTATED_ACCESS,
            refresh_token: ROTATED_REFRESH,
            expires_in: 28_800,
            refresh_token_expires_in: 15_897_600,
            token_type: "bearer",
            scope: "",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              date: new Date().toUTCString(),
            },
          },
        );
      }
      throw new Error(`unexpected fetch in generate suite: ${url}`);
    }),
  );
}

async function post(
  app: ApiApp,
  cookie: string | undefined,
  url: string,
): Promise<Response> {
  return app.request("/api/generate", {
    method: "POST",
    body: JSON.stringify({ url }),
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { Cookie: `rs_session=${cookie}` }),
    },
  });
}

describe("POST /api/generate", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = keyProvider();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  function buildApp(engine: UrlBriefEngine | undefined): ApiApp {
    const deps: AppDeps = {
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: authDeps(kp),
      github: unusedConversationPort,
      ...(engine === undefined ? {} : { urlBriefEngine: engine }),
    };
    return createApp(deps);
  }

  it("401s without a session, engine untouched", async () => {
    const engine = fakeEngine();
    const res = await post(buildApp(engine), undefined, PR_URL);
    expect(res.status).toBe(401);
    expect(engine.fetchHeadSha).not.toHaveBeenCalled();
  });

  it("503s with curated copy when no engine is wired", async () => {
    const app = buildApp(undefined);
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, PR_URL);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "url generation unavailable" });
  });

  it("400s a non-PR URL without reaching the engine", async () => {
    const engine = fakeEngine();
    const app = buildApp(engine);
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, "https://example.com/not-github");
    expect(res.status).toBe(400);
    expect(engine.fetchHeadSha).not.toHaveBeenCalled();
  });

  it("generates and returns the briefId, engine receiving the decrypted viewer token", async () => {
    const engine = fakeEngine();
    const app = buildApp(engine);
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, PR_URL);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ briefId: `o-r-7_1_${"a".repeat(8)}` });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(engine.fetchHeadSha).toHaveBeenCalledWith(
      { owner: "o", repo: "r", number: 7 },
      ACCESS_TOKEN,
    );
    expect(engine.generate).toHaveBeenCalledWith(PR_URL, ACCESS_TOKEN);
  });

  it("dedupes by head: an existing index answers without generating", async () => {
    const engine = fakeEngine({ lookupIndex: vi.fn(async () => 2) });
    const app = buildApp(engine);
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, PR_URL);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ briefId: `o-r-7_2_${"a".repeat(8)}` });
    expect(engine.generate).not.toHaveBeenCalled();
  });

  it("collapses a viewer-token NOT_FOUND to the uniform 404 posture", async () => {
    const engine = fakeEngine({
      fetchHeadSha: vi.fn(async () => ({
        ok: false as const,
        error: { kind: UrlBriefErrorKind.NOT_FOUND, message: "x" },
      })),
    });
    const app = buildApp(engine);
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, PR_URL);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("surfaces a config failure as 503 with the env-safe message", async () => {
    const engine = fakeEngine({
      generate: vi.fn(async () => ({
        ok: false as const,
        error: {
          kind: UrlBriefErrorKind.CONFIG,
          message: "ANTHROPIC_API_KEY is required",
        },
      })),
    });
    const app = buildApp(engine);
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, PR_URL);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "ANTHROPIC_API_KEY is required",
    });
  });

  it("clamps a contract-violating config message (URL scrubbed, first line only)", async () => {
    const engine = fakeEngine({
      generate: vi.fn(async () => ({
        ok: false as const,
        error: {
          kind: UrlBriefErrorKind.CONFIG,
          message: "bad DSN postgres://user:pass@host/db\nstack line",
        },
      })),
    });
    const app = buildApp(engine);
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, PR_URL);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("pass");
    expect(JSON.stringify(body)).not.toContain("stack line");
    expect(body).toEqual({ error: "bad DSN [redacted-url]" });
  });

  it("spends the refresh once on an unauthorized head fetch, then retries with the rotated token", async () => {
    stubTokenEndpoint();
    const fetchHeadSha = vi
      .fn<UrlBriefEngine["fetchHeadSha"]>()
      .mockResolvedValueOnce({
        ok: false as const,
        error: { kind: UrlBriefErrorKind.UNAUTHORIZED, message: "x" },
      })
      .mockResolvedValueOnce({ ok: true as const, value: HEAD });
    const engine = fakeEngine({ fetchHeadSha });
    const app = buildApp(engine);
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, PR_URL);
    expect(res.status).toBe(200);
    expect(fetchHeadSha).toHaveBeenCalledTimes(2);
    expect(fetchHeadSha).toHaveBeenLastCalledWith(
      { owner: "o", repo: "r", number: 7 },
      ROTATED_ACCESS,
    );
  });

  it("spends the refresh on an unauthorized generate stage and retries with the rotated token", async () => {
    stubTokenEndpoint();
    const generate = vi
      .fn<UrlBriefEngine["generate"]>()
      .mockResolvedValueOnce({
        ok: false as const,
        error: { kind: UrlBriefErrorKind.UNAUTHORIZED, message: "x" },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: { repo: "o/r", number: 7, index: 1, head: HEAD },
      });
    const engine = fakeEngine({ generate });
    const app = buildApp(engine);
    const cookie = await seedSession(harness.handle, kp);
    const res = await post(app, cookie, PR_URL);
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenLastCalledWith(PR_URL, ROTATED_ACCESS);
  });

  it("single-flights concurrent generations for the same PR-head", async () => {
    let release: (() => void) | undefined;
    const generate = vi.fn(
      () =>
        new Promise<{
          ok: true;
          value: { repo: string; number: number; index: number; head: string };
        }>((resolve) => {
          release = () =>
            resolve({
              ok: true,
              value: { repo: "o/r", number: 7, index: 1, head: HEAD },
            });
        }),
    );
    const engine = fakeEngine({ generate });
    const app = buildApp(engine);
    const cookie = await seedSession(harness.handle, kp);

    const [first, second] = [
      post(app, cookie, PR_URL),
      post(app, cookie, PR_URL),
    ];
    // Both requests must be past dedupe and inside the flight before release.
    await vi.waitFor(() => {
      expect(engine.lookupIndex).toHaveBeenCalledTimes(2);
    });
    release?.();
    const [resA, resB] = await Promise.all([first, second]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(await resA.json()).toEqual(await resB.json());
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
