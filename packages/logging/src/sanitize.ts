// Sanitizer for free-form error text that leaves the process (wire error
// params, DB error columns). Shares the log boundary's scrub vocabulary so a
// credential cannot leak through one path after being closed on the other —
// the worker's `unknown{detail}` classifier can carry a provider's own error
// prose all the way to a DB column and a browser. `file://` gets no exemption
// here: detail is never a stack, so a path in it is a leak.
import { scrubSecrets, URL_SHAPED_DETAIL } from "./scrub";

const ERROR_DETAIL_MAX = 300;

/**
 * First line only, URL- and credential-shaped substrings redacted, capped at
 * 300 chars.
 * An empty result stays empty (empty input, or a leading newline): fallback
 * copy is the caller's decision — gate on the return value, not the input.
 */
export function sanitizeErrorDetail(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return scrubSecrets(firstLine, URL_SHAPED_DETAIL).slice(0, ERROR_DETAIL_MAX);
}
