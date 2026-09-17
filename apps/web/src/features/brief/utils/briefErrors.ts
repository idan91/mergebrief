// The local-brief path's error boundary vocabulary. Server-function rejections
// cross to an unauthenticated browser carrying the Error's own message, so a raw
// ENOENT would disclose the deployment's filesystem layout; server modules map
// every failure onto one of these curated strings. Client-safe, never server-only.

import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import { sanitizeErrorDetail } from "logging/sanitize";
import type { ValueOf } from "types/utils";
import { ApiError, ApiErrorCodes } from "../../../data/apiFetch";

/**
 * The closed set of CODES this path may surface to a browser. The server
 * functions throw the code; the client renders `briefError.<code>` from the
 * catalog, so the cross-boundary allowlist check stays an identity test on
 * a stable token instead of on translatable prose.
 */
export const LocalBriefErrorCodes = {
  /** No artifact for that id, the browser gets a 404-shaped sentence. */
  NOT_FOUND: "not-found",
  /** The id itself failed the charset guard (never echoed back). */
  INVALID_ID: "invalid-id",
  UNREADABLE: "unreadable",
  UNEXPECTED: "unexpected",
  UNAUTHENTICATED: "unauthenticated",
  DISABLED: "local-briefs-disabled",
} as const;
export type LocalBriefErrorCode = ValueOf<typeof LocalBriefErrorCodes>;

/**
 * The URL-box generation path's own closed set. Separate map, same rule:
 * `generate.server.ts` throws these exact codes and the boundary passes only
 * these through. A bad PR URL gets a curated sentence too, since `parsePrUrl`
 * reflects the whole pasted string, which must not reach a `role="alert"`.
 */
export const GenerateErrorCodes = {
  NOT_A_PR_URL: "not-a-pr-url",
  URL_TOO_LONG: "url-too-long",
  NO_GH_CLI: "no-gh-cli",
  FETCH_FAILED: "fetch-failed",
  GENERATION_FAILED: "generation-failed",
} as const;
export type GenerateErrorCode = ValueOf<typeof GenerateErrorCodes>;

const CURATED: ReadonlySet<string> = new Set([
  ...Object.values(LocalBriefErrorCodes),
  ...Object.values(GenerateErrorCodes),
]);

/** True when `message` is a code this codebase authored for the browser. */
export function isCuratedBriefError(message: string): boolean {
  return CURATED.has(message);
}

/**
 * Clamp a generator-CONFIG message before it crosses to the browser: first line
 * only, URL-shaped substrings redacted, length capped. Upstream messages carry
 * only env-var names and config fields, but that safety is a convention and this
 * is the boundary that enforces it through the shared logging sanitizer.
 */
export function clampConfigMessage(t: TFunction, message: string): string {
  const clamped = sanitizeErrorDetail(message);
  return clamped === "" ? t("briefError.generatorConfigInvalid") : clamped;
}

export function briefErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return isCuratedBriefError(message)
    ? message
    : LocalBriefErrorCodes.UNEXPECTED;
}

const DETAIL_KEYS = {
  [LocalBriefErrorCodes.NOT_FOUND]: "briefError.not-found",
  [LocalBriefErrorCodes.INVALID_ID]: "briefError.invalid-id",
  [LocalBriefErrorCodes.UNREADABLE]: "briefError.unreadable",
  [LocalBriefErrorCodes.UNEXPECTED]: "briefError.unexpected",
  [LocalBriefErrorCodes.UNAUTHENTICATED]: "briefError.unauthenticated",
  [LocalBriefErrorCodes.DISABLED]: "briefError.local-briefs-disabled",
  [GenerateErrorCodes.NOT_A_PR_URL]: "briefError.not-a-pr-url",
  [GenerateErrorCodes.URL_TOO_LONG]: "briefError.url-too-long",
  [GenerateErrorCodes.NO_GH_CLI]: "briefError.no-gh-cli",
  [GenerateErrorCodes.FETCH_FAILED]: "briefError.fetch-failed",
  [GenerateErrorCodes.GENERATION_FAILED]: "briefError.generation-failed",
} as const satisfies Record<
  LocalBriefErrorCode | GenerateErrorCode,
  TranslationKey
>;

function isKnownDetailCode(code: string): code is keyof typeof DETAIL_KEYS {
  return Object.hasOwn(DETAIL_KEYS, code);
}

export function briefErrorDetail(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (
      error.code === ApiErrorCodes.GENERATION_CONFIG &&
      error.params !== undefined
    ) {
      return t("errors.generation-config", { detail: error.params.detail });
    }
    switch (error.code) {
      case ApiErrorCodes.NOT_A_PR_URL:
      case ApiErrorCodes.INVALID_REQUEST:
        return t("briefError.not-a-pr-url");
      case ApiErrorCodes.UNAUTHORIZED:
        return t("briefError.sessionExpired");
      case ApiErrorCodes.NOT_FOUND:
        return t("briefError.signedFetchFailed");
      default:
        return t("briefError.generation-failed");
    }
  }
  const code = briefErrorCode(error);
  return t(
    isKnownDetailCode(code) ? DETAIL_KEYS[code] : "briefError.unexpected",
  );
}
