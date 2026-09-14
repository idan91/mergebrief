// The wire error contract, shared by the API that produces it and every
// client that reads it. Vocabulary only: the producing seam, its `no-store`
// posture and the `ApiError` classes stay in the API.
//
// A code needing two statuses is two codes, so `ApiErrorStatusByCode` is 1:1
// and `ApiErrorBody` is what a client can rely on being handed.
import type { ValueOf } from "types/utils";

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
  FILE_NOT_FOUND: "file-not-found",
  FILE_TOO_LARGE: "file-too-large",
  FILE_NOT_TEXT: "file-not-text",
  DRAFT_ALREADY_PUBLISHED: "draft-already-published",
  DRAFT_ANCHOR_ORPHANED: "draft-anchor-orphaned",
  DRAFT_LIMIT_REACHED: "draft-limit-reached",
  PENDING_REVIEW_HELD: "pending-review-held",
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

/**
 * Codes that carry interpolation params, typed per code. Adding params to a
 * code is additive; a param value is never free-form upstream text unless
 * pre-sanitized (`sanitizeErrorDetail`) by the producing route.
 */
export interface ApiErrorParams {
  [ApiErrorCodes.GENERATION_CONFIG]: { readonly detail: string };
}

/** Codes whose body carries `params`, and the rest. */
export type ApiErrorParamCode = keyof ApiErrorParams;
export type ApiErrorParamlessCode = Exclude<ApiErrorCode, ApiErrorParamCode>;

/** The wire shape. `error` is the English line composed server-side. */
export type ApiErrorBody =
  | { readonly error: string; readonly code: ApiErrorParamlessCode }
  | {
      [K in ApiErrorParamCode]: {
        readonly error: string;
        readonly code: K;
        readonly params: ApiErrorParams[K];
      };
    }[ApiErrorParamCode];

// 1:1, so a code needing two statuses is two codes. `app-not-installed` is 403
// from its one login site; a future non-403 site mints a new code.
export const ApiErrorStatusByCode = {
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
  [ApiErrorCodes.FILE_NOT_FOUND]: 404,
  [ApiErrorCodes.FILE_TOO_LARGE]: 413,
  [ApiErrorCodes.FILE_NOT_TEXT]: 400,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: 409,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: 409,
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: 409,
  [ApiErrorCodes.PENDING_REVIEW_HELD]: 409,
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
 * The English line the API composes on the wire, i18next `{{param}}` syntax.
 * `test/wire-pin.test.ts` pins the catalog's `errors.<code>` equal to it, so
 * the two cannot drift.
 */
export const ApiErrorEnglishByCode = {
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
  [ApiErrorCodes.FILE_NOT_FOUND]: "file not found at this commit",
  [ApiErrorCodes.FILE_TOO_LARGE]: "file too large to expand",
  [ApiErrorCodes.FILE_NOT_TEXT]: "file is not utf-8 text",
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]:
    "this draft has already been published to github",
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]:
    "this review holds a comment whose anchor no longer points at any code",
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]:
    "this review already holds as many unposted comments as it can carry",
  [ApiErrorCodes.PENDING_REVIEW_HELD]:
    "an unsubmitted review of yours is open on GitHub for this pull request",
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
