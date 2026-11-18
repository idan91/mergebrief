// The web tier mints the id every API call made for one inbound request
// carries, so the proxy hop and each SSR read join the API's lines on `reqId`.
// A client-sent value is replaced: the client never picks the join key.
import "@tanstack/react-start/server-only";

import { getRequestHeader } from "@tanstack/react-start/server";

export const REQUEST_ID_HEADER = "x-request-id";

/** Methods that never carry a body, so the stream is not attached. */
export const BODILESS_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * The inbound request under a fresh id; method, body and abort signal ride
 * unchanged. Built from parts, never `new Request(request)`: the server hands
 * in its own Request class, which undici refuses to copy.
 */
export function stampRequestId(
  request: Request,
  requestId: string = crypto.randomUUID(),
): Request {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    signal: request.signal,
  };
  if (!BODILESS_METHODS.has(request.method.toUpperCase())) {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(request.url, init);
}

/**
 * The id of the request being rendered, absent outside one: Start keeps the
 * request in AsyncLocalStorage and throws when a caller runs outside it,
 * which a query function reused off the render path does.
 */
export function readRenderRequestId(): string | undefined {
  try {
    return getRequestHeader(REQUEST_ID_HEADER);
  } catch {
    return undefined;
  }
}
