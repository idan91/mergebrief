import { randomBytes } from "node:crypto";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isReviewerId,
  WriteClassifications,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Logger } from "logging";
import type { Result } from "types/utils";
import { GitHubApiErrorCodes, type GitHubApiError } from "github";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createReviewerGitHubClient } from "./reviewer-github-client";
import type * as refreshModule from "./session/logic/refresh";
import {
  AuthChannels,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "./session/types";
import { refreshSessionToken } from "./session/logic/refresh";

vi.mock("./session/logic/refresh", async (importOriginal) => ({
  ...(await importOriginal<typeof refreshModule>()),
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

async function seal(token: string): Promise<string> {
  const sealed = await encryptToken(keyProvider, KEY_REF, token);
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  return sealed.value;
}

interface Setup {
  deps: AuthRouteDeps;
  session: ViewerPrincipal;
}

async function setup(token = "gh-token-1"): Promise<Setup> {
  const session: ViewerPrincipal = {
    id: 1n,
    sessionTokenHash: "hash-1",
    reviewerId: brand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId: brand(7n, isGrantRowId),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: await seal(token),
    keyRef: KEY_REF,
    scope: WriteClassifications.EXTERNAL_WRITE,
    channel: AuthChannels.COOKIE,
  };
  // Real handle + auth bundle: only `auth.keyProvider` is exercised (the
  // refresh orchestrator is mocked), but the deps stay honestly typed.
  const deps: AuthRouteDeps = {
    handle: harness.handle,
    auth: {
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      keyProvider,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: "https://example.test",
    },
  };
  return { deps, session };
}

const expired: GitHubApiError = {
  code: GitHubApiErrorCodes.UNAUTHORIZED,
  status: 401,
  message: "unauthorized",
};

const denied: GitHubApiError = {
  code: GitHubApiErrorCodes.NOT_FOUND,
  status: 404,
  message: "not found",
};

const upstreamTrouble: GitHubApiError = {
  code: GitHubApiErrorCodes.RATE_LIMITED,
  status: 403,
  message: "rate limited",
};

function isDeniedError(error: GitHubApiError): boolean {
  return error.code === GitHubApiErrorCodes.NOT_FOUND;
}

/** Answers 200 for the PAT alone; a repo outside the App installation. */
function patOnlyCall() {
  return vi.fn(
    async (token: string): Promise<Result<string, GitHubApiError>> =>
      token === "operator-pat"
        ? { ok: true, value: "body" }
        : { ok: false, error: denied },
  );
}

function okCall<T>(value: T) {
  return vi.fn(
    async (_token: string): Promise<Result<T, GitHubApiError>> => ({
      ok: true,
      value,
    }),
  );
}

let harness: PgliteHarness;
beforeAll(async () => {
  harness = await createPgliteHarness();
});
afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  vi.mocked(refreshSessionToken).mockReset();
});

describe("createReviewerGitHubClient", () => {
  it("decrypts the stored token once and passes it to every call", async () => {
    const { deps, session } = await setup("gh-token-1");
    const client = createReviewerGitHubClient(deps, session, log);
    const call = okCall("a");
    await client.run(call);
    await client.run(call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenNthCalledWith(1, "gh-token-1");
    expect(call).toHaveBeenNthCalledWith(2, "gh-token-1");
  });

  it("returns token-unreadable when the ciphertext cannot be decrypted", async () => {
    const { deps, session } = await setup();
    const client = createReviewerGitHubClient(
      deps,
      { ...session, ghTokenCiphertext: "not-a-ciphertext" },
      log,
    );
    const call = okCall("a");
    const result = await client.run(call);
    expect(result).toEqual({
      ok: false,
      error: { kind: "token-unreadable" },
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("retries an expired call once with the refreshed token", async () => {
    const { deps, session } = await setup("stale");
    const rotated = { ...session, sessionTokenHash: "hash-2" };
    vi.mocked(refreshSessionToken).mockResolvedValue({
      ok: true,
      value: { session: rotated, accessToken: "fresh" },
    });
    const client = createReviewerGitHubClient(deps, session, log);
    const call = vi.fn(
      async (token: string): Promise<Result<string, GitHubApiError>> =>
        token === "fresh"
          ? { ok: true, value: "done" }
          : { ok: false, error: expired },
    );
    const result = await client.run(call);
    expect(result).toEqual({ ok: true, value: "done" });
    expect(call).toHaveBeenCalledTimes(2);
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
    expect(client.session()).toBe(rotated);
  });

  it("spends the refresh at most once across the whole request", async () => {
    const { deps, session } = await setup("stale");
    vi.mocked(refreshSessionToken).mockResolvedValue({
      ok: true,
      value: { session, accessToken: "still-stale" },
    });
    const client = createReviewerGitHubClient(deps, session, log);
    const failing = vi.fn(
      async (_token: string): Promise<Result<string, GitHubApiError>> => ({
        ok: false,
        error: expired,
      }),
    );
    const first = await client.run(failing);
    const second = await client.run(failing);
    expect(first).toEqual({ ok: false, error: expired });
    expect(second).toEqual({ ok: false, error: expired });
    // First run: initial + one post-refresh retry; second run: no retry.
    expect(failing).toHaveBeenCalledTimes(3);
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
  });

  it("returns the original expired error when the refresh fails", async () => {
    const { deps, session } = await setup("stale");
    vi.mocked(refreshSessionToken).mockResolvedValue({
      ok: false,
      error: { code: "refresh-failed", message: "refresh failed" },
    });
    const client = createReviewerGitHubClient(deps, session, log);
    const failing = vi.fn(
      async (_token: string): Promise<Result<string, GitHubApiError>> => ({
        ok: false,
        error: expired,
      }),
    );
    const result = await client.run(failing);
    expect(result).toEqual({ ok: false, error: expired });
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on a non-expiry failure", async () => {
    const { deps, session } = await setup();
    const notFound: GitHubApiError = {
      code: GitHubApiErrorCodes.NOT_FOUND,
      status: 404,
      message: "not found",
    };
    const client = createReviewerGitHubClient(deps, session, log);
    const result = await client.run(
      vi.fn(
        async (_token: string): Promise<Result<string, GitHubApiError>> => ({
          ok: false,
          error: notFound,
        }),
      ),
    );
    expect(result).toEqual({ ok: false, error: notFound });
    expect(refreshSessionToken).not.toHaveBeenCalled();
  });

  it("a concurrent loser awaits the in-flight refresh and retries rotated", async () => {
    const { deps, session } = await setup("stale");
    let releaseRefresh: (() => void) | undefined;
    vi.mocked(refreshSessionToken).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRefresh = () =>
            resolve({
              ok: true,
              value: { session, accessToken: "fresh" },
            });
        }),
    );
    const client = createReviewerGitHubClient(deps, session, log);
    const call = vi.fn(
      async (token: string): Promise<Result<string, GitHubApiError>> =>
        token === "fresh"
          ? { ok: true, value: "done" }
          : { ok: false, error: expired },
    );
    const [first, second] = await Promise.all([
      client.run(call),
      client.run(call),
      (async () => {
        await vi.waitFor(() => {
          expect(releaseRefresh).toBeDefined();
        });
        releaseRefresh?.();
      })(),
    ]);
    expect(first).toEqual({ ok: true, value: "done" });
    expect(second).toEqual({ ok: true, value: "done" });
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
  });

  it("a failed refresh consumes the request's budget", async () => {
    const { deps, session } = await setup("stale");
    vi.mocked(refreshSessionToken).mockResolvedValue({
      ok: false,
      error: { code: "refresh-failed", message: "refresh failed" },
    });
    const client = createReviewerGitHubClient(deps, session, log);
    const failing = vi.fn(
      async (_token: string): Promise<Result<string, GitHubApiError>> => ({
        ok: false,
        error: expired,
      }),
    );
    await client.run(failing);
    await client.run(failing);
    expect(refreshSessionToken).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("honours a caller-supplied expiry predicate", async () => {
    const { deps, session } = await setup("stale");
    vi.mocked(refreshSessionToken).mockResolvedValue({
      ok: true,
      value: { session, accessToken: "fresh" },
    });
    const client = createReviewerGitHubClient(deps, session, log);
    const call = vi.fn(
      async (token: string): Promise<Result<string, { status: number }>> =>
        token === "fresh"
          ? { ok: true, value: "done" }
          : { ok: false, error: { status: 401 } },
    );
    const result = await client.run(call, (error) => error.status === 401);
    expect(result).toEqual({ ok: true, value: "done" });
  });

  // `runRead` is the ladder behind a gate pass carried by the operator PAT.
  // It exists for READS: a write on that footing would leave GitHub
  // attributing the operator for something a reader did.
  it("runRead retries a denied read with the operator PAT", async () => {
    const { deps, session } = await setup("reader-token");
    const client = createReviewerGitHubClient(
      deps,
      session,
      log,
      "operator-pat",
    );
    const call = patOnlyCall();

    const result = await client.runRead(call, isDeniedError);

    expect(result).toEqual({ ok: true, value: "body" });
    expect(call.mock.calls.map(([token]) => token)).toEqual([
      "reader-token",
      "operator-pat",
    ]);
  });

  it("runRead spends nothing extra when the reader's own token works", async () => {
    const { deps, session } = await setup("reader-token");
    const client = createReviewerGitHubClient(
      deps,
      session,
      log,
      "operator-pat",
    );
    const call = okCall("body");

    await client.runRead(call, isDeniedError);

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("reader-token");
  });

  // A 401 from the OPERATOR's key is not the reader's problem to fix: mapping
  // it to the viewer path would tell them to sign in again, which cannot
  // repair a credential that is not theirs.
  it("runRead keeps the reader's own denial when the PAT itself is rejected", async () => {
    const { deps, session } = await setup("reader-token");
    const client = createReviewerGitHubClient(
      deps,
      session,
      log,
      "stale-operator-pat",
    );
    const call = vi.fn(
      async (token: string): Promise<Result<string, GitHubApiError>> =>
        token === "reader-token"
          ? { ok: false, error: denied }
          : {
              ok: false,
              error: {
                code: GitHubApiErrorCodes.UNAUTHORIZED,
                status: 401,
                message: "bad credentials",
              },
            },
    );

    const result = await client.runRead(call, isDeniedError);

    expect(result).toEqual({ ok: false, error: denied });
    expect(call.mock.calls.map(([token]) => token)).toEqual([
      "reader-token",
      "stale-operator-pat",
    ]);
  });

  it("runRead has no second rung without a fallback token", async () => {
    const { deps, session } = await setup("reader-token");
    const client = createReviewerGitHubClient(deps, session, log);
    const call = patOnlyCall();

    const result = await client.runRead(call, isDeniedError);

    expect(result).toEqual({ ok: false, error: denied });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("runRead does not burn the PAT on upstream trouble", async () => {
    const { deps, session } = await setup("reader-token");
    const client = createReviewerGitHubClient(
      deps,
      session,
      log,
      "operator-pat",
    );
    const call = vi.fn(
      async (_token: string): Promise<Result<string, GitHubApiError>> => ({
        ok: false,
        error: upstreamTrouble,
      }),
    );

    const result = await client.runRead(call, isDeniedError);

    expect(result).toEqual({ ok: false, error: upstreamTrouble });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("runRead returns token-unreadable without reaching the PAT", async () => {
    const { deps, session } = await setup();
    const client = createReviewerGitHubClient(
      deps,
      { ...session, ghTokenCiphertext: "not-a-ciphertext" },
      log,
      "operator-pat",
    );
    const call = patOnlyCall();

    const result = await client.runRead(call, isDeniedError);

    expect(result).toEqual({ ok: false, error: { kind: "token-unreadable" } });
    expect(call).not.toHaveBeenCalled();
  });
});
