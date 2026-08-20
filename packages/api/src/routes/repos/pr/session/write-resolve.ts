// The machinery every session write shares: bind the write to the Brief the
// request names, and map the store's expected failures onto the wire.
import type { Context } from "hono";
import {
  forTenant,
  ReviewSessionErrorCode,
  type ReviewSessionError,
  type SessionWriter,
} from "persistence";
import type { Result } from "types";
import { ApiErrorCode, errorJson } from "../../../../error-response";
import type { AuthzEnv } from "../../../authz";
import type { AuthRouteDeps } from "../../../auth/session";
import {
  loadCarryFacts,
  prNumberSchema,
  resolveSessionTarget,
  spanQuerySchema,
} from "./brief-target";
import { UnreadableBriefError } from "./carry-facts";

/**
 * The Brief the carry-over would be evaluated against will not parse. This is
 * the dangerous side of the read route's version of the same failure: empty
 * facts here would MATERIALIZE every carried decision as `DROPPED`.
 */
const UNREADABLE_BRIEF = { code: "unreadable-brief" } as const;
export type WriteError = ReviewSessionError | typeof UNREADABLE_BRIEF;

/** A write bound to the named Brief and reviewer; it writes if needed. */
export type SessionWrite = <T>(
  write: (writer: SessionWriter) => Promise<T>,
) => Promise<Result<T, WriteError>>;

export type ResolvedWrite =
  | {
      readonly ok: true;
      readonly run: SessionWrite;
      /** The named Brief's head — the commit the reviewer read, and the one a
       * GitHub write pins to. */
      readonly head: string;
    }
  | { readonly ok: false; readonly response: Response };

/**
 * Resolve the PR and the Brief the request names, and bind the write to them.
 * A bad span or an unknown PR/Brief is the subtree's hint-free 404.
 */
export async function resolveWrite(
  deps: AuthRouteDeps,
  c: Context<AuthzEnv>,
): Promise<ResolvedWrite> {
  const span = spanQuerySchema.safeParse({
    base: c.req.query("base"),
    head: c.req.query("head"),
  });
  const prNumber = prNumberSchema.safeParse(c.req.param("prNumber"));
  if (!span.success || !prNumber.success) {
    return { ok: false, response: errorJson(c, ApiErrorCode.INVALID_REQUEST) };
  }
  const ctx = c.get("ctx");
  const target = await resolveSessionTarget(
    deps,
    ctx,
    c.get("repoId"),
    prNumber.data,
    span.data,
  );
  if (target === undefined) {
    return { ok: false, response: errorJson(c, ApiErrorCode.NOT_FOUND) };
  }
  const logger = c.get("logger");
  return {
    ok: true,
    head: span.data.head,
    run: async (write) => {
      try {
        return await forTenant(deps.handle, ctx).reviewSessions.writeToSession(
          {
            briefId: target.briefId,
            reviewerId: c.get("session").reviewerId,
            brief: () => loadCarryFacts(deps, ctx, target, span.data),
          },
          write,
        );
      } catch (error) {
        if (!(error instanceof UnreadableBriefError)) throw error;
        logger.error("brief artifact unreadable — nothing was materialized", {
          briefId: String(target.briefId),
          head: span.data.head,
        });
        return { ok: false, error: UNREADABLE_BRIEF };
      }
    },
  };
}

/** The store's expected failures, mapped to the wire. */
export function mapWriteFailure(
  c: Context<AuthzEnv>,
  error: WriteError,
): Response {
  if (error.code === UNREADABLE_BRIEF.code) {
    return errorJson(c, ApiErrorCode.INTERNAL_ERROR);
  }
  if (error.code === ReviewSessionErrorCode.SESSION_FROZEN) {
    return errorJson(c, ApiErrorCode.PR_CHANGED_SINCE_READ);
  }
  return errorJson(c, ApiErrorCode.NOT_FOUND);
}
