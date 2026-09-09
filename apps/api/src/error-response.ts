// The ONE producer of error-response bodies: every expected failure on the
// HTTP surface exits as a thrown `ApiError` class and renders through
// `buildErrorResponse` (the `onError` seam), so the wire shape
// `{ error, code, params? }`, the code→status pairing, and the `no-store`
// posture cannot drift per route. Security collapses (uniform-404, single
// invalid-request bucket) happen at the per-route handlers BEFORE this
// module, a code here is already the public posture, never the internal
// cause. `errorJson` survives only for the wire suite that pins the shape.
import {
  ApiErrorEnglishByCode,
  ApiErrorStatusByCode,
  type ApiErrorCode,
  type ApiErrorParamCode,
  type ApiErrorParamlessCode,
  type ApiErrorParams,
} from "contract";
import type { Context } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    /** The wire code of the error this request answered with, the audit
     * emit's default denial reason. Set here so no route has to remember. */
    apiErrorCode?: string;
  }
}

/** Compose the server-side English line from the template + params. */
function composeEnglish(
  code: ApiErrorCode,
  params: { readonly [key: string]: string } | undefined,
): string {
  return ApiErrorEnglishByCode[code].replaceAll(
    /\{\{(\w+)\}\}/g,
    (token, name: string) => params?.[name] ?? token,
  );
}

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * Uniform `no-store` on ALL error responses, gated or not, an error body is
 * never cacheable state.
 */
export function errorJson(c: Context, code: ApiErrorParamlessCode): Response;
export function errorJson<K extends ApiErrorParamCode>(
  c: Context,
  code: K,
  params: ApiErrorParams[K],
): Response;
export function errorJson(
  c: Context,
  code: ApiErrorCode,
  params?: ApiErrorParams[ApiErrorParamCode],
): Response {
  return buildErrorResponse(c, code, params);
}

/**
 * The producing seam `app.onError` calls, an `ApiError` class has already
 * proven the code/params pairing by construction.
 */
export function buildErrorResponse(
  c: Context,
  code: ApiErrorCode,
  params: ApiErrorParams[ApiErrorParamCode] | undefined,
): Response {
  const base = { error: composeEnglish(code, params), code };
  const body = params === undefined ? base : { ...base, params };
  c.set("apiErrorCode", code);
  return c.json(body, ApiErrorStatusByCode[code], NO_STORE);
}
