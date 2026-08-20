// The ONE producer of error-response bodies: every expected failure on the
// HTTP surface exits through `errorJson`, so the wire shape
// `{ error, code, params? }`, the code→status pairing, and the `no-store`
// posture cannot drift per route. Security collapses (uniform-404, single
// invalid-request bucket) happen at the per-route mappers BEFORE this module
// — a code here is already the public posture, never the internal cause.
import type { Context } from "hono";
import type { ValueOf } from "types";

export const ApiErrorCode = {
  UNAUTHORIZED: "unauthorized",
  INVALID_SIGNATURE: "invalid-signature",
  FORBIDDEN: "forbidden",
  GITHUB_PERMISSION: "github-permission",
  SCOPE_EXCEEDED: "scope-exceeded",
  NOT_FOUND: "not-found",
  INVALID_REQUEST: "invalid-request",
  NOT_A_PR_URL: "not-a-pr-url",
  SIGN_IN_FAILED: "sign-in-failed",
  REQUEST_TOO_LARGE: "request-too-large",
  DIFF_TOO_LARGE: "diff-too-large",
  PR_CHANGED_SINCE_READ: "pr-changed-since-read",
  PR_REWRITTEN_SINCE_READ: "pr-rewritten-since-read",
  APP_NOT_INSTALLED: "app-not-installed",
  GITHUB_UNAVAILABLE: "github-unavailable",
  GENERATION_FAILED: "generation-failed",
  GENERATION_UNAVAILABLE: "generation-unavailable",
  GENERATION_CONFIG: "generation-config",
  INTERNAL_ERROR: "internal-error",
} as const;
export type ApiErrorCode = ValueOf<typeof ApiErrorCode>;

/**
 * Codes that carry interpolation params, typed per code. Adding params to a
 * code is additive; a param value is never free-form upstream text unless
 * pre-sanitized (`sanitizeErrorDetail`) by the producing route.
 */
export interface ApiErrorParams {
  [ApiErrorCode.GENERATION_CONFIG]: { readonly detail: string };
}

type ParamCode = keyof ApiErrorParams;
type ParamlessCode = Exclude<ApiErrorCode, ParamCode>;

/** The wire shape. `error` is the English line composed server-side. */
export type ApiErrorBody =
  | { readonly error: string; readonly code: ParamlessCode }
  | {
      [K in ParamCode]: {
        readonly error: string;
        readonly code: K;
        readonly params: ApiErrorParams[K];
      };
    }[ParamCode];

// 1:1 — a code needing two statuses is two codes. `app-not-installed` is 403
// from its one login site; a future non-403 site mints a new code.
export const API_ERROR_STATUS = {
  [ApiErrorCode.UNAUTHORIZED]: 401,
  [ApiErrorCode.INVALID_SIGNATURE]: 401,
  [ApiErrorCode.FORBIDDEN]: 403,
  [ApiErrorCode.GITHUB_PERMISSION]: 403,
  [ApiErrorCode.SCOPE_EXCEEDED]: 403,
  [ApiErrorCode.NOT_FOUND]: 404,
  [ApiErrorCode.INVALID_REQUEST]: 400,
  [ApiErrorCode.NOT_A_PR_URL]: 400,
  [ApiErrorCode.SIGN_IN_FAILED]: 400,
  [ApiErrorCode.REQUEST_TOO_LARGE]: 413,
  [ApiErrorCode.DIFF_TOO_LARGE]: 413,
  [ApiErrorCode.PR_CHANGED_SINCE_READ]: 409,
  [ApiErrorCode.PR_REWRITTEN_SINCE_READ]: 409,
  [ApiErrorCode.APP_NOT_INSTALLED]: 403,
  [ApiErrorCode.GITHUB_UNAVAILABLE]: 502,
  [ApiErrorCode.GENERATION_FAILED]: 502,
  [ApiErrorCode.GENERATION_UNAVAILABLE]: 503,
  [ApiErrorCode.GENERATION_CONFIG]: 503,
  [ApiErrorCode.INTERNAL_ERROR]: 500,
} as const satisfies Record<ApiErrorCode, number>;

/**
 * The code→English template map, i18next `{{param}}` syntax. Exported
 * MIRROR-ONLY: `packages/i18n`'s suite pins `errors.<code>` equality against
 * it; no route behavior may depend on the export.
 */
export const API_ERROR_ENGLISH = {
  [ApiErrorCode.UNAUTHORIZED]: "unauthorized",
  [ApiErrorCode.INVALID_SIGNATURE]: "invalid signature",
  [ApiErrorCode.FORBIDDEN]: "forbidden",
  [ApiErrorCode.GITHUB_PERMISSION]: "github-permission",
  [ApiErrorCode.SCOPE_EXCEEDED]:
    "this credential's scope does not allow this operation",
  [ApiErrorCode.NOT_FOUND]: "not found",
  [ApiErrorCode.INVALID_REQUEST]: "invalid request",
  [ApiErrorCode.NOT_A_PR_URL]: "not a pr url",
  [ApiErrorCode.SIGN_IN_FAILED]: "sign-in failed",
  [ApiErrorCode.REQUEST_TOO_LARGE]: "request body too large",
  [ApiErrorCode.DIFF_TOO_LARGE]: "diff too large to render",
  [ApiErrorCode.PR_CHANGED_SINCE_READ]:
    "pull request changed since it was read",
  [ApiErrorCode.PR_REWRITTEN_SINCE_READ]:
    "pull request was rewritten since it was read",
  [ApiErrorCode.APP_NOT_INSTALLED]: "the app is not installed for this account",
  [ApiErrorCode.GITHUB_UNAVAILABLE]: "upstream error",
  [ApiErrorCode.GENERATION_FAILED]: "generation failed",
  [ApiErrorCode.GENERATION_UNAVAILABLE]: "url generation unavailable",
  [ApiErrorCode.GENERATION_CONFIG]: "{{detail}}",
  [ApiErrorCode.INTERNAL_ERROR]: "internal error",
} as const satisfies Record<ApiErrorCode, string>;

/** Compose the server-side English line from the template + params. */
function composeEnglish(
  code: ApiErrorCode,
  params: { readonly [key: string]: string } | undefined,
): string {
  return API_ERROR_ENGLISH[code].replaceAll(
    /\{\{(\w+)\}\}/g,
    (token, name: string) => params?.[name] ?? token,
  );
}

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * Uniform `no-store` on ALL error responses — gated or not, an error body is
 * never cacheable state.
 */
export function errorJson(c: Context, code: ParamlessCode): Response;
export function errorJson<K extends ParamCode>(
  c: Context,
  code: K,
  params: ApiErrorParams[K],
): Response;
export function errorJson(
  c: Context,
  code: ApiErrorCode,
  params?: ApiErrorParams[ParamCode],
): Response {
  const body = {
    error: composeEnglish(code, params),
    code,
    ...(params === undefined ? {} : { params }),
  };
  return c.json(body, API_ERROR_STATUS[code], NO_STORE);
}
