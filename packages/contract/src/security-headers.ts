/**
 * What both processes answer with, set only where a route has not set its own,
 * so an attachment keeps its stricter policy. `same-origin` and not
 * `no-referrer`: the latter sends `Origin: null` on a no-cors write, and the
 * session layer reads that header where `Sec-Fetch-Site` is missing.
 */
export const SECURITY_RESPONSE_HEADERS = {
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;
