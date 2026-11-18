import "@tanstack/react-start/server-only";

const SERVER_TIMING_HEADER = "server-timing";

/**
 * An SSR'd HTML document embeds authz-gated, per-viewer data, so it never
 * lands in a shared cache; it also carries its render's API read timings.
 * Any other response keeps its own headers.
 */
export function stampDocumentHeaders(
  response: Response,
  serverTiming: string | undefined,
): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  if (serverTiming !== undefined) {
    headers.set(SERVER_TIMING_HEADER, serverTiming);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
