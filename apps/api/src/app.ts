import type { Mutable } from "types/utils";
// Dependencies are INJECTED: this module never reads `process.env` and never
// constructs a DB.
import { DEFAULT_INSTANCE_POLICY } from "generators/instance-policy";
import type { Hono } from "hono";
import { requestId } from "hono/request-id";
import { createAuditMiddleware } from "./product-operations/audit";
import { productRouter } from "./product-operations/product-router";
import { productOperationRegistry } from "./product-operations/registry";
import { createRequestBodyLimit } from "./request-body-limit";
import { requestLogging, type RequestLogEnv } from "./request-logging";
import { apiRoutes, type AppDeps } from "./routes";
import { stampSecurityHeaders } from "./security-headers";
import { createErrorHandler } from "./shared-errors/on-error";

export type ApiApp = Hono<RequestLogEnv>;

/** Build the API app over injected deps. */
export function createApp(deps: AppDeps): ApiApp {
  const root = productRouter<RequestLogEnv>();

  // The sole wire-error producer: every expected failure below THROWS an
  // `ApiError` subclass and exits here; non-ApiError throws stay sanitized
  // 500s.
  root.app.onError(createErrorHandler(deps.logger));

  // Outermost, so it sees every answer below, an `onError` one included.
  root.use(stampSecurityHeaders());

  // Request id + the one api.access line per request; every route below reads
  // its child logger from context.
  root.use(requestId());
  root.use(requestLogging(deps.logger));

  // One Operator list for every request: the policy gate and the session
  // read both answer from it.
  const operatorIds = deps.operatorIds ?? DEFAULT_INSTANCE_POLICY.operatorIds;
  root.use(async (c, next) => {
    c.set("operatorIds", operatorIds);
    await next();
  });

  // Ahead of the routes so it wraps the auth gates: a denial that never
  // reached a handler is still an audited action.
  const auditDeps: Mutable<Parameters<typeof createAuditMiddleware>[0]> = {
    handle: deps.handle,
    registry: productOperationRegistry,
  };
  if (deps.audit !== undefined) {
    auditDeps.audit = deps.audit;
  }
  root.use(createAuditMiddleware(auditDeps));
  root.use(createRequestBodyLimit(productOperationRegistry));
  root.route("/api", apiRoutes(deps));

  // Composing IS registering: the root commit stamps every declared
  // operation's full endpoint into the shared catalog registry.
  root.commit(productOperationRegistry);
  return root.app;
}
