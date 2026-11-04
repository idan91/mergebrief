// Custom TanStack Start server entry: TanStack Start resolves `src/server.ts`
// as the server entry. `/api/*`, the app's ONE registered namespace with OAuth
// and auth management included, is proxied to the API process; the
// server-function transport and malformed paths answer 404; every other path
// falls through to Start's default page handler.
//
// Not `createServerFn`: that is RPC framing, whereas GitHub POSTs a raw
// HMAC-signed body that must reach the webhook route byte-for-byte.
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import type { ServerEntry } from "@tanstack/react-start/server-entry";
import { nameRequestSpan } from "logging";

import { checkApiReadiness, handleHealthRequest } from "./server/health";
import { getServerLogger } from "./server/logger";
import { getApiTransport } from "./server/api/transport";
import { compressDiffReply } from "./server/api/compression";
import { apiUnavailable, requestApi } from "./server/api/proxy";
import { answerInternalError } from "./server/json-answer";
import { isRefusedPath } from "./server/refused-paths";
import { stampRequestId } from "./server/request-id";
import { copyWithSecurityHeaders } from "./server/security-headers";

const logger = getServerLogger();
const NOT_FOUND_STATUS = 404;
/** The web tier's two routes in a trace; `url.path` keeps the real path. */
const API_PROXY_ROUTE = "/api/*";
const PAGE_ROUTE = "/*";

/** Start's default page/SSR + server-function handler (the framework fallthrough). */
const handleStartRequest = createStartHandler(defaultStreamHandler);

/** Paths the API process serves rather than the page router. */
function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/**
 * Stamp `cache-control: no-store` on SSR'd HTML documents: they embed
 * authz-gated, per-viewer data that must never land in a shared proxy/CDN
 * cache. Non-HTML assets keep their own caching.
 */
function withNoStoreForDocuments(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function proxyToApi(
  stamped: Request,
  requestId: string,
): Promise<Response> {
  let transport: ReturnType<typeof getApiTransport>;
  try {
    transport = getApiTransport();
  } catch (error) {
    // A misconfigured origin. Never surface the underlying reason to the caller.
    logger.error("api transport unavailable", {
      err: error,
      reqId: requestId,
    });
    return apiUnavailable(503);
  }
  // The raw request straight through: the exact bytes GitHub signed reach
  // the webhook route's HMAC check unmodified. Only this browser hop
  // compresses: an SSR read consumes its Response in process, undecoded.
  const reply = await requestApi(stamped, transport);
  return compressDiffReply(stamped, reply);
}

async function answerRequest(
  request: Request,
  requestOpts: Parameters<ServerEntry["fetch"]>[1],
): Promise<Response> {
  const { pathname } = new URL(request.url);
  // Health surface answered BEFORE the API branch and the page router, so
  // it stays reachable even if router init throws. Unauthenticated JSON.
  const health = await handleHealthRequest(pathname, {
    checkReadiness: checkApiReadiness,
  });
  if (health !== undefined) {
    return health;
  }
  if (isRefusedPath(pathname)) {
    return new Response(null, { status: NOT_FOUND_STATUS });
  }
  // Every request past health gets the id its API calls carry, the proxied
  // one and each SSR read alike.
  const requestId = crypto.randomUUID();
  const stamped = stampRequestId(request, requestId);
  try {
    if (isApiPath(pathname)) {
      nameRequestSpan(request.method, API_PROXY_ROUTE);
      return await proxyToApi(stamped, requestId);
    }
    nameRequestSpan(request.method, PAGE_ROUTE);
    const page = await handleStartRequest(stamped, requestOpts);
    return withNoStoreForDocuments(page);
  } catch (error) {
    logger.error("web request failed", { err: error, reqId: requestId });
    return answerInternalError();
  }
}

const serverEntry: ServerEntry = {
  async fetch(request, requestOpts) {
    const response = await answerRequest(request, requestOpts);
    return copyWithSecurityHeaders(response);
  },
};

export default serverEntry;
