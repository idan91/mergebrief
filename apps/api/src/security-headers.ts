import { SECURITY_RESPONSE_HEADERS } from "contract";
import type { MiddlewareHandler } from "hono";

/** Judged after the handler, so a route's own header wins. */
export function stampSecurityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
      if (!c.res.headers.has(name)) {
        c.header(name, value);
      }
    }
  };
}
