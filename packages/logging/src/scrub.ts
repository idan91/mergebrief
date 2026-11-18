// The scrub vocabulary the log boundary and the error-detail sanitizer share,
// for secrets embedded in prose we do not control. Extending a list is
// non-breaking; narrowing one is argued in the PR.

// `file://` is exempt in logs only, or every ESM stack frame would vanish.
// The `\b` stops the lookahead sliding right and matching `ile://`.
export const URL_SHAPED_LOG = /\b(?!file:\/\/)\w+:\/\/\S+/g;

/** No exemption: error DETAIL is never a stack, so a file:// path is a leak. */
export const URL_SHAPED_DETAIL = /\w+:\/\/\S+/g;

/** Matched by issuer prefix, never entropy, so ordinary prose survives. */
export const TOKEN_SHAPED =
  /\b(?:sk-ant-[\w-]+|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|mergebrief_[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,})/g;

export const QUERY_MESSAGE_PREFIX = "Failed query: ";

const QUERY_PARAMS_LABEL = "\nparams: ";

/**
 * The password of a libpq keyword connection string, which is no URL. Matched
 * by its keyword, so it cannot join `TOKEN_SHAPED`: a reader of that list
 * reads this one too.
 */
export const KEYWORD_PASSWORD = /\b(password=)(?:'(?:[^'\\]|\\.)*'|\S+)/gi;

export const REDACTED_URL = "[redacted-url]";
export const REDACTED_TOKEN = "[redacted-token]";
export const REDACTED_PARAMS = "[redacted-params]";

/**
 * Nothing marks where a failed query's bound values end, so the cut runs
 * from `params:` to the end of the string. Two searches, never a pattern: a
 * long line of query prefixes with no params must not cost a scan each.
 */
export function redactQueryParams(text: string): string {
  const query = text.indexOf(QUERY_MESSAGE_PREFIX);
  const label = query === -1 ? -1 : text.indexOf(QUERY_PARAMS_LABEL, query);
  if (label === -1) {
    return text;
  }
  const kept = text.slice(0, label + QUERY_PARAMS_LABEL.length);
  return `${kept}${REDACTED_PARAMS}`;
}

export function scrubSecrets(text: string, urlPattern: RegExp): string {
  const withoutParams = redactQueryParams(text);
  const withoutUrls = withoutParams.replace(urlPattern, REDACTED_URL);
  const withoutPasswords = withoutUrls.replace(
    KEYWORD_PASSWORD,
    `$1${REDACTED_TOKEN}`,
  );
  return withoutPasswords.replace(TOKEN_SHAPED, REDACTED_TOKEN);
}
