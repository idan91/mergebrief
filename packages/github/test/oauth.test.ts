// OAuth helper mapping and sanitization, with `OAuthApp` stubbed at the injected
// interface. Asserts that octokit's authentication result maps to the sanitized
// `OAuthTokens`, that a missing refresh token is a clear EXPIRATION_NOT_ENABLED,
// and that a thrown exchange or refresh error never leaks what it carried.
import { describe, expect, it, vi } from "vitest";
import {
  createOAuthApp,
  deleteUserToken,
  exchangeWebFlowCode,
  listUserInstallations,
  refreshUserToken,
  OAuthErrorCodes,
  type GitHubOAuthApp,
} from "../src/auth/oauth";

const ACCESS_TOKEN = "ghu_ACCESS_TOKEN_VALUE";
const REFRESH_TOKEN = "ghr_REFRESH_TOKEN_VALUE";
const CODE = "web-flow-code-abc123";
const STATE = "csrf-state-nonce";
const ACCESS_EXPIRES = "2026-07-05T08:00:00.000Z";
const REFRESH_EXPIRES = "2027-01-05T00:00:00.000Z";

// A leaked code/token/secret must never surface in a sanitized OAuthError. We
// plant them in the thrown error's request options and assert they never escape.
function leakyError(): Error {
  const error = new Error("Bad credentials") as Error & { request?: unknown };
  error.request = {
    method: "POST",
    url: "https://github.com/login/oauth/access_token",
    body: {
      code: CODE,
      client_secret: "SECRET_VALUE",
      refresh_token: REFRESH_TOKEN,
    },
  };
  return error;
}

// The double assertion injects a structural mock where the full `OAuthApp`
// type is expected; only the methods under test are implemented.
function mockOAuthApp(overrides: {
  createToken?: ReturnType<typeof vi.fn>;
  refreshToken?: ReturnType<typeof vi.fn>;
}): GitHubOAuthApp {
  const stub = {
    createToken: overrides.createToken ?? vi.fn(),
    refreshToken: overrides.refreshToken ?? vi.fn(),
  };
  return stub as unknown as GitHubOAuthApp;
}

describe("exchangeWebFlowCode", () => {
  it("maps octokit's authentication result to OAuthTokens with Date expiry", async () => {
    const createToken = vi.fn().mockResolvedValue({
      authentication: {
        clientType: "github-app",
        token: ACCESS_TOKEN,
        refreshToken: REFRESH_TOKEN,
        expiresAt: ACCESS_EXPIRES,
        refreshTokenExpiresAt: REFRESH_EXPIRES,
      },
    });
    const app = mockOAuthApp({ createToken });

    const result = await exchangeWebFlowCode(app, { code: CODE, state: STATE });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.accessToken).toBe(ACCESS_TOKEN);
    expect(result.value.refreshToken).toBe(REFRESH_TOKEN);
    expect(result.value.accessTokenExpiresAt).toEqual(new Date(ACCESS_EXPIRES));
    expect(result.value.refreshTokenExpiresAt).toEqual(
      new Date(REFRESH_EXPIRES),
    );
    expect(createToken).toHaveBeenCalledWith({ code: CODE, state: STATE });
  });

  it("returns EXPIRATION_NOT_ENABLED when GitHub sends no refresh token", async () => {
    const createToken = vi.fn().mockResolvedValue({
      authentication: { clientType: "github-app", token: ACCESS_TOKEN },
    });
    const app = mockOAuthApp({ createToken });

    const result = await exchangeWebFlowCode(app, { code: CODE, state: STATE });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(OAuthErrorCodes.EXPIRATION_NOT_ENABLED);
  });

  it("maps a thrown exchange error to a sanitized EXCHANGE_FAILED", async () => {
    const createToken = vi.fn().mockRejectedValue(leakyError());
    const app = mockOAuthApp({ createToken });

    const result = await exchangeWebFlowCode(app, { code: CODE, state: STATE });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(OAuthErrorCodes.EXCHANGE_FAILED);
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(CODE);
    expect(serialized).not.toContain(REFRESH_TOKEN);
    expect(serialized).not.toContain("SECRET_VALUE");
  });
});

describe("exchangeWebFlowCode against GitHub's OAuth bodies", () => {
  it.each(["bad_verification_code", "unverified_user_email"])(
    "answers EXCHANGE_FAILED for the reviewer-side %s",
    async (oauthError) => {
      stubOAuthErrorBody(oauthError);

      const result = await exchangeWebFlowCode(makeOAuthApp(), {
        code: CODE,
        state: STATE,
      });

      expect(result.ok || result.error.code).toBe(
        OAuthErrorCodes.EXCHANGE_FAILED,
      );
    },
  );

  it("answers CLIENT_MISCONFIGURED for a wrong client secret", async () => {
    stubOAuthErrorBody("incorrect_client_credentials");

    const result = await exchangeWebFlowCode(makeOAuthApp(), {
      code: CODE,
      state: STATE,
    });

    expect(result.ok || result.error).toMatchObject({
      code: OAuthErrorCodes.CLIENT_MISCONFIGURED,
      oauthError: "incorrect_client_credentials",
    });
  });
});

describe("refreshUserToken", () => {
  it("maps a rotated authentication result to OAuthTokens", async () => {
    const refreshFn = vi.fn().mockResolvedValue({
      authentication: {
        clientType: "github-app",
        token: "ghu_ROTATED_ACCESS",
        refreshToken: "ghr_ROTATED_REFRESH",
        expiresAt: ACCESS_EXPIRES,
        refreshTokenExpiresAt: REFRESH_EXPIRES,
      },
    });
    const app = mockOAuthApp({ refreshToken: refreshFn });

    const result = await refreshUserToken(app, { refreshToken: REFRESH_TOKEN });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.accessToken).toBe("ghu_ROTATED_ACCESS");
    expect(result.value.refreshToken).toBe("ghr_ROTATED_REFRESH");
    expect(result.value.refreshTokenExpiresAt).toEqual(
      new Date(REFRESH_EXPIRES),
    );
    expect(refreshFn).toHaveBeenCalledWith({ refreshToken: REFRESH_TOKEN });
  });

  it("maps a thrown refresh error to a sanitized REFRESH_UNAVAILABLE", async () => {
    const refreshFn = vi.fn().mockRejectedValue(leakyError());
    const app = mockOAuthApp({ refreshToken: refreshFn });

    const result = await refreshUserToken(app, { refreshToken: REFRESH_TOKEN });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe(OAuthErrorCodes.REFRESH_UNAVAILABLE);
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(REFRESH_TOKEN);
    expect(serialized).not.toContain("SECRET_VALUE");
  });

  it("answers REFRESH_TOKEN_REJECTED for a bad_refresh_token body", async () => {
    stubOAuthErrorBody("bad_refresh_token");

    const result = await refreshUserToken(makeOAuthApp(), {
      refreshToken: REFRESH_TOKEN,
    });

    expect(readRefreshErrorCode(result)).toBe(
      OAuthErrorCodes.REFRESH_TOKEN_REJECTED,
    );
  });

  it.each(["incorrect_client_credentials", "unsupported_grant_type"])(
    "answers CLIENT_MISCONFIGURED, naming %s, on a refresh",
    async (oauthError) => {
      stubOAuthErrorBody(oauthError);

      const result = await refreshUserToken(makeOAuthApp(), {
        refreshToken: REFRESH_TOKEN,
      });

      expect(result.ok || result.error).toMatchObject({
        code: OAuthErrorCodes.CLIENT_MISCONFIGURED,
        oauthError,
      });
    },
  );

  it("answers EXPIRATION_NOT_ENABLED for a token that never expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          access_token: "ghu_NON_EXPIRING",
          token_type: "bearer",
          scope: "",
        }),
      ),
    );

    const result = await refreshUserToken(makeOAuthApp(), {
      refreshToken: REFRESH_TOKEN,
    });

    expect(readRefreshErrorCode(result)).toBe(
      OAuthErrorCodes.EXPIRATION_NOT_ENABLED,
    );
  });

  it("names an OAuth error that is not a plain token as unrecognized", async () => {
    stubOAuthErrorBody("Bad <credentials> for SECRET_VALUE");

    const result = await refreshUserToken(makeOAuthApp(), {
      refreshToken: REFRESH_TOKEN,
    });

    expect(result.ok || result.error).toMatchObject({
      code: OAuthErrorCodes.CLIENT_MISCONFIGURED,
      oauthError: "unrecognized",
    });
  });

  it("answers REFRESH_TOKEN_REJECTED for an OAuth body on a real 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: "bad_refresh_token",
            error_description: "The refresh token passed is incorrect.",
            error_uri: "https://docs.github.com/apps",
          },
          401,
        ),
      ),
    );

    const result = await refreshUserToken(makeOAuthApp(), {
      refreshToken: REFRESH_TOKEN,
    });

    expect(readRefreshErrorCode(result)).toBe(
      OAuthErrorCodes.REFRESH_TOKEN_REJECTED,
    );
  });

  it("answers REFRESH_UNAVAILABLE when GitHub answers 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "Bad Gateway" }, 502)),
    );

    const result = await refreshUserToken(makeOAuthApp(), {
      refreshToken: REFRESH_TOKEN,
    });

    expect(readRefreshErrorCode(result)).toBe(
      OAuthErrorCodes.REFRESH_UNAVAILABLE,
    );
  });

  it("answers REFRESH_UNAVAILABLE when the network call throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const result = await refreshUserToken(makeOAuthApp(), {
      refreshToken: REFRESH_TOKEN,
    });

    expect(readRefreshErrorCode(result)).toBe(
      OAuthErrorCodes.REFRESH_UNAVAILABLE,
    );
  });

  it("gives up on a GitHub that never answers once the timeout passes", async () => {
    const app = createOAuthApp({
      clientId: "Iv1.client",
      clientSecret: "SECRET_VALUE",
      requestTimeoutMs: SHORT_TIMEOUT_MS,
    });
    vi.stubGlobal("fetch", vi.fn(stubHangingFetch));

    const result = await refreshUserToken(app, { refreshToken: REFRESH_TOKEN });

    expect(readRefreshErrorCode(result)).toBe(
      OAuthErrorCodes.REFRESH_UNAVAILABLE,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(REFRESH_TOKEN);
    expect(serialized).not.toContain("SECRET_VALUE");
  });
});

function stubOAuthErrorBody(oauthError: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({
        error: oauthError,
        error_description: "GitHub refused the request.",
        error_uri: "https://docs.github.com/apps",
      }),
    ),
  );
}

describe("deleteUserToken", () => {
  it("sends DELETE /applications/{client_id}/token and answers ok on 204", async () => {
    const fetchStub = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchStub);

    const result = await deleteUserToken(makeOAuthApp(), {
      accessToken: ACCESS_TOKEN,
    });

    expect(result.ok).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [input, init] = fetchStub.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(getRequestUrl(input)).toBe(
      "https://api.github.com/applications/Iv1.client/token",
    );
    expect(init.method).toBe("DELETE");
    expect(typeof init.body === "string" && JSON.parse(init.body)).toEqual({
      access_token: ACCESS_TOKEN,
    });
  });

  it("answers ok when GitHub answers 404 for a token it no longer knows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "Not Found" }, 404)),
    );

    const result = await deleteUserToken(makeOAuthApp(), {
      accessToken: ACCESS_TOKEN,
    });

    expect(result.ok).toBe(true);
  });

  it("fails without the token in its error when GitHub answers 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "Server Error" }, 500)),
    );

    const result = await deleteUserToken(makeOAuthApp(), {
      accessToken: ACCESS_TOKEN,
    });

    expect(readDeleteErrorCode(result)).toBe(
      OAuthErrorCodes.TOKEN_DELETE_FAILED,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain("SECRET_VALUE");
  });

  it("fails once the timeout passes on a GitHub that never answers", async () => {
    const app = createOAuthApp({
      clientId: "Iv1.client",
      clientSecret: "SECRET_VALUE",
      requestTimeoutMs: SHORT_TIMEOUT_MS,
    });
    vi.stubGlobal("fetch", vi.fn(stubHangingFetch));

    const result = await deleteUserToken(app, { accessToken: ACCESS_TOKEN });

    expect(readDeleteErrorCode(result)).toBe(
      OAuthErrorCodes.TOKEN_DELETE_FAILED,
    );
  });
});

function readDeleteErrorCode(
  result: Awaited<ReturnType<typeof deleteUserToken>>,
): string {
  if (result.ok) {
    throw new Error("expected the delete to fail");
  }
  return result.error.code;
}

function makeOAuthApp(): GitHubOAuthApp {
  return createOAuthApp({
    clientId: "Iv1.client",
    clientSecret: "SECRET_VALUE",
  });
}

function readRefreshErrorCode(
  result: Awaited<ReturnType<typeof refreshUserToken>>,
): string {
  if (result.ok) {
    throw new Error("expected the refresh to fail");
  }
  return result.error.code;
}

const SHORT_TIMEOUT_MS = 20;

/** A GitHub that never answers: only the request's abort signal ends it. */
function stubHangingFetch(
  _input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(init.signal?.reason);
    });
  });
}

// `listUserInstallations` builds its own user-scoped Octokit, which reads the
// global `fetch` at call time, so it is stubbed at the HTTP boundary.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

function getRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

describe("listUserInstallations", () => {
  it("maps GET /user/installations to branded ids + account logins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = getRequestUrl(input);
        expect(url).toContain("/user/installations");
        return jsonResponse({
          total_count: 2,
          installations: [
            { id: 1000, account: { login: "acme" } },
            { id: 2000, account: { login: "octocat" } },
          ],
        });
      }),
    );

    const result = await listUserInstallations("ghu_ACCESS");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual([
      { installationId: 1000n, accountLogin: "acme" },
      { installationId: 2000n, accountLogin: "octocat" },
    ]);
  });

  it("reads every page and returns every installation", async () => {
    const firstPage = Array.from({ length: 30 }, (_, index) => ({
      id: 1000 + index,
      account: { login: `org-${index}` },
    }));
    const secondPage = [{ id: 1030, account: { login: "org-30" } }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(getRequestUrl(input));
        expect(url.searchParams.get("per_page")).toBe("100");
        if (url.searchParams.get("page") === "2") {
          return jsonResponse({ total_count: 31, installations: secondPage });
        }
        const response = jsonResponse({
          total_count: 31,
          installations: firstPage,
        });
        response.headers.set(
          "link",
          `<${url.origin}${url.pathname}?per_page=100&page=2>; rel="next"`,
        );
        return response;
      }),
    );

    const result = await listUserInstallations("ghu_ACCESS");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toHaveLength(31);
    expect(result.value[30]).toEqual({
      installationId: 1030n,
      accountLogin: "org-30",
    });
  });

  it("refuses a 409 instead of reading it as no installations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "conflict" }, 409)),
    );

    const result = await listUserInstallations("ghu_ACCESS");

    expect(result.ok).toBe(false);
  });

  it("refuses an empty 200 instead of reading it as no installations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({})),
    );

    const result = await listUserInstallations("ghu_ACCESS");

    expect(result.ok).toBe(false);
  });

  it("refuses a list that stops short of its count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(getRequestUrl(input));
        if (url.searchParams.get("page") === "2") {
          return jsonResponse({ total_count: 2, installations: [] });
        }
        return jsonResponse({
          total_count: 2,
          installations: [{ id: 1000, account: { login: "acme" } }],
        });
      }),
    );

    const result = await listUserInstallations("ghu_ACCESS");

    expect(result.ok).toBe(false);
  });

  it("carries a user or org account's id, and marks a suspended install", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          total_count: 3,
          installations: [
            { id: 1000, account: { id: 77, login: "acme" } },
            { id: 2000, account: { id: 88, slug: "big-corp" } },
            { id: 3000, account: null },
            {
              id: 4000,
              account: { id: 99, login: "paused" },
              suspended_at: "2026-11-01T00:00:00Z",
            },
          ],
        }),
      ),
    );

    const result = await listUserInstallations("ghu_ACCESS");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value).toEqual([
      { installationId: 1000n, accountLogin: "acme", accountId: 77n },
      { installationId: 2000n, accountLogin: "big-corp" },
      { installationId: 3000n, accountLogin: "3000" },
      {
        installationId: 4000n,
        accountLogin: "paused",
        accountId: 99n,
        suspended: true,
      },
    ]);
  });

  it("keeps an installation whose account is an enterprise or gone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          total_count: 3,
          installations: [
            { id: 1000, account: { login: "acme" } },
            { id: 2000, account: { slug: "big-corp" } },
            { id: 3000, account: null },
          ],
        }),
      ),
    );

    const result = await listUserInstallations("ghu_ACCESS");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.map((entry) => entry.accountLogin)).toEqual([
      "acme",
      "big-corp",
      "3000",
    ]);
  });
});
