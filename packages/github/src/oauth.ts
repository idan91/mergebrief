// GitHub OAuth (user-to-server) helpers for reviewer login (BRIEF-2 stage 6,
// PR C — ADR 0016 #4, plan decision #3). Wraps `@octokit/oauth-app`
// (GitHub-official) for the web flow: build the authorization URL, exchange the
// callback code for an expiring user access token + rotating refresh token, and
// refresh that token later. Plus two thin user-token REST reads (the
// authenticated user and the app installations reachable to that user) the
// callback needs to resolve the tenant.
//
// SECURITY: every expected failure is a `Result`, never a throw. NO error
// message ever echoes a code, token, or client secret — the octokit errors
// thrown by `createToken`/`refreshToken` carry the exchanged credentials in
// their request options, so they are swallowed and replaced with a static,
// safe-to-log message. REST failures funnel through `mapRequestError`, the
// package's single sanitization chokepoint.
//
// EXPIRATION REQUIRED: these helpers assume the GitHub App has
// "Expire user authorization tokens" enabled — that is what makes GitHub return
// a `refreshToken` + expiries. If the App is misconfigured (no refresh token in
// the exchange response), `exchangeWebFlowCode` returns a clear
// `EXPIRATION_NOT_ENABLED` error rather than silently minting a non-expiring
// session.
import { Octokit } from "octokit";
import { OAuthApp, type Options } from "@octokit/oauth-app";
import type { InstallationId, ReviewerId } from "persistence";
import { z } from "zod";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "./errors";
import { isInstallationId, isReviewerId } from "./ids";
import type { Result, ValueOf } from "./types";

// ---------------------------------------------------------------------------
// The github-app-typed OAuth client. Typing it with `Options<"github-app">`
// makes `createToken`/`refreshToken` resolve to the WithExpiration
// authentication shapes (refresh token + expiries), not the OAuth-App variant.
// ---------------------------------------------------------------------------

export type GitHubOAuthApp = OAuthApp<Options<"github-app">>;

/**
 * The mapped, sanitized token bundle returned by the web-flow exchange and by a
 * refresh. `accessToken` is the ~8h user token; `refreshToken` is the ~6mo
 * single-use rotating token (D11). Both expiries are `Date`s (octokit hands
 * them back as ISO strings).
 */
export interface OAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshTokenExpiresAt: Date;
}

export const OAuthErrorCode = {
  /** The code→token exchange failed (bad/expired code, network, GitHub 4xx). */
  EXCHANGE_FAILED: "exchange-failed",
  /** The refresh-token rotation failed (revoked/expired refresh token, etc.). */
  REFRESH_FAILED: "refresh-failed",
  /** GitHub returned no refresh token — token expiration is not enabled. */
  EXPIRATION_NOT_ENABLED: "expiration-not-enabled",
} as const;
export type OAuthErrorCode = ValueOf<typeof OAuthErrorCode>;

export interface OAuthError {
  readonly code: OAuthErrorCode;
  /** Static, safe-to-log summary — never carries the code/token/secret. */
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Client construction + authorization URL.
// ---------------------------------------------------------------------------

/**
 * Construct the github-app-typed `OAuthApp` from client credentials. Synchronous
 * and does not perform a network call — it only holds the client id/secret for
 * later token requests.
 */
export function createOAuthApp(config: {
  clientId: string;
  clientSecret: string;
}): GitHubOAuthApp {
  return new OAuthApp<Options<"github-app">>({
    clientType: "github-app",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
}

/**
 * Build the GitHub authorization URL the reviewer is redirected to. `state` is
 * the caller's CSRF nonce (echoed back on the callback); `redirectUrl` is the
 * callback endpoint. Pure/synchronous — no network.
 */
export function buildAuthorizationUrl(
  oauthApp: GitHubOAuthApp,
  input: { state: string; redirectUrl: string },
): { url: string } {
  const { url } = oauthApp.getWebFlowAuthorizationUrl({
    state: input.state,
    redirectUrl: input.redirectUrl,
  });
  return { url };
}

// ---------------------------------------------------------------------------
// Token exchange + refresh. Both map octokit's `authentication` result into the
// sanitized `OAuthTokens`; a missing refresh token/expiry means the App lacks
// token expiration and is a clear error, never a silent non-expiring session.
// ---------------------------------------------------------------------------

/** The subset of octokit's `authentication` result these helpers consume. */
interface ExpiringAuthentication {
  readonly token: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
  readonly refreshTokenExpiresAt?: string;
}

function toOAuthTokens(
  auth: ExpiringAuthentication,
): Result<OAuthTokens, OAuthError> {
  if (
    auth.refreshToken === undefined ||
    auth.expiresAt === undefined ||
    auth.refreshTokenExpiresAt === undefined
  ) {
    return {
      ok: false,
      error: {
        code: OAuthErrorCode.EXPIRATION_NOT_ENABLED,
        message:
          "GitHub returned no refresh token — enable 'Expire user authorization tokens' on the App",
      },
    };
  }
  return {
    ok: true,
    value: {
      accessToken: auth.token,
      refreshToken: auth.refreshToken,
      accessTokenExpiresAt: new Date(auth.expiresAt),
      refreshTokenExpiresAt: new Date(auth.refreshTokenExpiresAt),
    },
  };
}

/**
 * Exchange the web-flow `code` (with its `state`) for user tokens. On any thrown
 * error (bad code, GitHub 4xx, network) returns a sanitized `EXCHANGE_FAILED` —
 * the underlying octokit error carries the code/secret and is never surfaced.
 */
export async function exchangeWebFlowCode(
  oauthApp: GitHubOAuthApp,
  input: { code: string; state: string },
): Promise<Result<OAuthTokens, OAuthError>> {
  try {
    const { authentication } = await oauthApp.createToken({
      code: input.code,
      state: input.state,
    });
    return toOAuthTokens(authentication);
  } catch {
    return {
      ok: false,
      error: {
        code: OAuthErrorCode.EXCHANGE_FAILED,
        message: "failed to exchange the OAuth web-flow code",
      },
    };
  }
}

/**
 * Rotate an expiring user token using its refresh token. GitHub refresh tokens
 * are single-use (D11): a successful call invalidates `input.refreshToken` and
 * returns a fresh pair. A thrown error becomes a sanitized `REFRESH_FAILED`.
 */
export async function refreshUserToken(
  oauthApp: GitHubOAuthApp,
  input: { refreshToken: string },
): Promise<Result<OAuthTokens, OAuthError>> {
  try {
    const { authentication } = await oauthApp.refreshToken({
      refreshToken: input.refreshToken,
    });
    return toOAuthTokens(authentication);
  } catch {
    return {
      ok: false,
      error: {
        code: OAuthErrorCode.REFRESH_FAILED,
        message: "failed to refresh the user access token",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// User-token REST reads. Both build a fresh user-scoped `Octokit`; failures are
// sanitized via `mapRequestError` (no token/header/body leaks).
// ---------------------------------------------------------------------------

const userResponseSchema = z.object({
  id: z.number().int(),
  login: z.string().min(1),
});

/**
 * Resolve the authenticated reviewer (`GET /user`) for a user access token,
 * branding the numeric id as `ReviewerId`. An ill-shaped 2xx body or a
 * non-positive id is a sanitized `REQUEST_FAILED`, never an `as` cast.
 */
export async function fetchAuthenticatedUser(
  accessToken: string,
): Promise<
  Result<{ reviewerId: ReviewerId; reviewerLogin: string }, GitHubApiError>
> {
  const octokit = new Octokit({ auth: accessToken });
  try {
    const response = await octokit.request("GET /user");
    const parsed = userResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        ok: false,
        error: unexpectedResponseError("fetch authenticated user"),
      };
    }
    const id = BigInt(parsed.data.id);
    if (!isReviewerId(id)) {
      return {
        ok: false,
        error: unexpectedResponseError("fetch authenticated user"),
      };
    }
    return {
      ok: true,
      value: { reviewerId: id, reviewerLogin: parsed.data.login },
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch authenticated user") };
  }
}

const installationsResponseSchema = z.object({
  installations: z.array(z.object({ id: z.number().int() })),
});

/**
 * List the app installations reachable to the user (`GET /user/installations`),
 * branding each numeric id as `InstallationId`. The callback uses this to pick
 * the tenant a new session belongs to (THE TENANT MODEL). Empty is a valid `ok`
 * result — the caller decides that "the app isn't installed for this account".
 */
export async function listAppInstallationsForUser(
  accessToken: string,
): Promise<Result<InstallationId[], GitHubApiError>> {
  const octokit = new Octokit({ auth: accessToken });
  try {
    const response = await octokit.request("GET /user/installations");
    const parsed = installationsResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      return {
        ok: false,
        error: unexpectedResponseError("list user installations"),
      };
    }
    const ids: InstallationId[] = [];
    for (const installation of parsed.data.installations) {
      const id = BigInt(installation.id);
      if (!isInstallationId(id)) {
        return {
          ok: false,
          error: unexpectedResponseError("list user installations"),
        };
      }
      ids.push(id);
    }
    return { ok: true, value: ids };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "list user installations") };
  }
}

/**
 * A thin user-scoped `Octokit` for an access token. The stage-7 authorization
 * gate uses it for the viewer's repo-access check; exposed here so that seam
 * reuses the same construction (and the same default global `fetch`).
 */
export function createUserOctokit(accessToken: string): Octokit {
  return new Octokit({ auth: accessToken });
}
