// `MergeBrief-Version` on every /api response that passed the session layer.
// Mounted once at the /api root and judged after the handler: a response with
// no principal in context (a 401, a login redirect, a webhook) carries none,
// so an unauthenticated caller learns nothing the gated /api/version did not
// already say. Health answers are served ahead of the app and never reach it.
import type { MiddlewareHandler } from "hono";
import type { ViewerPrincipal } from "./auth/session/types";

export const VERSION_HEADER = "MergeBrief-Version";

/** What the /api root env must carry: the principal `sessionLayer` sets. */
export interface VersionHeaderVariables {
  readonly session?: ViewerPrincipal;
}

interface VersionHeaderEnv {
  readonly Variables: VersionHeaderVariables;
}

export function stampVersionHeader<RootEnv extends VersionHeaderEnv>(
  serverVersion: string,
): MiddlewareHandler<RootEnv> {
  return async (c, next) => {
    await next();
    const principal = c.get("session");
    if (principal !== undefined) {
      c.res.headers.set(VERSION_HEADER, serverVersion);
    }
  };
}
