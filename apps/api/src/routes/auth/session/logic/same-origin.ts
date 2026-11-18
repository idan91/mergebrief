// A cookie rides on every request the browser sends, whoever built it, so a
// cookie principal on a state-changing method must prove the request came
// from this instance's own origin. `Sec-Fetch-Site` is the browser's own
// verdict; `Origin` is the fallback it always sends on an unsafe method. A
// sibling subdomain on the same apex is `same-site`, never `same-origin`, and
// carries its own `Origin`, which is what the check refuses. Absent both, the
// request fails closed: a browser never omits them on an unsafe method.

/** The two headers the decision reads; both absent on a non-browser client. */
export interface RequestOriginHeaders {
  readonly origin?: string | undefined;
  readonly secFetchSite?: string | undefined;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SEC_FETCH_SITE_SAME_ORIGIN = "same-origin";

const ORIGIN_HEADER = "origin";
const SEC_FETCH_SITE_HEADER = "sec-fetch-site";

/** The two headers off a request, in the shape the decision reads. */
export function readOriginHeaders(request: {
  header(name: string): string | undefined;
}): RequestOriginHeaders {
  return {
    origin: request.header(ORIGIN_HEADER),
    secFetchSite: request.header(SEC_FETCH_SITE_HEADER),
  };
}

/** The origin `PUBLIC_BASE_URL` names; throws on a value that is not a URL. */
export function resolveAllowedOrigin(publicBaseUrl: string): string {
  return new URL(publicBaseUrl).origin;
}

/** A method that never changes state, so it needs no origin proof. */
export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/** Whether the request provably came from `allowedOrigin`. */
export function isSameOriginRequest(
  headers: RequestOriginHeaders,
  allowedOrigin: string,
): boolean {
  if (headers.secFetchSite === SEC_FETCH_SITE_SAME_ORIGIN) {
    return true;
  }
  return headers.origin !== undefined && headers.origin === allowedOrigin;
}
