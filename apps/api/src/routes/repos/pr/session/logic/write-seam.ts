// The session span as a request carries it, and the write seam the comments
// and review-submit adapters bind through before they call GitHub.
import type { Context } from "hono";
import type { PullRequestEnv } from "../../../../../access/types";
import { BadRequest, NotFound } from "../../../../../shared-errors/api-error";
import type { AuthRouteDeps } from "../../../../auth/session/types";
import { spanQuerySchema, type BriefSpan } from "../schemas";
import { openSessionWrite, type ResolvedSessionWrite } from "./session-writes";

/** The Brief span the query names, or `undefined` when it names none. */
export function parseSpanQuery(
  c: Context<PullRequestEnv>,
): BriefSpan | undefined {
  const span = spanQuerySchema.safeParse({
    base: c.req.query("base"),
    head: c.req.query("head"),
  });
  if (!span.success) {
    return undefined;
  }
  return span.data;
}

/**
 * Bind the write to the Brief the request names on the access step's row,
 * throwing the wire posture: a bad span is the deterministic 400, an unknown
 * Brief the subtree's hint-free 404.
 */
export async function resolveSessionWrite(
  deps: AuthRouteDeps,
  c: Context<PullRequestEnv>,
): Promise<ResolvedSessionWrite> {
  const span = parseSpanQuery(c);
  if (span === undefined) {
    throw new BadRequest();
  }

  const opened = await openSessionWrite(
    { handle: deps.handle, log: c.get("logger") },
    c.get("pullRequestAccess"),
    span,
  );
  if (!opened.ok) {
    throw new NotFound();
  }
  return opened.value;
}
