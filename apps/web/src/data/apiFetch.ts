// The isomorphic read-API fetch boundary.
//
// Client branch: a plain relative `fetch` — the browser attaches the session
// cookie itself. SSR branch: IN-PROCESS dispatch of the same Hono app the
// server entry mounts, with the incoming cookie forwarded, so the
// server-rendered read traverses the IDENTICAL authz middleware. Reaching
// persistence directly from a server function is forbidden — that is a second
// enforcement path. The synthesized URL's origin is irrelevant: Hono routes on
// the path.
//
// Composition failure maps to the same sanitized 503 the server entry answers
// for `/api/*`; never a leaked internal.
import { createIsomorphicFn } from "@tanstack/react-start";
import type { ValueOf } from "types";

export const ApiErrorKind = {
  BAD_REQUEST: "bad-request",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
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
    case 403:
      return ApiErrorKind.FORBIDDEN;
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
 * The narrow request-init surface this boundary forwards. Typed explicitly —
 * not `RequestInit` — so the SSR branch provably forwards every field it
 * accepts.
 */
export interface ApiFetchInit {
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/**
 * The slice of the `packages/logging` `Logger` the SSR branch needs. Injected,
 * never imported: this module is isomorphic and `server/logger` is
 * `server-only`, so importing it here would drag the server entry into the
 * client bundle. The real `Logger` satisfies this structurally.
 */
export interface DispatchLogSink {
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * SSR dispatch, factored for tests: synthesize a Request against the
 * in-process app with the viewer's cookie forwarded verbatim (plus any
 * mutation method/body). A composition failure becomes the sanitized 503
 * (mirrors `src/server.ts`).
 */
export async function dispatchInProcess(
  path: string,
  cookie: string | undefined,
  getApp: () => Promise<DispatchableApp>,
  logger: DispatchLogSink,
  init?: ApiFetchInit,
): Promise<Response> {
  let app: DispatchableApp;
  try {
    app = await getApp();
  } catch (error) {
    // `error` can quote DATABASE_URL back on a Postgres misconfig, so it rides
    // as a FIELD — the logging boundary's `err` serializer scrubs URL-shaped
    // substrings; `msg` bypasses redaction.
    logger.error("apiFetch: webhook app composition failed", { err: error });
    return new Response(JSON.stringify({ error: "service unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  // Header names are case-insensitive: build a real Headers object and set
  // the forwarded viewer cookie LAST, after deleting any caller-supplied
  // `Cookie`/`cookie` — a plain object spread would keep both variants and
  // let a stale caller cookie merge ahead of the real one.
  const headers = new Headers(init?.headers ?? {});
  headers.delete("cookie");
  if (cookie !== undefined) {
    headers.set("cookie", cookie);
  }
  return app.fetch(
    new Request(`http://internal${path}`, {
      method: init?.method ?? "GET",
      headers,
      ...(init?.body === undefined ? {} : { body: init.body }),
    }),
  );
}

const dispatch = createIsomorphicFn()
  .client(
    (path: string, init?: ApiFetchInit): Promise<Response> => fetch(path, init),
  )
  .server(async (path: string, init?: ApiFetchInit): Promise<Response> => {
    const [{ getRequestHeader }, { getWebhookApp }, { getServerLogger }] =
      await Promise.all([
        import("@tanstack/react-start/server"),
        import("../server/webhookApp"),
        import("../server/logger"),
      ]);
    return dispatchInProcess(
      path,
      getRequestHeader("cookie"),
      getWebhookApp,
      getServerLogger(),
      init,
    );
  });

/** Fetch a read-API path (or POST a mutation) on whichever side we render. */
export function apiFetch(path: string, init?: ApiFetchInit): Promise<Response> {
  return dispatch(path, init);
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
    // Annotated, not asserted: `Response.json()` resolves to `any`, and the
    // annotation contains it at the boundary without a bare cast.
    const body: unknown = await response.json();
    return body;
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
