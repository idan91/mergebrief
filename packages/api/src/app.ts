// Dependencies are INJECTED: this module never reads `process.env` and never
// constructs a DB.
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { requestLogging, type RequestLogEnv } from "./request-logging";
import { apiRoutes, type AppDeps } from "./routes";

export type { AppDeps } from "./routes";
export type { AuthDeps } from "./routes/auth/session";

/** The built API app's concrete type (request-log env at the root). */
export type ApiApp = Hono<RequestLogEnv>;

/** Build the API app over injected deps. */
export function createApp(deps: AppDeps): ApiApp {
  const app = new Hono<RequestLogEnv>();
  // Request id + the one api.access line per request; every route below reads
  // its child logger from context.
  app.use(requestId());
  app.use(requestLogging(deps.logger));
  app.route("/api", apiRoutes(deps));
  return app;
}
