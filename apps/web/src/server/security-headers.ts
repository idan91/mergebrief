import { SECURITY_RESPONSE_HEADERS } from "contract";

/** A header the response already carries wins: an attachment's policy is stricter. */
export function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }
}

/** A copy, because a response from the framework may hold immutable headers. */
export function copyWithSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
