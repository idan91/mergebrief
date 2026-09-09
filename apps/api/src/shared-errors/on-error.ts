// The one `app.onError` seam: a thrown `ApiError` renders through the wire
// producer; anything else is a sanitized 500, internals go to the log,
// never the response. Enclosing middleware sees `next()` resolve with the
// rendered response, so audit emit and the access line survive throws.
import type { Context } from "hono";
import type { Logger } from "logging";
import { ApiErrorCodes } from "contract";
import { buildErrorResponse } from "../error-response";
import type { RequestLogEnv } from "../request-logging";
import { ApiError } from "./api-error";

/** Build the `app.onError` handler. `fallback` covers a throw that happens
 * before `requestLogging` binds the per-request child logger. */
export function createErrorHandler<E extends RequestLogEnv>(
  fallback: Logger,
): (err: Error, c: Context<E>) => Response {
  return (err, c) => {
    if (err instanceof ApiError) {
      return buildErrorResponse(c, err.code, err.params);
    }
    const log: Logger | undefined = c.get("logger");
    (log ?? fallback).error("unhandled route error", { err });
    return buildErrorResponse(c, ApiErrorCodes.INTERNAL_ERROR, undefined);
  };
}
