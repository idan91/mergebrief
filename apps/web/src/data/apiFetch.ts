// Client fetch attaches the session cookie; SSR forwards it to the API over
// HTTP, through the same authorization gate the browser meets.
// Do not read persistence directly from a server function.
// A transport failure returns a sanitized 503 without internal details.
import { createSerializationAdapter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { ApiErrorCodes } from "contract";
import { HttpStatuses } from "types/http";
import type { ValueOf } from "types/utils";

import { requestSignIn } from "./sign-in";
import { reportSignedOut } from "./signed-out";

// The wire vocabulary, owned by `contract`, plus the ONE web-local member:
// `malformed` is a 2xx whose body failed to parse, a contract error surfaced
// as data and never seen on the wire.
const WebApiErrorCodes = {
  ...ApiErrorCodes,
  MALFORMED: "malformed",
} as const;
export { WebApiErrorCodes as ApiErrorCodes };
export type ApiErrorCode = ValueOf<typeof WebApiErrorCodes>;

export interface ApiErrorParams {
  readonly detail: string;
}

function isWireCode(value: string): value is ApiErrorCode {
  return Object.values(ApiErrorCodes).some((code) => code === value);
}

/** The `code` a wire body carries, when it is one of the vocabulary; a codeless body is undefined. */
export function readWireCode(body: unknown): ApiErrorCode | undefined {
  if (typeof body !== "object" || body === null || !("code" in body)) {
    return undefined;
  }
  return typeof body.code === "string" && isWireCode(body.code)
    ? body.code
    : undefined;
}

/** Whether the code asks the viewer to sign in: the session is gone, or GitHub refused it. */
export function isSignInRequired(code: ApiErrorCode): boolean {
  return (
    code === WebApiErrorCodes.UNAUTHORIZED ||
    code === WebApiErrorCodes.SIGNED_OUT
  );
}

/** Typed expected-failure for read-API calls; queryFns throw it (react-query idiom). */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly params: ApiErrorParams | undefined;
  readonly status: number;
  readonly path: string;

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
    this.path = path;
  }
}

/** An `ApiError` as SSR dehydration carries it: every constructor argument. */
interface SerializedApiError {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly path: string;
  readonly params: ApiErrorParams | undefined;
}

/**
 * Start's default dehydrates any `Error` as a bare `Error(message)`, so a
 * loader's `ApiError` would hydrate without its class or `code`, and the
 * error screen's copy would change from the server render to the generic one.
 */
export const apiErrorSerializationAdapter = createSerializationAdapter<
  ApiError,
  SerializedApiError
>({
  key: "api-error",
  test: (value): value is ApiError => value instanceof ApiError,
  toSerializable: (error) => ({
    code: error.code,
    status: error.status,
    path: error.path,
    params: error.params,
  }),
  fromSerializable: (value) =>
    new ApiError(value.code, value.status, value.path, value.params),
});

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
      return WebApiErrorCodes.INVALID_REQUEST;
    case 401:
      return WebApiErrorCodes.UNAUTHORIZED;
    case 403:
      return WebApiErrorCodes.FORBIDDEN;
    case 404:
      return WebApiErrorCodes.NOT_FOUND;
    case 409:
      return WebApiErrorCodes.PR_CHANGED_SINCE_READ;
    case 413:
      return WebApiErrorCodes.REQUEST_TOO_LARGE;
    // A codeless 5xx is a proxy answering for a down backend: only a code
    // the API wrote can name GitHub as the side that failed.
    default:
      return WebApiErrorCodes.INTERNAL_ERROR;
  }
}

/**
 * Map a non-2xx response to its typed error, reading the wire body
 * TOLERANTLY: a `{ code }` in the closed wire vocabulary wins; anything else
 * (no body, non-JSON, unknown code, the never-on-wire `malformed`) falls back
 * to the status bucket. Consumes the body, call at most once per response.
 */
export async function errorFromResponse(
  response: Response,
  path: string,
): Promise<ApiError> {
  let code = codeForStatus(response.status);
  let params: ApiErrorParams | undefined;
  try {
    const body: unknown = await response.json();
    const wireCode = readWireCode(body);
    if (wireCode !== undefined) {
      code = wireCode;
      if (code === WebApiErrorCodes.GENERATION_CONFIG) {
        params = configParams(body);
      }
    }
  } catch {
    // Non-JSON error body, the status bucket stands.
  }
  return new ApiError(code, response.status, path, params);
}

/**
 * The narrow request-init surface this boundary forwards. Typed explicitly,
 * not `RequestInit`, so the SSR branch provably forwards every field it
 * accepts.
 */
export interface ApiFetchInit {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly headers?: Readonly<Record<string, string>>;
  /** A Blob is the image upload, sent from the browser only. */
  readonly body?: string | Blob;
  readonly signal?: AbortSignal;
  /**
   * The caller reads a 401 as the signed-out state it renders, so the
   * browser stays put. Every other read's 401 GitHub answered for a live
   * session sends the viewer to sign in; a write's never does.
   */
  readonly unauthorizedIsSignedOut?: boolean;
  /**
   * A write with nothing typed to lose: its 401 GitHub answered for a live
   * session sends the viewer to sign in, as a read's does.
   */
  readonly unauthorizedLeavesForSignIn?: boolean;
}

/** The init for a read whose 401 is the signed-out state it renders. */
export const SIGNED_OUT_READ: ApiFetchInit = { unauthorizedIsSignedOut: true };

/** The wire code of a 401, read off a clone so the caller keeps the body. */
async function readUnauthorizedCode(
  response: Response,
): Promise<ApiErrorCode | undefined> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  return readWireCode(body);
}

/**
 * A `signed-out` 401 never leaves: GitHub would sign an authorized viewer
 * straight back in, undoing a sign-out from another tab. A write's 401
 * stays with its caller, which shows its own outcome while the text the
 * viewer typed is still on the page.
 */
async function answerUnauthorized(
  response: Response,
  leavesForSignIn: boolean,
): Promise<void> {
  const code = await readUnauthorizedCode(response);
  if (code === WebApiErrorCodes.SIGNED_OUT) {
    reportSignedOut();
    return;
  }
  if (leavesForSignIn) {
    requestSignIn();
  }
}

function isRead(init: ApiFetchInit): boolean {
  return init.method === undefined || init.method === "GET";
}

const dispatch = createIsomorphicFn()
  .client(async (path: string, init?: ApiFetchInit): Promise<Response> => {
    const {
      unauthorizedIsSignedOut = false,
      unauthorizedLeavesForSignIn = false,
      ...request
    } = init ?? {};
    const response = await fetch(path, request);
    if (response.status === HttpStatuses.UNAUTHORIZED) {
      const mayLeave = isRead(request) || unauthorizedLeavesForSignIn;
      const leavesForSignIn = mayLeave && !unauthorizedIsSignedOut;
      await answerUnauthorized(response, leavesForSignIn);
    }
    return response;
  })
  .server(async (path: string, init?: ApiFetchInit): Promise<Response> => {
    const [{ getRequestHeader }, { fetchFromApi }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("../server/api/transport"),
    ]);
    return fetchFromApi(path, getRequestHeader("cookie"), init);
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
    throw new ApiError(WebApiErrorCodes.MALFORMED, response.status, path);
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
