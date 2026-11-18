// The one `app.onError` seam: a thrown `ApiError` renders through the wire
// producer, a persistence `ScopeViolationError` renders as the plain 404 a
// `NotFound` would, and anything else is a sanitized 500, internals go to
// the log, never the response. Enclosing middleware sees `next()` resolve
// with the rendered response, so audit emit and the access line survive
// throws.
import type { Context } from "hono";
import type { Logger } from "logging";
import { ApiErrorCodes, ApiErrorStatusByCode } from "contract";
import { HttpStatuses } from "types/http";
import { ScopeViolationError } from "persistence";
import { buildErrorResponse } from "../error-response";
import type { RequestLogEnv } from "../request-logging";
import { ApiError, NotFound } from "./api-error";

/** The `ApiError` a throw renders as; `undefined` for an unexpected throw. */
function resolveApiError(error: unknown): ApiError | undefined {
  if (error instanceof ScopeViolationError) {
    return new NotFound();
  }
  if (error instanceof ApiError) {
    return error;
  }
  return undefined;
}

/**
 * Whether the handler below answers this throw as a server fault. A thrown
 * 4xx is the request's own answer, so a span around it has not failed.
 */
export function isServerFault(error: unknown): boolean {
  const apiError = resolveApiError(error);
  if (apiError === undefined) {
    return true;
  }
  const status = ApiErrorStatusByCode[apiError.code];
  return status >= HttpStatuses.INTERNAL_SERVER_ERROR;
}

/** Build the `app.onError` handler. `fallback` covers a throw that happens
 * before `requestLogging` binds the per-request child logger. */
export function createErrorHandler<E extends RequestLogEnv>(
  fallback: Logger,
): (err: Error, c: Context<E>) => Response {
  return (err, c) => {
    const apiError = resolveApiError(err);
    if (apiError !== undefined) {
      return buildErrorResponse(c, apiError.code);
    }
    const log: Logger | undefined = c.get("logger");
    (log ?? fallback).error("unhandled route error", { err });
    return buildErrorResponse(c, ApiErrorCodes.INTERNAL_ERROR);
  };
}
