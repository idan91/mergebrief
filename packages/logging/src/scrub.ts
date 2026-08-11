// The content-scrub vocabulary, shared by the log boundary and the
// error-detail sanitizer so the two can never drift. Key-path redaction sees
// only secrets we hold and NAME; these patterns cover secrets embedded in
// prose we do not control — a provider's own error text quoting the key it
// rejected. Extending either list is non-breaking; narrowing one needs a
// decision-record amendment.

/**
 * `file://` is EXEMPT for log output only: consumers are ESM, so redacting it
 * would erase every stack frame. The `\b` keeps the lookahead from sliding one
 * character right and matching `ile://`.
 */
export const URL_SHAPED_LOG = /\b(?!file:\/\/)\w+:\/\/\S+/g;

/** No exemption: error DETAIL is never a stack, so a file:// path is a leak. */
export const URL_SHAPED_DETAIL = /\w+:\/\/\S+/g;

/**
 * Credential-shaped substrings, matched by ISSUER PREFIX rather than by
 * entropy — a prefix match cannot swallow ordinary prose, which an entropy
 * heuristic would.
 */
export const TOKEN_SHAPED =
  /\b(?:sk-ant-[\w-]+|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|mergebrief_[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,})/g;

export const REDACTED_URL = "[redacted-url]";
export const REDACTED_TOKEN = "[redacted-token]";

/** Scrub both families out of one string. */
export function scrubSecrets(text: string, urlPattern: RegExp): string {
  return text
    .replace(urlPattern, REDACTED_URL)
    .replace(TOKEN_SHAPED, REDACTED_TOKEN);
}
