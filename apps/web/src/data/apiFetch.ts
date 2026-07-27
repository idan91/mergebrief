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
 * The narrow request-init surface this seam forwards (BRIEF-23 adds the
 * submit mutation). Typed explicitly — not `RequestInit` — so the SSR branch
 * provably forwards every field it accepts.
 */
export interface ApiFetchInit {
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/**
 * The slice of the `packages/logging` `Logger` the SSR branch needs (ADR
 * 0034). Injected rather than imported: this module is isomorphic, and
 * `server/logger` is `server-only` — importing it here would drag the server
 * entry into the client bundle. The real `Logger` satisfies this structurally.
 */
export interface DispatchLogSink {
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Mirrors `sanitizeGenerationError`'s pattern (kept local — no new dep), with
 * one addition it does not need: `file://` is EXEMPT. apps/web is
 * `"type": "module"`, so Node renders every stack frame as
 * `file:///abs/path:10:5` — a blanket URL redaction would erase the entire
 * stack and leave the operator a blank trace. The `\b` anchor keeps the
 * lookahead from sliding one character right and matching `ile://`.
 */
const URL_SHAPED = /\b(?!file:\/\/)\w+:\/\/\S+/g;

/** The shape handed to the logger's `err` field: a de-secreted error view. */
interface SanitizedError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * Strip URL-shaped substrings (the realistic leak: `postgres://user:pass@…`
 * from a `DATABASE_URL` a migrate/createDb failure quotes back) out of an
 * error before it is logged.
 *
 * This CANNOT be delegated to `packages/logging`'s redaction: that is pino
 * `redact` over key PATHS, so it removes a `connectionString` FIELD but is
 * blind to a connection string embedded in `err.message`/`err.stack`, which
 * pino's stock `err` serializer writes verbatim. Sanitizing at the call site
 * is the only place the string is still ours to rewrite.
 */
function sanitizeDispatchError(error: unknown): SanitizedError {
  const redact = (text: string): string =>
    text.replace(URL_SHAPED, "[redacted-url]");
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redact(error.message),
      // The stack quotes the message on its first line, so it leaks the same
      // credentials; keep the frames, redact the text.
      ...(error.stack === undefined ? {} : { stack: redact(error.stack) }),
    };
  }
  // A non-Error throw still has to survive — losing it would leave the 503
  // undiagnosable.
  return { name: "NonError", message: redact(String(error)) };
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
    // `error` can quote DATABASE_URL back on a Postgres misconfig, so it is
    // SANITIZED here before it becomes the `err` field — the logger's own
    // redaction is key-path based and cannot see inside a message string
    // (ADR 0034 #4). Never interpolated into `msg`. Level `error`: every read
    // is 503ing until an operator fixes the composition.
    logger.error("apiFetch: webhook app composition failed", {
      err: sanitizeDispatchError(error),
    });
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
