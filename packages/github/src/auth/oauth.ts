// GitHub OAuth (user-to-server) helpers for reviewer login, wrapping
// `@octokit/oauth-app` for the web flow, plus the user-token REST reads the
// callback needs to resolve the tenant. No error message ever echoes a code,
// token or client secret: the octokit errors thrown by `createToken` and
// `refreshToken` carry the exchanged credentials in their request options, so
// they are swallowed and replaced with a static message. The App must have
// "Expire user authorization tokens" enabled, which is what makes GitHub
// return a refresh token plus expiries.
import { createHash } from "node:crypto";
import { Octokit } from "octokit";
import { Octokit as CoreOctokit } from "@octokit/core";
import { OAuthApp, type Options } from "@octokit/oauth-app";
import { retryOptions } from "./retry";
import type { InstallationId, ReviewerId } from "persistence";
import { z } from "zod/v4";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import { isInstallationId, isReviewerId } from "../ids";
import type { Result, ValueOf } from "types/utils";
import { HttpStatuses } from "types/http";

// `Options<"github-app">` makes `createToken`/`refreshToken` resolve to the
// WithExpiration authentication shapes, not the OAuth-App variant.

export type GitHubOAuthApp = OAuthApp<Options<"github-app">>;

/**
 * `accessToken` is the ~8h user token; `refreshToken` is the ~6mo single-use
 * rotating token. Expiries arrive from octokit as ISO strings.
 */
export interface OAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshTokenExpiresAt: Date;
}

export const OAuthErrorCodes = {
  /**
   * The code→token exchange failed on the reviewer's side (a stale code, an
   * unverified primary email) or in transport (network, GitHub 5xx).
   */
  EXCHANGE_FAILED: "exchange-failed",
  /** GitHub refused the refresh token itself (`bad_refresh_token`): the grant is dead. */
  REFRESH_TOKEN_REJECTED: "refresh-token-rejected",
  /**
   * GitHub refused the App's own credentials or settings (`oauthError` names
   * which): an operator fix, not the reviewer's code or grant.
   */
  CLIENT_MISCONFIGURED: "client-misconfigured",
  /** GitHub gave no OAuth answer (timeout, network, 5xx); the grant may live. */
  REFRESH_UNAVAILABLE: "refresh-unavailable",
  /** GitHub returned no refresh token; token expiration is not enabled. */
  EXPIRATION_NOT_ENABLED: "expiration-not-enabled",
} as const;
export type OAuthErrorCode = ValueOf<typeof OAuthErrorCodes>;

export interface OAuthError {
  readonly code: OAuthErrorCode;
  /** Static, safe-to-log summary; never carries the code/token/secret. */
  readonly message: string;
  /** GitHub's OAuth `error` token, or `unrecognized` when it is not a plain token. */
  readonly oauthError?: string;
}

// ---------------------------------------------------------------------------
// Client construction + authorization URL.
// ---------------------------------------------------------------------------

/** The longest one call to GitHub's OAuth endpoints may hold its caller. */
const OAUTH_REQUEST_TIMEOUT_MS = 10_000;

interface OAuthAppConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Overrides `OAUTH_REQUEST_TIMEOUT_MS`, so a test can abort in milliseconds. */
  readonly requestTimeoutMs?: number;
}

/**
 * Construct the github-app-typed `OAuthApp`. No network call. Every OAuth
 * call it makes aborts after the request timeout and fails like any other.
 */
export function createOAuthApp(config: OAuthAppConfig): GitHubOAuthApp {
  const timeoutMs = config.requestTimeoutMs ?? OAUTH_REQUEST_TIMEOUT_MS;
  return new OAuthApp<Options<"github-app">>({
    clientType: "github-app",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    Octokit: CoreOctokit.defaults({
      request: { fetch: createTimedFetch(timeoutMs) },
    }),
  });
}

/** Reads the global fetch per call, not at construction, so a stub still answers. */
function createTimedFetch(timeoutMs: number): typeof fetch {
  return function fetchWithTimeout(input, init) {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (init?.signal) {
      signals.push(init.signal);
    }
    return globalThis.fetch(input, {
      ...init,
      signal: AbortSignal.any(signals),
    });
  };
}

/**
 * Build the GitHub authorization URL the reviewer is redirected to. `state` is
 * the caller's CSRF nonce, echoed back on the callback.
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
// Token exchange + refresh. A missing refresh token/expiry means the App lacks
// token expiration and is a clear error, never a silent non-expiring session.
// ---------------------------------------------------------------------------

/** The subset of octokit's `authentication` result these helpers consume. */
interface ExpiringAuthentication {
  readonly token: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
  readonly refreshTokenExpiresAt?: string;
}

function failExpirationNotEnabled(): Result<never, OAuthError> {
  return {
    ok: false,
    error: {
      code: OAuthErrorCodes.EXPIRATION_NOT_ENABLED,
      message:
        "GitHub returned no refresh token; enable 'Expire user authorization tokens' on the App",
    },
  };
}

function toOAuthTokens(
  auth: ExpiringAuthentication,
): Result<OAuthTokens, OAuthError> {
  if (
    auth.refreshToken === undefined ||
    auth.expiresAt === undefined ||
    auth.refreshTokenExpiresAt === undefined
  ) {
    return failExpirationNotEnabled();
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
 * Exchange the web-flow `code` for user tokens. The underlying octokit error
 * carries the code/secret, so it is never surfaced.
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
  } catch (error) {
    const oauthError = readOAuthErrorBody(error);
    const clientRefused =
      oauthError !== undefined &&
      !REVIEWER_SIDE_EXCHANGE_ERRORS.has(oauthError);
    if (clientRefused) {
      return failClientMisconfigured(oauthError);
    }
    return {
      ok: false,
      error: {
        code: OAuthErrorCodes.EXCHANGE_FAILED,
        message: "failed to exchange the OAuth web-flow code",
      },
    };
  }
}

// GitHub's OAuth `error` body arrives on a 4xx: `@octokit/oauth-methods`
// rethrows a 200 carrying one as a 400, and a real 4xx keeps its own status.
// Either way the body rides on `response.data`; every other throw is transport.
const oauthErrorBodySchema = z.object({
  status: z
    .number()
    .int()
    .gte(HttpStatuses.BAD_REQUEST)
    .lt(HttpStatuses.INTERNAL_SERVER_ERROR),
  response: z.object({ data: z.object({ error: z.string() }) }),
});

/**
 * Exchange refusals the reviewer causes and an operator cannot fix: a stale
 * code, a primary email GitHub has not verified. Every other is the App's.
 */
const REVIEWER_SIDE_EXCHANGE_ERRORS: ReadonlySet<string> = new Set([
  "bad_verification_code",
  "unverified_user_email",
]);

/** The only refresh refusal that means the reviewer's grant is gone. */
const DEAD_REFRESH_TOKEN_ERROR = "bad_refresh_token";

/** GitHub's error tokens are snake_case words; anything else is not echoed. */
const OAUTH_ERROR_TOKEN = /^[a-z][a-z0-9_]{0,63}$/;
const UNRECOGNIZED_OAUTH_ERROR = "unrecognized";

/** GitHub's OAuth `error` token from a thrown answer; `undefined` for transport. */
function readOAuthErrorBody(error: unknown): string | undefined {
  const parsed = oauthErrorBodySchema.safeParse(error);
  if (!parsed.success) {
    return undefined;
  }
  const token = parsed.data.response.data.error;
  if (!OAUTH_ERROR_TOKEN.test(token)) {
    return UNRECOGNIZED_OAUTH_ERROR;
  }
  return token;
}

function failClientMisconfigured(
  oauthError: string,
): Result<never, OAuthError> {
  return {
    ok: false,
    error: {
      code: OAuthErrorCodes.CLIENT_MISCONFIGURED,
      message: "GitHub refused the App's OAuth credentials or settings",
      oauthError,
    },
  };
}

/**
 * Rotate an expiring user token. GitHub refresh tokens are single-use: success
 * invalidates `input.refreshToken` and returns a fresh pair.
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
  } catch (error) {
    const oauthError = readOAuthErrorBody(error);
    if (oauthError === DEAD_REFRESH_TOKEN_ERROR) {
      return {
        ok: false,
        error: {
          code: OAuthErrorCodes.REFRESH_TOKEN_REJECTED,
          message: "GitHub rejected the refresh token",
        },
      };
    }
    if (oauthError !== undefined) {
      return failClientMisconfigured(oauthError);
    }
    // octokit turns a 2xx's missing `expires_in` into an Invalid Date and
    // throws RangeError: GitHub answered with a token that never expires.
    if (error instanceof RangeError) {
      return failExpirationNotEnabled();
    }
    return {
      ok: false,
      error: {
        code: OAuthErrorCodes.REFRESH_UNAVAILABLE,
        message: "GitHub did not answer the token refresh",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// User-token REST reads. Failures are sanitized via `mapRequestError`.
// ---------------------------------------------------------------------------

const userResponseSchema = z.object({
  id: z.number().int(),
  login: z.string().min(1),
});

/** The account a user token belongs to. */
export interface AuthenticatedUser {
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin: string;
}

/**
 * Resolve the authenticated reviewer for a user access token, branding the
 * numeric id. An ill-shaped 2xx body or non-positive id fails the parse.
 */
export function fetchAuthenticatedUser(
  accessToken: string,
): Promise<Result<AuthenticatedUser, GitHubApiError>> {
  return requestAuthenticatedUser(new Octokit({ auth: accessToken }));
}

/** `fetchAuthenticatedUser` on a client the caller built and tuned. */
export async function requestAuthenticatedUser(
  octokit: Octokit,
  signal?: AbortSignal,
): Promise<Result<AuthenticatedUser, GitHubApiError>> {
  const requestOptions: { request?: { signal: AbortSignal } } = {};
  if (signal !== undefined) {
    requestOptions.request = { signal };
  }
  try {
    const response = await octokit.request("GET /user", requestOptions);
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
    return {
      ok: false,
      error: mapRequestError(error, "fetch authenticated user"),
    };
  }
}

/**
 * One app installation reachable to the authenticated user. The numeric id is
 * rename-proof; the account login serves display only.
 */
export interface UserInstallation {
  readonly installationId: InstallationId;
  readonly accountLogin: string;
}

const USER_INSTALLATIONS_PAGE_SIZE = 100;

// `account` is a user or organization (`login`), an enterprise (`slug`), or
// null once the target is gone; the id is what authorization keys on, so no
// account shape may fail the whole walk.
const installationAccountSchema = z
  .union([
    z.object({ login: z.string().min(1) }),
    z.object({ slug: z.string().min(1) }),
  ])
  .nullable();

// `paginate` follows the Link header to exhaustion and flattens the
// `installations`-wrapped pages into one item array.
const userInstallationsPageSchema = z.array(
  z.object({
    id: z.number().int(),
    account: installationAccountSchema,
  }),
);

type InstallationAccount = z.infer<typeof installationAccountSchema>;

/** Display name for the installation's target; the numeric id is the fallback. */
function deriveAccountLogin(account: InstallationAccount, id: number): string {
  if (account === null) {
    return String(id);
  }
  if ("login" in account) {
    return account.login;
  }
  return account.slug;
}

/**
 * The installations reachable to the VIEWER token, ids plus account logins.
 * The Inbox walks this set on every list; nothing stores it.
 */
export function listUserInstallations(
  accessToken: string,
): Promise<Result<UserInstallation[], GitHubApiError>> {
  return fetchUserInstallations(new Octokit({ auth: accessToken }));
}

/** `listUserInstallations` on a client the caller built and tuned. */
export async function fetchUserInstallations(
  octokit: Octokit,
): Promise<Result<UserInstallation[], GitHubApiError>> {
  try {
    const items: unknown = await octokit.paginate("GET /user/installations", {
      per_page: USER_INSTALLATIONS_PAGE_SIZE,
    });
    const parsed = userInstallationsPageSchema.safeParse(items);
    if (!parsed.success) {
      return {
        ok: false,
        error: unexpectedResponseError("list user installations"),
      };
    }
    const result: UserInstallation[] = [];
    for (const installation of parsed.data) {
      const id = BigInt(installation.id);
      if (!isInstallationId(id)) {
        return {
          ok: false,
          error: unexpectedResponseError("list user installations"),
        };
      }
      result.push({
        installationId: id,
        accountLogin: deriveAccountLogin(installation.account, installation.id),
      });
    }
    return { ok: true, value: result };
  } catch (error) {
    return {
      ok: false,
      error: mapRequestError(error, "list user installations"),
    };
  }
}

/**
 * A thin user-scoped `Octokit` for an access token, exposed so the viewer
 * authorization gate reuses the same construction.
 */
export interface UserOctokitOptions {
  /** False only where no GitHub is on the other end, such as a test stub. */
  readonly throttle?: boolean;
  /** False on a mutation path: a replayed mutation is a second mutation. */
  readonly retry?: boolean;
  /** The longest rate-limit wait honoured; a longer one fails the call. */
  readonly maxRetryAfterSeconds?: number;
  readonly fetch?: typeof fetch;
}

export function createUserOctokit(
  accessToken: string,
  options: UserOctokitOptions = {},
): Octokit {
  // Same permanent-status retry tuning as the App's installation clients,
  // notably 406 (diff too large): the read API's diff proxy must fail fast to
  // its 413 mapping, not retry an unrenderable span.
  // The throttle id keys every octokit limiter group, not only the write
  // queue (one mutation per second, GraphQL included): without it every
  // viewer shares one queue, with it the global cap of ten concurrent calls
  // is per token too, which is the ceiling GitHub itself meters per user.
  // `throttle` shallow-replaces octokit's defaults, so the handlers ride too.
  const onLimit = createRateLimitHandler(options.maxRetryAfterSeconds);
  const octokitOptions: OctokitOptions = {
    auth: accessToken,
    retry: options.retry === false ? { enabled: false } : retryOptions(),
    throttle: {
      enabled: options.throttle ?? true,
      id: deriveThrottleKey(accessToken),
      onRateLimit: onLimit,
      onSecondaryRateLimit: onLimit,
    },
  };
  if (options.fetch !== undefined) {
    octokitOptions.request = { fetch: options.fetch };
  }
  return new Octokit(octokitOptions);
}

/** The seam a host injects, so a test swaps the client without mocking this package. */
export type UserOctokitFactory = typeof createUserOctokit;

type OctokitOptions = NonNullable<ConstructorParameters<typeof Octokit>[0]>;

/** A stable per-token limiter key that never carries the token itself. */
export function deriveThrottleKey(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

interface ThrottledRequest {
  readonly request: { readonly retryCount: number };
}

export type RateLimitHandler = (
  retryAfter: number,
  options: ThrottledRequest,
) => boolean;

/**
 * octokit's own default, honour retry-after once and then give up, except
 * that a wait past `maxRetryAfterSeconds` is not honoured at all.
 */
export function createRateLimitHandler(
  maxRetryAfterSeconds?: number,
): RateLimitHandler {
  return (retryAfter, options) => {
    const pastCap =
      maxRetryAfterSeconds !== undefined && retryAfter > maxRetryAfterSeconds;
    if (pastCap) {
      return false;
    }
    return options.request.retryCount === 0;
  };
}
