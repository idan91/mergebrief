import "@tanstack/react-start/server-only";

import { ProductOperations, ProductQueryIds } from "contract";
import { HttpStatuses } from "types";
import { readAcceptedCodings } from "../accept-encoding";

const DIFF_REPLY_CODING = "gzip";
const PATH_PARAM = /:[A-Za-z]+/g;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** The two reads that answer with a whole span's diff text. */
const DIFF_READS = [
  ProductOperations[ProductQueryIds.READ_DIFF],
  ProductOperations[ProductQueryIds.READ_LOCAL_BRIEF_DIFFS],
].map((operation) => ({
  method: operation.method,
  path: buildPathPattern(operation.path),
}));

/** An operation path's pattern: each `:param` matches one path segment. */
function buildPathPattern(template: string): RegExp {
  const escaped = template.replace(REGEX_SPECIALS, "\\$&");
  const segments = escaped.replace(PATH_PARAM, "[^/]+");
  return new RegExp(`^${segments}$`);
}

/**
 * A diff reply gzipped on its way to a browser that accepts it: the API
 * answers this hop in identity bytes, and a large PR's diff is megabytes of
 * text. Every other reply passes through as it came.
 */
export function compressDiffReply(request: Request, reply: Response): Response {
  if (!isDiffRead(request)) {
    return reply;
  }
  const { body } = reply;
  if (body === null || reply.status !== HttpStatuses.OK) {
    return reply;
  }

  const headers = new Headers(reply.headers);
  headers.append("vary", "accept-encoding");
  const accepted = readAcceptedCodings(
    request.headers.get("accept-encoding") ?? "",
  );
  const sendsIdentity =
    !accepted.has(DIFF_REPLY_CODING) || headers.has("content-encoding");
  if (sendsIdentity) {
    return new Response(body, {
      status: reply.status,
      statusText: reply.statusText,
      headers,
    });
  }

  headers.set("content-encoding", DIFF_REPLY_CODING);
  headers.delete("content-length");
  const gzipped = body.pipeThrough(new CompressionStream(DIFF_REPLY_CODING));
  return new Response(gzipped, {
    status: reply.status,
    statusText: reply.statusText,
    headers,
  });
}

function isDiffRead(request: Request): boolean {
  const method = request.method.toUpperCase();
  const { pathname } = new URL(request.url);

  return DIFF_READS.some((read) => {
    const matchesRead = read.method === method && read.path.test(pathname);
    return matchesRead;
  });
}
