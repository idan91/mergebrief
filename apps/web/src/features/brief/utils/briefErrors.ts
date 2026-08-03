// The local-brief path's error boundary vocabulary (BRIEF-20 error-leak
// sweep; the BRIEF-97 cause-leak family).
//
// WHY: server-function rejections cross to an unauthenticated browser, and
// TanStack's serializer ships the Error's own message. Node's own errors are
// generous with detail a browser has no business seeing — `readFile` on a
// missing brief throws `ENOENT: no such file or directory, open
// '/app/tools/categorizer/out/<id>.delta.json'`, disclosing the deployment's
// absolute filesystem layout to anyone who guesses a brief id.
//
// THE RULE: server modules map every failure onto one of these curated
// strings (the raw error goes to the server log and nowhere else), and the
// route error components render a server message only when it IS one of
// them. Both halves matter — the allowlist is what keeps a message that
// escapes some future code path from reaching the page.
//
// Pure and client-safe on purpose: this module is imported from both the
// `server/` modules and the route error components, so it must never touch
// `server-only` (import-protection would break the client build).

import type { ValueOf } from "types";

/**
 * The closed set of messages this path may show a browser. Values are COPY,
 * not vocabulary — the kebab-case value rule covers domain vocabularies, and
 * these strings are rendered verbatim.
 */
export const BriefErrorMessage = {
  /** No artifact for that id — the browser gets a 404-shaped sentence. */
  NOT_FOUND: "That brief isn't on this instance.",
  /** The id itself failed the charset guard (never echoed back). */
  INVALID_ID: "That brief link isn't valid.",
  /** The artifact exists but doesn't parse / doesn't match the schema. */
  UNREADABLE: "That brief's files are unreadable — regenerate it.",
  /** Anything else: the raw reason is in the server log. */
  UNEXPECTED:
    "Something went wrong reading this brief — check the server logs.",
} as const;
export type BriefErrorMessage = ValueOf<typeof BriefErrorMessage>;

/**
 * The URL-box generation path's own closed set (BRIEF-97 copy, allowlisted
 * here by BRIEF-20). Separate map, same rule — `generate.server.ts` throws
 * these exact strings and the server-function boundary passes only these
 * through. A bad PR URL gets a curated sentence too: `parsePrUrl` reflects
 * the whole pasted string, which must not reach a `role="alert"` render.
 */
export const GenerateErrorMessage = {
  NOT_A_PR_URL:
    "That doesn't look like a GitHub pull request URL — expected https://github.com/<owner>/<repo>/pull/<number>.",
  URL_TOO_LONG: "That URL is too long to be a GitHub pull request link.",
  NO_GH_CLI:
    "This deployment has no gh CLI — sign in with GitHub to generate with your account.",
  FETCH_FAILED:
    "Couldn't fetch this PR — is it public, and are you `gh auth login`'d?",
  GENERATION_FAILED:
    "Couldn't generate the brief for this PR — check the server logs and try again.",
} as const;
export type GenerateErrorMessage = ValueOf<typeof GenerateErrorMessage>;

const CURATED: ReadonlySet<string> = new Set([
  ...Object.values(BriefErrorMessage),
  ...Object.values(GenerateErrorMessage),
]);

/** True when `message` is one this codebase authored for the browser. */
export function isCuratedBriefError(message: string): boolean {
  return CURATED.has(message);
}

const CONFIG_MESSAGE_MAX = 300;
const URL_SHAPED = /\w+:\/\/\S+/g;

/**
 * Clamp a generator-CONFIG message before it crosses to the browser: first
 * line only, URL-shaped substrings redacted, length capped. These messages
 * are authored from ConfigError issues (env-var NAMES, config fields), so
 * they are safe BY CONSTRUCTION — but construction is a comment, not a trust
 * boundary, and this is the boundary. Mirrors `clampConfigMessage` in
 * `packages/api/src/routes/generate.ts`, which does the same for the api
 * route's 503 body.
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
export function briefErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return isCuratedBriefError(message) ? message : BriefErrorMessage.UNEXPECTED;
}
