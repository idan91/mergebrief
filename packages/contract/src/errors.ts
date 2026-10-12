// The wire error contract, shared by the API that produces it and every
// client that reads it. Vocabulary only: the producing seam, its `no-store`
// posture and the `ApiError` classes stay in the API.
//
// A code needing two statuses is two codes, so `ApiErrorStatusByCode` is 1:1
// and `ApiErrorBody` is what a client can rely on being handed.
import { HttpStatuses, type HttpStatus, type ValueOf } from "types";

export const ApiErrorCodes = {
  UNAUTHORIZED: "unauthorized",
  SIGNED_OUT: "signed-out",
  INVALID_SIGNATURE: "invalid-signature",
  FORBIDDEN: "forbidden",
  GITHUB_PERMISSION: "github-permission",
  SCOPE_EXCEEDED: "scope-exceeded",
  HUMAN_ONLY: "human-only",
  NO_REPO_WRITE_ACCESS: "no-repo-write-access",
  REPO_ADMIN_ONLY: "repo-admin-only",
  ATTACHMENTS_DISABLED: "attachments-disabled",
  ATTACHMENTS_ADMIN_ONLY: "attachments-admin-only",
  NOT_FOUND: "not-found",
  INVALID_REQUEST: "invalid-request",
  ATTACHMENT_UNSUPPORTED_TYPE: "attachment-unsupported-type",
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
  SESSION_RECORD_LIMIT_REACHED: "session-record-limit-reached",
  DRAFT_PUBLISH_PENDING: "draft-publish-pending",
  DRAFT_PUBLISH_IN_DOUBT: "draft-publish-in-doubt",
  ATTACHMENT_LIMIT_REACHED: "attachment-limit-reached",
  PENDING_REVIEW_HELD: "pending-review-held",
  PR_CHANGED_SINCE_READ: "pr-changed-since-read",
  PR_REWRITTEN_SINCE_READ: "pr-rewritten-since-read",
  APP_NOT_INSTALLED: "app-not-installed",
  GITHUB_UNAVAILABLE: "github-unavailable",
  GENERATION_FAILED: "generation-failed",
  GENERATION_UNAVAILABLE: "generation-unavailable",
  GENERATION_CONFIG: "generation-config",
  ARTIFACT_UNREADABLE: "artifact-unreadable",
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
  [ApiErrorCodes.UNAUTHORIZED]: HttpStatuses.UNAUTHORIZED,
  [ApiErrorCodes.SIGNED_OUT]: HttpStatuses.UNAUTHORIZED,
  [ApiErrorCodes.INVALID_SIGNATURE]: HttpStatuses.UNAUTHORIZED,
  [ApiErrorCodes.FORBIDDEN]: HttpStatuses.FORBIDDEN,
  [ApiErrorCodes.GITHUB_PERMISSION]: HttpStatuses.FORBIDDEN,
  [ApiErrorCodes.SCOPE_EXCEEDED]: HttpStatuses.FORBIDDEN,
  [ApiErrorCodes.HUMAN_ONLY]: HttpStatuses.FORBIDDEN,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: HttpStatuses.FORBIDDEN,
  [ApiErrorCodes.REPO_ADMIN_ONLY]: HttpStatuses.FORBIDDEN,
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: HttpStatuses.FORBIDDEN,
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]: HttpStatuses.FORBIDDEN,
  [ApiErrorCodes.NOT_FOUND]: HttpStatuses.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: HttpStatuses.BAD_REQUEST,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: HttpStatuses.BAD_REQUEST,
  [ApiErrorCodes.NOT_A_PR_URL]: HttpStatuses.BAD_REQUEST,
  [ApiErrorCodes.SIGN_IN_FAILED]: HttpStatuses.BAD_REQUEST,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: HttpStatuses.PAYLOAD_TOO_LARGE,
  [ApiErrorCodes.DIFF_TOO_LARGE]: HttpStatuses.PAYLOAD_TOO_LARGE,
  [ApiErrorCodes.FILE_NOT_FOUND]: HttpStatuses.NOT_FOUND,
  [ApiErrorCodes.FILE_TOO_LARGE]: HttpStatuses.PAYLOAD_TOO_LARGE,
  [ApiErrorCodes.FILE_NOT_TEXT]: HttpStatuses.BAD_REQUEST,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: HttpStatuses.CONFLICT,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: HttpStatuses.CONFLICT,
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: HttpStatuses.CONFLICT,
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]: HttpStatuses.CONFLICT,
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]: HttpStatuses.CONFLICT,
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]: HttpStatuses.CONFLICT,
  [ApiErrorCodes.ATTACHMENT_LIMIT_REACHED]: HttpStatuses.TOO_MANY_REQUESTS,
  [ApiErrorCodes.PENDING_REVIEW_HELD]: HttpStatuses.CONFLICT,
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: HttpStatuses.CONFLICT,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: HttpStatuses.CONFLICT,
  [ApiErrorCodes.APP_NOT_INSTALLED]: HttpStatuses.FORBIDDEN,
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: HttpStatuses.BAD_GATEWAY,
  [ApiErrorCodes.GENERATION_FAILED]: HttpStatuses.BAD_GATEWAY,
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: HttpStatuses.SERVICE_UNAVAILABLE,
  [ApiErrorCodes.GENERATION_CONFIG]: HttpStatuses.SERVICE_UNAVAILABLE,
  [ApiErrorCodes.ARTIFACT_UNREADABLE]: HttpStatuses.INTERNAL_SERVER_ERROR,
  [ApiErrorCodes.INTERNAL_ERROR]: HttpStatuses.INTERNAL_SERVER_ERROR,
} as const satisfies Record<ApiErrorCode, HttpStatus>;

/**
 * The English line the API composes on the wire, i18next `{{param}}` syntax.
 * `test/wire-pin.test.ts` pins the catalog's `errors.<code>` equal to it, so
 * the two cannot drift.
 */
export const ApiErrorEnglishByCode = {
  [ApiErrorCodes.UNAUTHORIZED]: "unauthorized",
  [ApiErrorCodes.SIGNED_OUT]: "signed out",
  [ApiErrorCodes.INVALID_SIGNATURE]: "invalid signature",
  [ApiErrorCodes.FORBIDDEN]: "forbidden",
  [ApiErrorCodes.GITHUB_PERMISSION]: "github-permission",
  [ApiErrorCodes.SCOPE_EXCEEDED]:
    "this credential's scope does not allow this operation",
  [ApiErrorCodes.HUMAN_ONLY]: "only a signed-in reviewer can clear this",
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]:
    "your GitHub account cannot write to this repository",
  [ApiErrorCodes.REPO_ADMIN_ONLY]:
    "only a repository admin can delete a pull request's briefs",
  [ApiErrorCodes.ATTACHMENTS_DISABLED]:
    "attachments are disabled for this repository",
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]:
    "only a repository admin can delete its attachment branch",
  [ApiErrorCodes.NOT_FOUND]: "not found",
  [ApiErrorCodes.INVALID_REQUEST]: "invalid request",
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]:
    "attachment type is not supported",
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
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]:
    "this review already holds a record for every item in the brief",
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]:
    "this comment is being posted to github",
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]:
    "this comment may have reached github, which could not be confirmed",
  [ApiErrorCodes.ATTACHMENT_LIMIT_REACHED]:
    "attachment limit reached, try again later",
  [ApiErrorCodes.PENDING_REVIEW_HELD]:
    "an unsubmitted review of yours is open on GitHub for this pull request",
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]:
    "pull request changed since it was read",
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]:
    "pull request was rewritten since it was read",
  [ApiErrorCodes.APP_NOT_INSTALLED]:
    "the app is not installed for this account",
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: "github is unavailable or rate limited",
  [ApiErrorCodes.GENERATION_FAILED]: "generation failed",
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: "url generation unavailable",
  [ApiErrorCodes.GENERATION_CONFIG]: "{{detail}}",
  [ApiErrorCodes.ARTIFACT_UNREADABLE]: "artifact unreadable",
  [ApiErrorCodes.INTERNAL_ERROR]: "internal error",
} as const satisfies Record<ApiErrorCode, string>;
