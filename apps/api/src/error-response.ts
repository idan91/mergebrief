// The one producer of error-response bodies, so `{ error, code }`, the
// code's status and `no-store` cannot drift per route. A code here is
// already the public posture: security collapses happen in the handlers.
import {
  ApiErrorEnglishByCode,
  ApiErrorStatusByCode,
  type ApiErrorBody,
  type ApiErrorCode,
} from "contract";
import type { Context } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    /** The wire code of the error this request answered with, the audit
     * emit's default denial reason. Set here so no route has to remember. */
    apiErrorCode?: string;
  }
}

const NO_STORE = { "cache-control": "no-store" } as const;

/** The seam `app.onError` calls; an `ApiError` class already proved the code's status. */
export function buildErrorResponse(c: Context, code: ApiErrorCode): Response {
  const body: ApiErrorBody = { error: ApiErrorEnglishByCode[code], code };
  c.set("apiErrorCode", code);
  return c.json(body, ApiErrorStatusByCode[code], NO_STORE);
}
