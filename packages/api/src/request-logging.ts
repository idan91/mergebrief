// Hand-rolled request-logging middleware. Must be mounted just after
// `hono/request-id`: the request id becomes a `reqId` child-logger binding,
// and ONE `api.access` line is emitted per request after the handler runs.
//
// The authz layers own the line's `decision` semantics: deny/allow sites stamp
// it via `stampAccess`; absent a stamp, decision falls back to the response
// status.
//
// Secrets and ids ride as structured FIELDS, never interpolated into `msg` —
// `msg` bypasses the logging boundary's path-based redaction.
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
 * Record the gate's outcome for the one access line. Ids arrive as branded
 * bigints and are stringified here — the line carries numeric ids as strings,
 * never anything reversible to a token.
 */
export function stampAccess(
  c: AccessStampTarget,
  decision: string,
  fields: { repoId?: bigint; reviewerId?: bigint } = {},
): void {
  const access: { decision: string; repoId?: string; reviewerId?: string } = {
    decision,
  };
  if (fields.repoId !== undefined) {
    access.repoId = String(fields.repoId);
  }
  if (fields.reviewerId !== undefined) {
    access.reviewerId = String(fields.reviewerId);
  }
  c.set("access", access);
}

/** The one place the `api.access` line is emitted; `info` = terse operational signal. */
export function requestLogging(
  logger: Logger,
): MiddlewareHandler<RequestLogEnv> {
  return async (c, next) => {
    const startedAt = Date.now();
    c.set("logger", logger.child({ reqId: c.get("requestId") }));
    await next();
    const access = c.get("access");
    const operation = c.get("operation");
    const fields: LogFields = {
      evt: "api.access",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
      decision: access?.decision ?? String(c.res.status),
    };
    // Transport (this line) and intent (the audit row) stay separate logs,
    // joined on `reqId`; `operation` is what makes the join readable.
    if (operation !== undefined) {
      fields["operation"] = operation;
    }
    if (access?.repoId !== undefined) {
      fields["repoId"] = access.repoId;
    }
    if (access?.reviewerId !== undefined) {
      fields["reviewerId"] = access.reviewerId;
    }
    c.get("logger").info("request", fields);
  };
}
