// The local-brief path's error boundary vocabulary.
//
// Server-function rejections cross to an unauthenticated browser and TanStack
// ships the Error's own message — a raw `readFile` ENOENT would disclose the
// deployment's absolute filesystem layout to anyone guessing a brief id. So
// server modules map every failure onto one of these curated strings (the raw
// error goes to the server log and nowhere else), and error components render
// a server message only when it IS one of them.
//
// Pure and client-safe on purpose: imported from both `server/` modules and
// route error components, so it must never touch `server-only`.

import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import type { ValueOf } from "types";

/**
 * The closed set of CODES this path may surface to a browser. The server
 * functions throw the code; the client renders `briefError.<code>` from the
 * catalog — so the cross-boundary allowlist check stays an identity test on
 * a stable token instead of on translatable prose.
 */
export const BriefErrorCode = {
  /** No artifact for that id — the browser gets a 404-shaped sentence. */
  NOT_FOUND: "not-found",
  /** The id itself failed the charset guard (never echoed back). */
  INVALID_ID: "invalid-id",
  /** The artifact exists but doesn't parse / doesn't match the schema. */
  UNREADABLE: "unreadable",
  /** Anything else: the raw reason is in the server log. */
  UNEXPECTED: "unexpected",
} as const;
export type BriefErrorCode = ValueOf<typeof BriefErrorCode>;

/**
 * The URL-box generation path's own closed set. Separate map, same rule —
 * `generate.server.ts` throws these exact codes and the server-function
 * boundary passes only these through. A bad PR URL gets a curated sentence
 * too: `parsePrUrl` reflects the whole pasted string, which must not reach a
 * `role="alert"` render.
 */
export const GenerateErrorCode = {
  NOT_A_PR_URL: "not-a-pr-url",
  URL_TOO_LONG: "url-too-long",
  NO_GH_CLI: "no-gh-cli",
  FETCH_FAILED: "fetch-failed",
  GENERATION_FAILED: "generation-failed",
} as const;
export type GenerateErrorCode = ValueOf<typeof GenerateErrorCode>;

const CURATED: ReadonlySet<string> = new Set([
  ...Object.values(BriefErrorCode),
  ...Object.values(GenerateErrorCode),
]);

/** True when `message` is a code this codebase authored for the browser. */
export function isCuratedBriefError(message: string): boolean {
  return CURATED.has(message);
}

const CONFIG_MESSAGE_MAX = 300;
const URL_SHAPED = /\w+:\/\/\S+/g;

/**
 * Clamp a generator-CONFIG message before it crosses to the browser: first
 * line only, URL-shaped substrings redacted, length capped. The upstream
 * messages carry only env-var names and config fields, but that safety is a
 * convention — this is the boundary that enforces it. Mirrors
 * `clampConfigMessage` in `packages/api/src/routes/generate.ts` — the shared
 * `logging` sanitizer cannot be used here: this module is client-reachable
 * and `logging` constructs pino.
 */
export function clampConfigMessage(message: string): string {
  const clamped = (message.split("\n", 1)[0] ?? "")
    .replace(URL_SHAPED, "[redacted-url]")
    .slice(0, CONFIG_MESSAGE_MAX);
  return clamped === "" ? "generator configuration invalid" : clamped;
}

/**
 * What an error boundary on the local-brief path should render. A curated
 * message passes through; anything else — a raw Node error that escaped a
 * mapping, a framework internal — degrades to the unexpected copy rather
 * than printing server internals into the page.
 */
export function briefErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return isCuratedBriefError(message) ? message : BriefErrorCode.UNEXPECTED;
}

/**
 * The rendered sentence for an error boundary — the code's catalog copy, or
 * the unexpected line for anything unmapped.
 */
/** Code → catalog key. Explicit, so no cast is needed to reach `t`. */
const DETAIL_KEYS = {
  [BriefErrorCode.NOT_FOUND]: "briefError.not-found",
  [BriefErrorCode.INVALID_ID]: "briefError.invalid-id",
  [BriefErrorCode.UNREADABLE]: "briefError.unreadable",
  [BriefErrorCode.UNEXPECTED]: "briefError.unexpected",
  [GenerateErrorCode.NOT_A_PR_URL]: "briefError.not-a-pr-url",
  [GenerateErrorCode.URL_TOO_LONG]: "briefError.url-too-long",
  [GenerateErrorCode.NO_GH_CLI]: "briefError.no-gh-cli",
  [GenerateErrorCode.FETCH_FAILED]: "briefError.fetch-failed",
  [GenerateErrorCode.GENERATION_FAILED]: "briefError.generation-failed",
} as const satisfies Record<BriefErrorCode | GenerateErrorCode, TranslationKey>;

function isKnownDetailCode(code: string): code is keyof typeof DETAIL_KEYS {
  return Object.hasOwn(DETAIL_KEYS, code);
}

export function briefErrorDetail(t: TFunction, error: unknown): string {
  const code = briefErrorCode(error);
  return t(
    isKnownDetailCode(code) ? DETAIL_KEYS[code] : "briefError.unexpected",
  );
}
