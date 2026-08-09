// Custom TanStack Start server entry: TanStack Start resolves `src/server.ts`
// as the server entry. `/api/*` — the app's ONE registered namespace, OAuth and
// auth management included — is handed to `honoApp.fetch`; every other path
// falls through to Start's default page handler.
//
// Not `createServerFn`: that is RPC framing, whereas GitHub POSTs a raw
// HMAC-signed body that must reach the webhook route byte-for-byte.
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import type { ServerEntry } from "@tanstack/react-start/server-entry";

import { handleHealthRequest } from "./server/health";
import { getServerLogger } from "./server/logger";
import { checkReadiness, getWebhookApp } from "./server/webhookApp";

const logger = getServerLogger();

/** Start's default page/SSR + server-function handler (the framework fallthrough). */
const handleStartRequest = createStartHandler(defaultStreamHandler);

/** Paths served by the Hono app rather than the page router. */
function isHonoPath(pathname: string): boolean {
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
    // Health surface answered BEFORE the Hono branch and the page router, so
    // it stays reachable even if router init throws. Unauthenticated JSON.
    const health = await handleHealthRequest(pathname, { checkReadiness });
    if (health !== undefined) {
      return health;
    }
    if (isHonoPath(pathname)) {
      let app: Awaited<ReturnType<typeof getWebhookApp>>;
      try {
        app = await getWebhookApp();
      } catch (error) {
        // Composition failed (misconfig / Postgres down). Answer 503 so GitHub
        // redelivers later; never surface the underlying error to the caller.
        logger.error("webhook app composition failed", { err: error });
        return new Response(JSON.stringify({ error: "service unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      // Raw request straight through — the exact bytes GitHub signed reach the
      // webhook route's HMAC check unmodified (no re-encode, no RPC wrapper).
      return app.fetch(request);
    }
    return withNoStoreForDocuments(
      await handleStartRequest(request, requestOpts),
    );
  },
};

export default serverEntry;
