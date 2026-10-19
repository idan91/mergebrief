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

import { checkApiReadiness, handleHealthRequest } from "./server/health";
import { getServerLogger } from "./server/logger";
import { getApiTransport } from "./server/api/transport";
import { apiUnavailable, requestApi } from "./server/api/proxy";
import { isRefusedPath } from "./server/refused-paths";
import { stampRequestId } from "./server/request-id";

const logger = getServerLogger();
const NOT_FOUND_STATUS = 404;

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

const serverEntry: ServerEntry = {
  async fetch(request, requestOpts) {
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
    if (isApiPath(pathname)) {
      let transport: ReturnType<typeof getApiTransport>;
      try {
        transport = getApiTransport();
      } catch (error) {
        // A misconfigured origin. Answer 503 so GitHub redelivers later; never
        // surface the underlying reason to the caller.
        logger.error("api transport unavailable", {
          err: error,
          reqId: requestId,
        });
        return apiUnavailable(503);
      }
      // The raw request straight through: the exact bytes GitHub signed reach
      // the webhook route's HMAC check unmodified.
      return requestApi(stamped, transport);
    }
    return withNoStoreForDocuments(
      await handleStartRequest(stamped, requestOpts),
    );
  },
};

export default serverEntry;
