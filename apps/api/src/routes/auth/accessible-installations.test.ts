import { randomBytes } from "node:crypto";
import { GitHubApiErrorCodes } from "github";
import { FakeFailures, makeFakeGitHub, type FakeGitHub } from "github/testing";
import type { Logger } from "logging";
import {
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
import { KEY_REF, createKeyProvider } from "../../../test/fixtures";
import { buildFakeAuthDeps } from "../../../test/reviewer-github";
import { seedSignIn } from "../../../test/sign-in";
import { AUTHZ_CACHE_TTL_MS } from "../../access/consts";
import {
  bindRequestGitHub,
  type RequestGitHub,
} from "../../access/reviewer-binding";
import { createAccessibleInstallationsResolver } from "./accessible-installations";
import { AuthChannels, type ViewerPrincipal } from "./session/types";

const keyProvider = createKeyProvider();

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
let fake: FakeGitHub;
beforeAll(async () => {
  harness = await createPgliteHarness();
});
afterAll(async () => {
  await harness.close();
});

async function stubPrincipal(): Promise<ViewerPrincipal> {
  const sealed = await encryptToken(keyProvider, KEY_REF, "ghu_TOKEN");
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
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

/** A fresh request over `principal`: its own credential and binding. */
function bindRequest(principal: ViewerPrincipal): RequestGitHub {
  const deps = {
    handle: harness.handle,
    auth: buildFakeAuthDeps(keyProvider, fake),
  };
  return bindRequestGitHub(deps, principal, log);
}

function countInstallationReads(): number {
  return fake.listCalls("listUserInstallations").length;
}

const ACME = {
  installationId: brand(10n, isInstallationId),
  accountLogin: "acme",
};

beforeEach(() => {
  fake = makeFakeGitHub();
  fake.addInstallation(ACME, new Map());
  vi.useRealTimers();
});

describe("the reachable installations resolver", () => {
  it("answers the second call inside the window without GitHub", async () => {
    const resolver = createAccessibleInstallationsResolver();
    const principal = await stubPrincipal();

    const first = await resolver.resolve(bindRequest(principal));
    const second = await resolver.resolve(bindRequest(principal));

    expect(first.ok && first.value.installations).toEqual([ACME]);
    expect(second.ok && second.value.installations).toEqual([ACME]);
    expect(countInstallationReads()).toBe(1);
  });

  it("asks GitHub again once the window has passed", async () => {
    vi.useFakeTimers();
    const resolver = createAccessibleInstallationsResolver();
    const principal = await stubPrincipal();

    await resolver.resolve(bindRequest(principal));
    vi.advanceTimersByTime(AUTHZ_CACHE_TTL_MS + 1);
    await resolver.resolve(bindRequest(principal));

    expect(countInstallationReads()).toBe(2);
  });

  it("never caches a failure", async () => {
    const resolver = createAccessibleInstallationsResolver();
    const principal = await stubPrincipal();
    const down = bindRequest(principal);
    const failing: RequestGitHub = {
      ...down,
      github: {
        ...down.github,
        async listUserInstallations() {
          const code = GitHubApiErrorCodes.REQUEST_FAILED;
          return { ok: false, error: { code, status: 502, message: "down" } };
        },
      },
    };

    const failed = await resolver.resolve(failing);
    const recovered = await resolver.resolve(bindRequest(principal));

    expect(!failed.ok && failed.error.kind).toBe("upstream-failed");
    expect(recovered.ok).toBe(true);
    expect(countInstallationReads()).toBe(1);
  });

  it("reads a still-refused token as auth-dead", async () => {
    fake.failOn("listUserInstallations", FakeFailures.UNAUTHORIZED);
    const resolver = createAccessibleInstallationsResolver();

    const resolved = await resolver.resolve(bindRequest(await stubPrincipal()));

    expect(!resolved.ok && resolved.error.kind).toBe("auth-dead");
  });

  it("burns the session of a token that will not decrypt", async () => {
    const { cookieHash } = await seedSignIn(harness.handle, keyProvider);
    const principal = await stubPrincipal();
    const unreadable = {
      ...principal,
      sessionTokenHash: cookieHash,
      ghTokenCiphertext: "sealed",
    };
    const resolver = createAccessibleInstallationsResolver();

    const resolved = await resolver.resolve(bindRequest(unreadable));

    expect(!resolved.ok && resolved.error.kind).toBe("auth-dead");
    expect(countInstallationReads()).toBe(0);
    const sessions = await harness.raw(
      "select id from auth_session where session_token_hash = $1",
      [cookieHash],
    );
    expect(sessions).toEqual([]);
  });

  it("shares one in-flight walk between concurrent callers", async () => {
    const resolver = createAccessibleInstallationsResolver();
    const principal = await stubPrincipal();

    await Promise.all([
      resolver.resolve(bindRequest(principal)),
      resolver.resolve(bindRequest(principal)),
      resolver.resolve(bindRequest(principal)),
    ]);

    expect(countInstallationReads()).toBe(1);
  });

  it("keeps one credential's set away from another's", async () => {
    const resolver = createAccessibleInstallationsResolver();

    await resolver.resolve(bindRequest(await stubPrincipal()));
    await resolver.resolve(bindRequest(await stubPrincipal()));

    expect(countInstallationReads()).toBe(2);
  });
});
