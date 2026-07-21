// Custom TanStack Start server entry (BRIEF-2 stage 5). TanStack Start 1.168
// resolves `src/server.{ts,js}` as the server entry (overriding the framework
// default) — verified via `@tanstack/start-plugin-core`'s `resolveStartEntryPlan`
// (`defaultEntry: 'server'`). This entry mounts the webhook Hono app on the web
// origin: `/api/*` (ONE registered namespace since BRIEF-18 — OAuth + auth
// management live under `/api/auth/*`) is handed to `honoApp.fetch`; every
// other path falls through to Start's default page handler, so `/` and
// `/briefs/*` are untouched.
//
// We do NOT use `createServerFn` here: that is RPC framing, whereas GitHub POSTs
// a raw HMAC-signed body that must reach the webhook route byte-for-byte. Handing
// the untouched `Request` to `honoApp.fetch` preserves exactly those bytes.
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
 * Stamp `cache-control: no-store` on SSR'd HTML documents (BRIEF-19, ADR 0016
 * #5c): loader-prefetched pages embed authz-gated, per-viewer data in the
 * HTML, which must never land in a shared proxy/CDN cache. Static assets
 * (non-HTML) keep their own caching.
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
    // Health surface (BRIEF-51, ADR 0034 #7): answered BEFORE the Hono
    // branch and the page router — unauthenticated, constant JSON.
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
