// The process-wide transport to the API, built once from the environment, and
// the SSR entry point that rides it.
import "@tanstack/react-start/server-only";

import { getRequestHeader } from "@tanstack/react-start/server";
import type { ApiFetchInit } from "@web/data/apiFetch";
import { HttpMethods } from "types";
import { getServerEnv } from "../env";
import { getServerLogger } from "../logger";
import { REQUEST_ID_HEADER } from "../request-id";
import {
  SUBMIT_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  UPSTREAM_TIMEOUT_MS,
} from "./consts";
import { resolveApiOrigin } from "./origin";
import { apiUnavailable, requestApi, type ApiTransportDeps } from "./proxy";
import { timeApiRead } from "./read-timings";

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
      uploadTimeoutMs: UPLOAD_TIMEOUT_MS,
    };
  }
  return cached;
}

/** The inbound request's values every SSR call to the API carries. */
export interface ForwardedRequest {
  readonly cookie?: string | undefined;
  readonly requestId?: string | undefined;
}

/**
 * SSR dispatch: synthesize the request the browser would have sent, with the
 * viewer's cookie forwarded verbatim so the API applies the same authorization
 * it applies to the browser, and the inbound request's id so its lines join
 * this render's. The origin is irrelevant to routing, but it must be the
 * configured one, so the request is built against it.
 */
export function dispatchToApi(
  path: string,
  forwarded: ForwardedRequest,
  deps: ApiTransportDeps,
  init?: ApiFetchInit,
): Promise<Response> {
  // Header names are case-insensitive, so the forwarded values are set LAST,
  // after deleting any caller-supplied ones: a plain object spread would keep
  // both spellings and let a stale caller value merge ahead of the real one.
  const headers = new Headers(init?.headers ?? {});
  headers.delete("cookie");
  headers.delete(REQUEST_ID_HEADER);
  if (forwarded.cookie !== undefined) {
    headers.set("cookie", forwarded.cookie);
  }
  if (forwarded.requestId !== undefined) {
    headers.set(REQUEST_ID_HEADER, forwarded.requestId);
  }
  const request: RequestInit = { method: init?.method ?? "GET", headers };
  if (init?.body !== undefined) {
    request.body = init.body;
  }
  if (init?.signal !== undefined) {
    request.signal = init.signal;
  }
  if (init?.credentials !== undefined) {
    request.credentials = init.credentials;
  }
  return requestApi(new Request(`${deps.origin}${path}`, request), deps);
}

/**
 * The SSR branch's one entry point, run inside the inbound request. A
 * transport that cannot be built is the same sanitized answer an unreachable
 * API gets, so a misconfiguration never reaches a rendered page as an
 * internal error.
 */
export function fetchFromApi(
  path: string,
  init?: ApiFetchInit,
): Promise<Response> {
  const forwarded: ForwardedRequest = {
    cookie: getRequestHeader("cookie"),
    requestId: getRequestHeader(REQUEST_ID_HEADER),
  };
  let transport: ApiTransportDeps;
  try {
    transport = getApiTransport();
  } catch (error) {
    const logger = getServerLogger();
    logger.error("apiFetch: api transport unavailable", {
      err: error,
      reqId: forwarded.requestId,
    });
    return Promise.resolve(apiUnavailable(503));
  }
  return timeApiRead(init?.method ?? HttpMethods.GET, path, () =>
    dispatchToApi(path, forwarded, transport, init),
  );
}
