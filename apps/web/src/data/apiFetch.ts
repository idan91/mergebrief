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

// Hand-rolled mirror of the api package's wire vocabulary plus the ONE
// web-local member: `malformed` (a 2xx whose body failed to parse — a
// programmer/contract error surfaced as data; never on the wire). The
// Equals + runtime pins in apiFetch.test.ts fail on any drift.
export const ApiErrorCodes = {
  UNAUTHORIZED: "unauthorized",
  INVALID_SIGNATURE: "invalid-signature",
  FORBIDDEN: "forbidden",
  GITHUB_PERMISSION: "github-permission",
  SCOPE_EXCEEDED: "scope-exceeded",
  HUMAN_ONLY: "human-only",
  NO_REPO_WRITE_ACCESS: "no-repo-write-access",
  NOT_FOUND: "not-found",
  INVALID_REQUEST: "invalid-request",
  NOT_A_PR_URL: "not-a-pr-url",
  SIGN_IN_FAILED: "sign-in-failed",
  REQUEST_TOO_LARGE: "request-too-large",
  DIFF_TOO_LARGE: "diff-too-large",
  DRAFT_ALREADY_PUBLISHED: "draft-already-published",
  DRAFT_ANCHOR_ORPHANED: "draft-anchor-orphaned",
  DRAFT_LIMIT_REACHED: "draft-limit-reached",
  PR_CHANGED_SINCE_READ: "pr-changed-since-read",
  PR_REWRITTEN_SINCE_READ: "pr-rewritten-since-read",
  APP_NOT_INSTALLED: "app-not-installed",
  GITHUB_UNAVAILABLE: "github-unavailable",
  GENERATION_FAILED: "generation-failed",
  GENERATION_UNAVAILABLE: "generation-unavailable",
  GENERATION_CONFIG: "generation-config",
  INTERNAL_ERROR: "internal-error",
  MALFORMED: "malformed",
} as const;
export type ApiErrorCode = ValueOf<typeof ApiErrorCodes>;

export interface ApiErrorParams {
  readonly detail: string;
}

function isWireCode(value: string): value is ApiErrorCode {
  return Object.values(ApiErrorCodes).some(
    (code) => code === value && code !== ApiErrorCodes.MALFORMED,
  );
}

/** Typed expected-failure for read-API calls; queryFns throw it (react-query idiom). */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly params: ApiErrorParams | undefined;
  readonly status: number;

  constructor(
    code: ApiErrorCode,
    status: number,
    path: string,
    params?: ApiErrorParams,
  ) {
    super(`api request failed: ${code} (${status}) for ${path}`);
    this.name = "ApiError";
    this.code = code;
    this.params = params;
    this.status = status;
  }
}

function configParams(value: unknown): ApiErrorParams | undefined {
  if (typeof value !== "object" || value === null || !("params" in value)) {
    return undefined;
  }
  const params: unknown = value.params;
  if (
    typeof params !== "object" ||
    params === null ||
    !("detail" in params) ||
    typeof params.detail !== "string"
  ) {
    return undefined;
  }
  return { detail: params.detail };
}

// Fallback for a body that carries no code (a proxy error page, a legacy
// server): the pre-contract status buckets, expressed in the new vocabulary.
function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return ApiErrorCodes.INVALID_REQUEST;
    case 401:
      return ApiErrorCodes.UNAUTHORIZED;
    case 403:
      return ApiErrorCodes.FORBIDDEN;
    case 404:
      return ApiErrorCodes.NOT_FOUND;
    case 409:
      return ApiErrorCodes.PR_CHANGED_SINCE_READ;
    case 413:
      return ApiErrorCodes.REQUEST_TOO_LARGE;
    case 500:
      return ApiErrorCodes.INTERNAL_ERROR;
    // A codeless 503 is typically a proxy answering for a down backend, not
    // the generation feature — bucket it with unreachable, never a coded 503.
    default:
      return ApiErrorCodes.GITHUB_UNAVAILABLE;
  }
}

/**
 * Map a non-2xx response to its typed error, reading the wire body
 * TOLERANTLY: a `{ code }` in the closed wire vocabulary wins; anything else
 * (no body, non-JSON, unknown code, the never-on-wire `malformed`) falls back
 * to the status bucket. Consumes the body — call at most once per response.
 */
export async function errorFromResponse(
  response: Response,
  path: string,
): Promise<ApiError> {
  let code = codeForStatus(response.status);
  let params: ApiErrorParams | undefined;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      typeof body.code === "string" &&
      isWireCode(body.code)
    ) {
      code = body.code;
      if (code === ApiErrorCodes.GENERATION_CONFIG) {
        params = configParams(body);
      }
    }
  } catch {
    // Non-JSON error body — the status bucket stands.
  }
  return new ApiError(code, response.status, path, params);
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
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
    throw await errorFromResponse(response, path);
  }
  try {
    // Annotated, not asserted: `Response.json()` resolves to `any`, and the
    // annotation contains it at the boundary without a bare cast.
    const body: unknown = await response.json();
    return body;
  } catch {
    throw new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
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
    throw await errorFromResponse(response, path);
  }
  return response.text();
}
