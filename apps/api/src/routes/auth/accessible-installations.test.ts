import { randomBytes } from "node:crypto";
import type * as githubModule from "github";
import { GitHubApiErrorCodes, listUserInstallations } from "github";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isInstallationId,
  isReviewerId,
  WriteClassifications,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AUTHZ_CACHE_TTL_MS } from "../authz";
import { createAccessibleInstallationsResolver } from "./accessible-installations";
import {
  AuthChannels,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "./session/types";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  listUserInstallations: vi.fn(),
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
  if (!guard(value)) throw new Error("unbrandable fixture value");
  return value;
}

let harness: PgliteHarness;
beforeAll(async () => {
  harness = await createPgliteHarness();
});
afterAll(async () => {
  await harness.close();
});

async function stubPrincipal(): Promise<ViewerPrincipal> {
  const sealed = await encryptToken(keyProvider, KEY_REF, "ghu_TOKEN");
  if (!sealed.ok) throw new Error("fixture seal failed");
  return {
    id: 1n,
    sessionTokenHash: `hash-installations-${randomBytes(4).toString("hex")}`,
    reviewerId: brand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId: brand(7n, isGrantRowId),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: sealed.value,
    keyRef: KEY_REF,
    scope: WriteClassifications.EXTERNAL_WRITE,
    channel: AuthChannels.COOKIE,
  };
}

function stubDeps(): AuthRouteDeps {
  return {
    handle: harness.handle,
    auth: {
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      keyProvider,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: "https://example.test",
    },
  };
}

const ACME = {
  installationId: brand(10n, isInstallationId),
  accountLogin: "acme",
};

beforeEach(() => {
  vi.mocked(listUserInstallations).mockReset();
  vi.useRealTimers();
});

describe("the reachable installations resolver", () => {
  it("answers the second call inside the window without GitHub", async () => {
    vi.mocked(listUserInstallations).mockResolvedValue({
      ok: true,
      value: [ACME],
    });
    const resolver = createAccessibleInstallationsResolver(stubDeps());
    const principal = await stubPrincipal();

    const first = await resolver.resolve(principal, log);
    const second = await resolver.resolve(principal, log);

    expect(first.ok && first.value.installations).toEqual([ACME]);
    expect(second.ok && second.value.installations).toEqual([ACME]);
    expect(listUserInstallations).toHaveBeenCalledTimes(1);
  });

  it("asks GitHub again once the window has passed", async () => {
    vi.useFakeTimers();
    vi.mocked(listUserInstallations).mockResolvedValue({
      ok: true,
      value: [ACME],
    });
    const resolver = createAccessibleInstallationsResolver(stubDeps());
    const principal = await stubPrincipal();

    await resolver.resolve(principal, log);
    vi.advanceTimersByTime(AUTHZ_CACHE_TTL_MS + 1);
    await resolver.resolve(principal, log);

    expect(listUserInstallations).toHaveBeenCalledTimes(2);
  });

  it("never caches a failure", async () => {
    vi.mocked(listUserInstallations)
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: GitHubApiErrorCodes.REQUEST_FAILED,
          status: 502,
          message: "down",
        },
      })
      .mockResolvedValueOnce({ ok: true, value: [ACME] });
    const resolver = createAccessibleInstallationsResolver(stubDeps());
    const principal = await stubPrincipal();

    const failed = await resolver.resolve(principal, log);
    const recovered = await resolver.resolve(principal, log);

    expect(failed.ok).toBe(false);
    expect(recovered.ok).toBe(true);
    expect(listUserInstallations).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight walk between concurrent callers", async () => {
    vi.mocked(listUserInstallations).mockResolvedValue({
      ok: true,
      value: [ACME],
    });
    const resolver = createAccessibleInstallationsResolver(stubDeps());
    const principal = await stubPrincipal();

    await Promise.all([
      resolver.resolve(principal, log),
      resolver.resolve(principal, log),
      resolver.resolve(principal, log),
    ]);

    expect(listUserInstallations).toHaveBeenCalledTimes(1);
  });

  it("keeps one credential's set away from another's", async () => {
    vi.mocked(listUserInstallations).mockResolvedValue({
      ok: true,
      value: [ACME],
    });
    const resolver = createAccessibleInstallationsResolver(stubDeps());

    await resolver.resolve(await stubPrincipal(), log);
    await resolver.resolve(await stubPrincipal(), log);

    expect(listUserInstallations).toHaveBeenCalledTimes(2);
  });
});
