import { randomBytes } from "node:crypto";
import { parsePrUrl } from "brief-core";
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
import { createReviewerGitHubClient } from "../auth/reviewer-github-client";
import type * as sessionModule from "../auth/session";
import {
  refreshSessionToken,
  AuthChannel,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "../auth/session";
import generateController from "./controller";
import { createSingleFlight } from "./utils";
import {
  UrlBriefErrorKind,
  type GeneratedBriefRef,
  type UrlBriefEngine,
  type UrlBriefError,
} from "./types";

vi.mock("../auth/session", async (importOriginal) => ({
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

const URL = "https://github.com/acme/app/pull/7";
const LOCATOR = parsePrUrl(URL);
const REF: GeneratedBriefRef = {
  repo: "acme/app",
  number: 7,
  index: 0,
  head: "headsha",
};

async function buildClient() {
  const sealed = await encryptToken(keyProvider, KEY_REF, "viewer-token");
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  const session: ViewerPrincipal = {
    id: 1n,
    installationId: brand(10n, isInstallationId),
    sessionTokenHash: "hash-generate-unit",
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
  return createReviewerGitHubClient(deps, session, log);
}

function okEngine(overrides: Partial<UrlBriefEngine> = {}): UrlBriefEngine {
  return {
    fetchHeadSha: vi.fn(async () => ({ ok: true as const, value: "headsha" })),
    lookupIndex: vi.fn(async () => null),
    generate: vi.fn(async () => ({ ok: true as const, value: REF })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(refreshSessionToken).mockReset();
});

describe("generateController.generateBrief", () => {
  it("generates when no brief exists for the head and returns its briefId", async () => {
    const engine = okEngine();
    const result = await generateController.generateBrief(
      {
        engine,
        github: await buildClient(),
        singleFlight: createSingleFlight(),
      },
      { url: URL, locator: LOCATOR },
    );
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      value: { briefId: expect.stringContaining("headsha") },
    });
    expect(engine.fetchHeadSha).toHaveBeenCalledWith(LOCATOR, "viewer-token");
    expect(engine.generate).toHaveBeenCalledWith(URL, "viewer-token");
  });

  it("dedupes by head: an existing index short-circuits generation", async () => {
    const engine = okEngine({ lookupIndex: vi.fn(async () => 3) });
    const result = await generateController.generateBrief(
      {
        engine,
        github: await buildClient(),
        singleFlight: createSingleFlight(),
      },
      { url: URL, locator: LOCATOR },
    );
    expect(result.ok).toBe(true);
    expect(engine.generate).not.toHaveBeenCalled();
  });

  it("spends ONE refresh across head fetch and generation", async () => {
    vi.mocked(refreshSessionToken).mockImplementation(async (_d, session) => ({
      ok: true,
      value: { session, accessToken: "rotated" },
    }));
    const unauthorized: Result<string, UrlBriefError> = {
      ok: false,
      error: { kind: UrlBriefErrorKind.UNAUTHORIZED, message: "expired" },
    };
    const engine = okEngine({
      fetchHeadSha: vi.fn(async (_l, token: string) =>
        token === "rotated"
          ? { ok: true as const, value: "headsha" }
          : unauthorized,
      ),
    });
    const result = await generateController.generateBrief(
      {
        engine,
        github: await buildClient(),
        singleFlight: createSingleFlight(),
      },
      { url: URL, locator: LOCATOR },
    );
    expect(result.ok).toBe(true);
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
    expect(engine.fetchHeadSha).toHaveBeenCalledTimes(2);
    // The generation stage rides the already-rotated token, no second spend.
    expect(engine.generate).toHaveBeenCalledWith(URL, "rotated");
  });

  it("wraps an engine failure whole for the handler to judge", async () => {
    const failure: UrlBriefError = {
      kind: UrlBriefErrorKind.NOT_FOUND,
      message: "no such pr",
    };
    const engine = okEngine({
      fetchHeadSha: vi.fn(async () => ({ ok: false as const, error: failure })),
    });
    const result = await generateController.generateBrief(
      {
        engine,
        github: await buildClient(),
        singleFlight: createSingleFlight(),
      },
      { url: URL, locator: LOCATOR },
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "engine-failed", error: failure },
    });
  });

  it("reports an unreadable stored token as its own failure kind", async () => {
    const client = await buildClient();
    const engine = okEngine();
    const session = client.session();
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
    const unreadable = createReviewerGitHubClient(
      deps,
      { ...session, ghTokenCiphertext: "not-a-ciphertext" },
      log,
    );
    const result = await generateController.generateBrief(
      { engine, github: unreadable, singleFlight: createSingleFlight() },
      { url: URL, locator: LOCATOR },
    );
    expect(result).toEqual({ ok: false, error: { kind: "token-unreadable" } });
    expect(engine.fetchHeadSha).not.toHaveBeenCalled();
  });
});
