// Dependencies are INJECTED: this module never reads `process.env` and never
// constructs a DB.
import type { Hono } from "hono";
import { requestId } from "hono/request-id";
import { createAuditMiddleware } from "./product-operations/audit";
import { productRouter } from "./product-operations/product-router";
import { productOperationRegistry } from "./product-operations/registry";
import { requestLogging, type RequestLogEnv } from "./request-logging";
import { apiRoutes, type AppDeps } from "./routes";
import { createErrorHandler } from "./shared-errors/on-error";

export type { AppDeps } from "./routes";
export type { AuthDeps } from "./routes/auth/session";

/** The built API app's concrete type (request-log env at the root). */
export type ApiApp = Hono<RequestLogEnv>;

/** Build the API app over injected deps. */
export function createApp(deps: AppDeps): ApiApp {
  const root = productRouter<RequestLogEnv>();
  // The sole wire-error producer: every expected failure below THROWS an
  // `ApiError` subclass and exits here; non-ApiError throws stay sanitized
  // 500s.
  root.app.onError(createErrorHandler(deps.logger));
  // Request id + the one api.access line per request; every route below reads
  // its child logger from context.
  root.use(requestId());
  root.use(requestLogging(deps.logger));
  // Ahead of the routes so it wraps the auth gates: a denial that never
  // reached a handler is still an audited action.
  root.use(
    createAuditMiddleware({
      handle: deps.handle,
      registry: productOperationRegistry,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
    }),
  );
  root.route("/api", apiRoutes(deps));
  // Composing IS registering: the root commit stamps every declared
  // operation's full endpoint into the shared catalog registry.
  root.commit(productOperationRegistry);
  return root.app;
}
