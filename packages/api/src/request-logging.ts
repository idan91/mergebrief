// Hand-rolled request-logging middleware (BRIEF-51, ADR 0034 #2/#6 — the
// deliberate alternative to hono-pino/@hono/structured-logger; revisit at a
// healthy structured-logger 1.x). Pairs with `hono/request-id` mounted just
// before it: the request id (inbound `X-Request-Id` accepted, length- and
// charset-guarded by hono; UUID minted otherwise; echoed on the response)
// becomes a `reqId` child-logger binding, and ONE `api.access` line — the
// D9 access-log contract, renamed from `evt: "read"` — is emitted per
// request after the handler runs.
//
// The line is assembled here but the authz layers own its `decision`
// semantics: deny/allow sites stamp `decision` (+ numeric ids) into context
// via `stampAccess`; absent a stamp, decision falls back to the response
// status (the pre-BRIEF-51 `accessLogLayer` behavior for session-only
// compositions and ungated routes alike).
import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import type { LogFields, Logger } from "logging";

/** What a gate layer records for the access line: its decision + actor ids. */
export interface AccessStamp {
  readonly decision: string;
  readonly repoId?: string;
  readonly reviewerId?: string;
}

export interface RequestLogVariables extends RequestIdVariables {
  /** Per-request child logger, bound to `{reqId}`. Routes log through THIS. */
  logger: Logger;
  access?: AccessStamp;
}

export interface RequestLogEnv {
  readonly Variables: RequestLogVariables;
}

/**
 * The slice of `Context` the stamp needs — structural on purpose so any
 * route env whose variables extend `RequestLogVariables` (e.g. `AuthzEnv`)
 * can pass its own `Context` without generic gymnastics (Hono's `Context`
 * is invariant in its env parameter).
 */
interface AccessStampTarget {
  set(key: "access", value: AccessStamp): void;
}

/**
 * Record the gate's outcome for the one access line. Ids arrive as the
 * branded bigints the layers hold and are stringified here — the D9 line
 * carries numeric ids as strings, never anything reversible to a token.
 */
export function stampAccess(
  c: AccessStampTarget,
  decision: string,
  fields: { repoId?: bigint; reviewerId?: bigint } = {},
): void {
  c.set("access", {
    decision,
    ...(fields.repoId === undefined ? {} : { repoId: String(fields.repoId) }),
    ...(fields.reviewerId === undefined
      ? {}
      : { reviewerId: String(fields.reviewerId) }),
  });
}

/** The one place the `api.access` line is emitted (ADR 0034 taxonomy). */
export function requestLogging(
  logger: Logger,
): MiddlewareHandler<RequestLogEnv> {
  return async (c, next) => {
    const startedAt = Date.now();
    c.set("logger", logger.child({ reqId: c.get("requestId") }));
    await next();
    const access = c.get("access");
    const fields: LogFields = {
      evt: "api.access",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
      decision: access?.decision ?? String(c.res.status),
      ...(access?.repoId === undefined ? {} : { repoId: access.repoId }),
      ...(access?.reviewerId === undefined
        ? {}
        : { reviewerId: access.reviewerId }),
    };
    c.get("logger").info("request", fields);
  };
}
