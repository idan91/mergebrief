// Dependencies are INJECTED: this module never reads `process.env` and never
// constructs a DB.
import type { Hono } from "hono";
import { requestId } from "hono/request-id";
import { productRouter } from "./product-operations/product-router";
import { productOperationRegistry } from "./product-operations/registry";
import { requestLogging, type RequestLogEnv } from "./request-logging";
import { apiRoutes, type AppDeps } from "./routes";

export type { AppDeps } from "./routes";
export type { AuthDeps } from "./routes/auth/session";

/** The built API app's concrete type (request-log env at the root). */
export type ApiApp = Hono<RequestLogEnv>;

/** Build the API app over injected deps. */
export function createApp(deps: AppDeps): ApiApp {
  const root = productRouter<RequestLogEnv>();
  // Request id + the one api.access line per request; every route below reads
  // its child logger from context.
  root.use(requestId());
  root.use(requestLogging(deps.logger));
  root.route("/api", apiRoutes(deps));
  // Composing IS registering: the root commit stamps every declared
  // operation's full endpoint into the shared catalog registry.
  root.commit(productOperationRegistry);
  return root.app;
}
