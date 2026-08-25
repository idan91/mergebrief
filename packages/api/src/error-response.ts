// The ONE producer of error-response bodies: every expected failure on the
// HTTP surface exits as a thrown `ApiError` class and renders through
// `buildErrorResponse` (the `onError` seam), so the wire shape
// `{ error, code, params? }`, the code→status pairing, and the `no-store`
// posture cannot drift per route. Security collapses (uniform-404, single
// invalid-request bucket) happen at the per-route handlers BEFORE this
// module — a code here is already the public posture, never the internal
// cause. `errorJson` survives only for the wire suite that pins the shape.
import type { Context } from "hono";
import type { ValueOf } from "types";

declare module "hono" {
  interface ContextVariableMap {
    /** The wire code of the error this request answered with — the audit
     * emit's default denial reason. Set here so no route has to remember. */
    apiErrorCode?: string;
  }
}

export const ApiErrorCodes = {
  UNAUTHORIZED: "unauthorized",
  INVALID_SIGNATURE: "invalid-signature",
  FORBIDDEN: "forbidden",
  GITHUB_PERMISSION: "github-permission",
  SCOPE_EXCEEDED: "scope-exceeded",
  HUMAN_ONLY: "human-only",
  NO_REPO_WRITE_ACCESS: "no-repo-write-access",
  NOT_FOUND: "not-found",
  INVALID_REQUEST: "invalid-request",
  NOT_A_PR_URL: "not-a-pr-url",
  SIGN_IN_FAILED: "sign-in-failed",
  REQUEST_TOO_LARGE: "request-too-large",
  DIFF_TOO_LARGE: "diff-too-large",
  DRAFT_ALREADY_PUBLISHED: "draft-already-published",
  DRAFT_ANCHOR_ORPHANED: "draft-anchor-orphaned",
  DRAFT_LIMIT_REACHED: "draft-limit-reached",
  PR_CHANGED_SINCE_READ: "pr-changed-since-read",
  PR_REWRITTEN_SINCE_READ: "pr-rewritten-since-read",
  APP_NOT_INSTALLED: "app-not-installed",
  GITHUB_UNAVAILABLE: "github-unavailable",
  GENERATION_FAILED: "generation-failed",
  GENERATION_UNAVAILABLE: "generation-unavailable",
  GENERATION_CONFIG: "generation-config",
  INTERNAL_ERROR: "internal-error",
} as const;
export type ApiErrorCode = ValueOf<typeof ApiErrorCodes>;

/** Frozen-suite alias — dies with the wire-pin shims. */
export const ApiErrorCode = ApiErrorCodes;

/**
 * Codes that carry interpolation params, typed per code. Adding params to a
 * code is additive; a param value is never free-form upstream text unless
 * pre-sanitized (`sanitizeErrorDetail`) by the producing route.
 */
export interface ApiErrorParams {
  [ApiErrorCodes.GENERATION_CONFIG]: { readonly detail: string };
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
  [ApiErrorCodes.UNAUTHORIZED]: 401,
  [ApiErrorCodes.INVALID_SIGNATURE]: 401,
  [ApiErrorCodes.FORBIDDEN]: 403,
  [ApiErrorCodes.GITHUB_PERMISSION]: 403,
  [ApiErrorCodes.SCOPE_EXCEEDED]: 403,
  [ApiErrorCodes.HUMAN_ONLY]: 403,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: 403,
  [ApiErrorCodes.NOT_FOUND]: 404,
  [ApiErrorCodes.INVALID_REQUEST]: 400,
  [ApiErrorCodes.NOT_A_PR_URL]: 400,
  [ApiErrorCodes.SIGN_IN_FAILED]: 400,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: 413,
  [ApiErrorCodes.DIFF_TOO_LARGE]: 413,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: 409,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: 409,
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: 409,
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: 409,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: 409,
  [ApiErrorCodes.APP_NOT_INSTALLED]: 403,
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: 502,
  [ApiErrorCodes.GENERATION_FAILED]: 502,
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: 503,
  [ApiErrorCodes.GENERATION_CONFIG]: 503,
  [ApiErrorCodes.INTERNAL_ERROR]: 500,
} as const satisfies Record<ApiErrorCode, number>;

/**
 * The code→English template map, i18next `{{param}}` syntax. Exported
 * MIRROR-ONLY: `packages/i18n`'s suite pins `errors.<code>` equality against
 * it; no route behavior may depend on the export.
 */
export const API_ERROR_ENGLISH = {
  [ApiErrorCodes.UNAUTHORIZED]: "unauthorized",
  [ApiErrorCodes.INVALID_SIGNATURE]: "invalid signature",
  [ApiErrorCodes.FORBIDDEN]: "forbidden",
  [ApiErrorCodes.GITHUB_PERMISSION]: "github-permission",
  [ApiErrorCodes.SCOPE_EXCEEDED]:
    "this credential's scope does not allow this operation",
  [ApiErrorCodes.HUMAN_ONLY]: "only a signed-in reviewer can clear this",
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]:
    "your GitHub account cannot write to this repository",
  [ApiErrorCodes.NOT_FOUND]: "not found",
  [ApiErrorCodes.INVALID_REQUEST]: "invalid request",
  [ApiErrorCodes.NOT_A_PR_URL]: "not a pr url",
  [ApiErrorCodes.SIGN_IN_FAILED]: "sign-in failed",
  [ApiErrorCodes.REQUEST_TOO_LARGE]: "request body too large",
  [ApiErrorCodes.DIFF_TOO_LARGE]: "diff too large to render",
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]:
    "this draft has already been published to github",
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]:
    "this review holds a comment whose anchor no longer points at any code",
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]:
    "this review already holds as many unposted comments as it can carry",
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]:
    "pull request changed since it was read",
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]:
    "pull request was rewritten since it was read",
  [ApiErrorCodes.APP_NOT_INSTALLED]:
    "the app is not installed for this account",
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: "upstream error",
  [ApiErrorCodes.GENERATION_FAILED]: "generation failed",
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: "url generation unavailable",
  [ApiErrorCodes.GENERATION_CONFIG]: "{{detail}}",
  [ApiErrorCodes.INTERNAL_ERROR]: "internal error",
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
  return buildErrorResponse(c, code, params);
}

/**
 * The producing seam `app.onError` calls — an `ApiError` class has already
 * proven the code/params pairing by construction.
 */
export function buildErrorResponse(
  c: Context,
  code: ApiErrorCode,
  params: ApiErrorParams[ParamCode] | undefined,
): Response {
  const base = { error: composeEnglish(code, params), code };
  const body = params === undefined ? base : { ...base, params };
  c.set("apiErrorCode", code);
  return c.json(body, API_ERROR_STATUS[code], NO_STORE);
}
