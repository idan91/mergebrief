// The isomorphic read-API fetch seam (BRIEF-19 PR 3.1, ADR 0016 #5c).
//
// Client branch: a plain relative `fetch` — the browser attaches the session
// cookie itself. Server (SSR) branch: IN-PROCESS dispatch of the same Hono app
// the server entry mounts, with the incoming request's cookie forwarded — the
// server-rendered read traverses the IDENTICAL authz middleware. Reaching
// persistence directly from a server function is forbidden (it would bypass
// the gate — a second enforcement path). The origin in the synthesized URL is
// irrelevant: Hono routes on the path.
//
// Composition failure (Postgres down / misconfig) maps to the same sanitized
// 503 the server entry answers for /api/* — a typed, expected error state,
// never a leaked internal.
import { createIsomorphicFn } from "@tanstack/react-start";
import type { ValueOf } from "types";

export const ApiErrorKind = {
  BAD_REQUEST: "bad-request",
  UNAUTHORIZED: "unauthorized",
  NOT_FOUND: "not-found",
  TOO_LARGE: "too-large",
  UPSTREAM: "upstream",
  UNAVAILABLE: "unavailable",
  /** A 2xx whose body failed to parse — a programmer/contract error surfaced as data. */
  MALFORMED: "malformed",
} as const;
export type ApiErrorKind = ValueOf<typeof ApiErrorKind>;

/** Typed expected-failure for read-API calls; queryFns throw it (react-query idiom). */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;

  constructor(kind: ApiErrorKind, status: number, path: string) {
    super(`api request failed: ${kind} (${status}) for ${path}`);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

function kindForStatus(status: number): ApiErrorKind {
  switch (status) {
    case 400:
      return ApiErrorKind.BAD_REQUEST;
    case 401:
      return ApiErrorKind.UNAUTHORIZED;
    case 404:
      return ApiErrorKind.NOT_FOUND;
    case 413:
      return ApiErrorKind.TOO_LARGE;
    case 503:
      return ApiErrorKind.UNAVAILABLE;
    default:
      return ApiErrorKind.UPSTREAM;
  }
}

/** The Hono-shaped surface the SSR branch dispatches against. */
interface DispatchableApp {
  fetch(request: Request): Promise<Response> | Response;
}

/**
 * SSR dispatch, factored for tests: synthesize a Request against the
 * in-process app with the viewer's cookie forwarded verbatim. A composition
 * failure becomes the sanitized 503 (mirrors `src/server.ts`).
 */
export async function dispatchInProcess(
  path: string,
  cookie: string | undefined,
  getApp: () => Promise<DispatchableApp>,
): Promise<Response> {
  let app: DispatchableApp;
  try {
    app = await getApp();
  } catch (error) {
    console.error("apiFetch: webhook app composition failed", error);
    return new Response(JSON.stringify({ error: "service unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  return app.fetch(
    new Request(`http://internal${path}`, {
      headers: cookie === undefined ? {} : { cookie },
    }),
  );
}

const dispatch = createIsomorphicFn()
  .client((path: string): Promise<Response> => fetch(path))
  .server(async (path: string): Promise<Response> => {
    const [{ getRequestHeader }, { getWebhookApp }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("../server/webhookApp"),
    ]);
    return dispatchInProcess(path, getRequestHeader("cookie"), getWebhookApp);
  });

/** Fetch a read-API path on whichever side we are rendering. */
export function apiFetch(path: string): Promise<Response> {
  return dispatch(path);
}

/** Map a response to its parsed JSON body or a typed `ApiError`. */
export async function apiJsonFromResponse(
  response: Response,
  path: string,
): Promise<unknown> {
  if (!response.ok) {
    throw new ApiError(kindForStatus(response.status), response.status, path);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ApiError(ApiErrorKind.MALFORMED, response.status, path);
  }
}

/** `apiFetch` + JSON mapping in one step (the queryFn workhorse). */
export async function apiFetchJson(path: string): Promise<unknown> {
  return apiJsonFromResponse(await apiFetch(path), path);
}

/** Fetch a text body (the live diff proxy); non-2xx throws a typed `ApiError`. */
export async function apiFetchText(path: string): Promise<string> {
  const response = await apiFetch(path);
  if (!response.ok) {
    throw new ApiError(kindForStatus(response.status), response.status, path);
  }
  return response.text();
}
