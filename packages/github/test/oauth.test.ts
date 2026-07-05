// OAuth helper mapping + sanitization (BRIEF-2 stage 6). The `OAuthApp` is
// stubbed at the injected seam (a hand-written object with `createToken` /
// `refreshToken` as `vi.fn()` — no new mock libraries, mirroring api.test.ts).
// Asserts: octokit's `authentication` result maps to the sanitized
// `OAuthTokens` (ISO strings → Date); a missing refresh token (App without
// token expiration) is a clear `EXPIRATION_NOT_ENABLED`; and a thrown exchange/
// refresh error never leaks the code/token/secret it carried.
import { describe, expect, it, vi } from "vitest";
import {
  exchangeWebFlowCode,
  refreshUserToken,
  OAuthErrorCode,
  type GitHubOAuthApp,
} from "../src/oauth";

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
    body: { code: CODE, client_secret: "SECRET_VALUE", refresh_token: REFRESH_TOKEN },
  };
  return error;
}

// Build a minimal OAuthApp stub. The double assertion is the sanctioned
// test-only escape hatch for injecting a structural mock where the full
// `OAuthApp` type is expected — we only implement the methods under test.
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
  it("maps octokit's authentication result to OAuthTokens (ISO → Date)", async () => {
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
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.accessToken).toBe(ACCESS_TOKEN);
    expect(result.value.refreshToken).toBe(REFRESH_TOKEN);
    expect(result.value.accessTokenExpiresAt).toEqual(new Date(ACCESS_EXPIRES));
    expect(result.value.refreshTokenExpiresAt).toEqual(new Date(REFRESH_EXPIRES));
    expect(createToken).toHaveBeenCalledWith({ code: CODE, state: STATE });
  });

  it("returns EXPIRATION_NOT_ENABLED when GitHub sends no refresh token", async () => {
    const createToken = vi.fn().mockResolvedValue({
      authentication: { clientType: "github-app", token: ACCESS_TOKEN },
    });
    const app = mockOAuthApp({ createToken });

    const result = await exchangeWebFlowCode(app, { code: CODE, state: STATE });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(OAuthErrorCode.EXPIRATION_NOT_ENABLED);
  });

  it("maps a thrown exchange error to a sanitized EXCHANGE_FAILED (no leaks)", async () => {
    const createToken = vi.fn().mockRejectedValue(leakyError());
    const app = mockOAuthApp({ createToken });

    const result = await exchangeWebFlowCode(app, { code: CODE, state: STATE });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(OAuthErrorCode.EXCHANGE_FAILED);
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(CODE);
    expect(serialized).not.toContain(REFRESH_TOKEN);
    expect(serialized).not.toContain("SECRET_VALUE");
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
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.accessToken).toBe("ghu_ROTATED_ACCESS");
    expect(result.value.refreshToken).toBe("ghr_ROTATED_REFRESH");
    expect(result.value.refreshTokenExpiresAt).toEqual(new Date(REFRESH_EXPIRES));
    expect(refreshFn).toHaveBeenCalledWith({ refreshToken: REFRESH_TOKEN });
  });

  it("maps a thrown refresh error to a sanitized REFRESH_FAILED (no leaks)", async () => {
    const refreshFn = vi.fn().mockRejectedValue(leakyError());
    const app = mockOAuthApp({ refreshToken: refreshFn });

    const result = await refreshUserToken(app, { refreshToken: REFRESH_TOKEN });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(OAuthErrorCode.REFRESH_FAILED);
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(REFRESH_TOKEN);
    expect(serialized).not.toContain("SECRET_VALUE");
  });
});
