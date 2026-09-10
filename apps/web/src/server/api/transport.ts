// The process-wide transport to the API, built once from the environment, and
// the SSR entry point that rides it.
import "@tanstack/react-start/server-only";

import type { ApiFetchInit } from "@web/data/apiFetch";
import { getServerEnv } from "../env";
import { getServerLogger } from "../logger";
import { resolveApiOrigin } from "./origin";
import { apiUnavailable, requestApi, type ApiTransportDeps } from "./proxy";

/**
 * Upstream budget for one API request. Long enough for a cold read behind the
 * gate, short enough that a stuck upstream frees the web tier's socket rather
 * than holding a render open until the browser gives up.
 */
const UPSTREAM_TIMEOUT_MS = 30_000;
// The API posts one GitHub mutation per draft, each at least one second
// (octokit's write pacing) plus GitHub's own latency, so a submit at the
// 64-draft session cap runs ~66 s; the budget allows about 2 s per mutation
// sustained.
const SUBMIT_TIMEOUT_MS = 150_000;

const TRANSPORT_UNAVAILABLE_MSG = "apiFetch: api transport unavailable";

let cached: ApiTransportDeps | undefined;

/**
 * A misconfigured origin fails HERE, at first use, rather than sending a
 * request somewhere unintended.
 */
export function getApiTransport(): ApiTransportDeps {
  if (cached === undefined) {
    const origin = resolveApiOrigin(getServerEnv());
    if (!origin.ok) {
      throw new Error(`api transport: ${origin.error.message}`);
    }
    cached = {
      origin: origin.value,
      fetch: globalThis.fetch,
      logger: getServerLogger(),
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      submitTimeoutMs: SUBMIT_TIMEOUT_MS,
    };
  }
  return cached;
}

/**
 * SSR dispatch: synthesize the request the browser would have sent, with the
 * viewer's cookie forwarded verbatim so the API applies the same authorization
 * it applies to the browser. The origin is irrelevant to routing, but it must
 * be the configured one, so the request is built against it.
 */
export function dispatchToApi(
  path: string,
  cookie: string | undefined,
  deps: ApiTransportDeps,
  init?: ApiFetchInit,
): Promise<Response> {
  // Header names are case-insensitive, so the forwarded viewer cookie is set
  // LAST, after deleting any caller-supplied one: a plain object spread would
  // keep both spellings and let a stale caller cookie merge ahead of the real
  // one.
  const headers = new Headers(init?.headers ?? {});
  headers.delete("cookie");
  if (cookie !== undefined) {
    headers.set("cookie", cookie);
  }
  const request: RequestInit = { method: init?.method ?? "GET", headers };
  if (init?.body !== undefined) request.body = init.body;
  return requestApi(new Request(`${deps.origin}${path}`, request), deps);
}

/**
 * The SSR branch's one entry point. A transport that cannot be built is the
 * same sanitized answer an unreachable API gets, so a misconfiguration never
 * reaches a rendered page as an internal error.
 */
export function fetchFromApi(
  path: string,
  cookie: string | undefined,
  init?: ApiFetchInit,
): Promise<Response> {
  let transport: ApiTransportDeps;
  try {
    transport = getApiTransport();
  } catch (error) {
    const logger = getServerLogger();
    logger.error(TRANSPORT_UNAVAILABLE_MSG, { err: error });
    return Promise.resolve(apiUnavailable(503));
  }
  return dispatchToApi(path, cookie, transport, init);
}
