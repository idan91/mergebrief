// The API runs as its own process on a port that is not published. The browser
// loads the page from the web server, so it calls `/api/...` on that origin.
// This module passes those calls to the API and returns the answer unchanged.
// One origin keeps the session cookie first-party and needs no CORS setup, and
// the target is `MERGEBRIEF_API_ORIGIN`, so the API can move hosts freely.
//
// Two callers: the server entry for a browser request, and the SSR branch of
// `data/apiFetch`, which forwards the viewer's cookie so a render is gated the
// same way the browser would be.
import "@tanstack/react-start/server-only";

/**
 * Headers scoped to one hop. Forwarding them would describe the browser's
 * connection to the web tier, not the web tier's to the API. `host` goes so
 * fetch addresses the internal origin, and `accept-encoding` is replaced
 * rather than dropped: fetch supplies its own if none is set, and a compressed
 * hop buys nothing on a loopback or private-network link. The three
 * caller-address claims go too: the API reads the socket, never a header, and
 * a forwarded one would be a client-settable value sitting next to it.
 */
const REQUEST_HEADERS_DROPPED = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "forwarded",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-real-ip",
]);

/** The same reasoning on the way back, plus the length fetch recomputes. */
const RESPONSE_HEADERS_DROPPED = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

/** Methods that never carry a body, so the stream is not attached. */
const BODILESS_METHODS = new Set(["GET", "HEAD"]);

export interface ApiTransportDeps {
  /** The trusted internal origin; never derived from request input. */
  readonly origin: string;
  readonly fetch: typeof globalThis.fetch;
  readonly logger: {
    error(msg: string, fields?: Record<string, unknown>): void;
  };
  /** Upstream budget for one request. */
  readonly timeoutMs: number;
  /** Budget for the review submit POST, which posts one thread per draft. */
  readonly submitTimeoutMs: number;
  /** Budget for an image upload POST: the bytes on a slow link, then the push. */
  readonly uploadTimeoutMs: number;
}

const REVIEW_SUBMIT_PATH = /^\/api\/repos\/[^/]+\/pulls\/\d+\/review$/;
const ATTACHMENT_UPLOAD_PATH = /^\/api\/repos\/[^/]+\/pulls\/\d+\/attachments$/;

/** Two routes' upstream time grows with the payload: the submit and the upload. */
function resolveUpstreamBudget(
  request: Request,
  deps: ApiTransportDeps,
): number {
  if (request.method.toUpperCase() !== "POST") {
    return deps.timeoutMs;
  }
  const { pathname } = new URL(request.url);
  if (REVIEW_SUBMIT_PATH.test(pathname)) {
    return deps.submitTimeoutMs;
  }
  if (ATTACHMENT_UPLOAD_PATH.test(pathname)) {
    return deps.uploadTimeoutMs;
  }
  return deps.timeoutMs;
}

function forwardedRequestHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of source) {
    if (REQUEST_HEADERS_DROPPED.has(name.toLowerCase())) {
      continue;
    }
    headers.append(name, value);
  }
  // Explicit, because fetch adds one otherwise: an encoded hop would arrive
  // decoded with its `content-encoding` still attached, describing the bytes
  // wrongly on the way back.
  headers.set("accept-encoding", "identity");
  return headers;
}

/**
 * Rebuild the response headers. `Set-Cookie` is read through `getSetCookie`
 * and appended one by one: iterating a `Headers` joins repeated cookies into
 * one line, which a browser reads as a single malformed cookie.
 */
function forwardedResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (lower === "set-cookie") {
      continue;
    }
    if (RESPONSE_HEADERS_DROPPED.has(lower)) {
      continue;
    }
    headers.append(name, value);
  }
  for (const cookie of source.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return headers;
}

/** The one sanitized body both the proxy and the SSR path answer with. */
export function apiUnavailable(status: number): Response {
  return new Response(JSON.stringify({ error: "service unavailable" }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

interface UpstreamRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function buildUpstreamRequest(
  request: Request,
  deps: ApiTransportDeps,
  signal: AbortSignal,
): UpstreamRequest {
  const incoming = new URL(request.url);
  // Path and query ride verbatim: they are already encoded, and re-encoding
  // would change what the API matches on.
  const target = `${deps.origin}${incoming.pathname}${incoming.search}`;
  const init: RequestInit = {
    method: request.method,
    headers: forwardedRequestHeaders(request.headers),
    // Manual: an OAuth 302 belongs to the browser, and following it here would
    // both hide the redirect and re-issue the request against another origin.
    redirect: "manual",
    signal,
  };
  if (!BODILESS_METHODS.has(request.method.toUpperCase())) {
    // The stream, not a re-encode: the webhook route verifies its HMAC over
    // the exact bytes GitHub signed.
    const streaming: RequestInit & { duplex: "half" } = {
      ...init,
      body: request.body,
      duplex: "half",
    };
    return { url: target, init: streaming };
  }
  return { url: target, init };
}

/**
 * One request to the API. A connection failure and a timeout are the web
 * tier's own answers, sanitized to the same body the API's own error posture
 * would use; the caller's disconnect is answered without touching the API
 * again. Nothing is ever retried, because a retried mutation is a second
 * mutation.
 */
export async function requestApi(
  request: Request,
  deps: ApiTransportDeps,
): Promise<Response> {
  const timeout = AbortSignal.timeout(resolveUpstreamBudget(request, deps));
  const signal = AbortSignal.any([request.signal, timeout]);
  const upstream = buildUpstreamRequest(request, deps, signal);

  let response: Response;
  try {
    response = await deps.fetch(upstream.url, upstream.init);
  } catch (error) {
    if (request.signal.aborted) {
      // The caller went away; answering at all is a formality.
      return apiUnavailable(499);
    }
    // The reason can quote the internal origin, so it rides as a FIELD: the
    // logging boundary redacts URL-shaped substrings, `msg` bypasses it.
    logUpstreamFailure(deps, error, timeout.aborted);
    return apiUnavailable(timeout.aborted ? 504 : 503);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: forwardedResponseHeaders(response.headers),
  });
}

function logUpstreamFailure(
  deps: ApiTransportDeps,
  error: unknown,
  timedOut: boolean,
): void {
  const { logger } = deps;
  logger.error(timedOut ? "api request timed out" : "api request failed", {
    err: error,
  });
}
