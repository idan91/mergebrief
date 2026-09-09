import "@tanstack/react-start/server-only";

import type { Result, ValueOf } from "types";

/** The API's own default: loopback, the port `apps/api` listens on. */
export const DEFAULT_API_ORIGIN = "http://127.0.0.1:3001";

/** Names the internal API origin. Compose points it at the `api` service. */
export const API_ORIGIN_ENV_VAR = "MERGEBRIEF_API_ORIGIN";

export const OriginErrorCodes = {
  UNPARSEABLE: "unparseable",
  NOT_HTTP: "not-http",
} as const;
export type OriginErrorCode = ValueOf<typeof OriginErrorCodes>;

export interface OriginError {
  readonly code: OriginErrorCode;
  readonly message: string;
}

/**
 * The trusted internal API origin, taken from configuration and never from
 * request input: this value decides where a proxied request goes, so a
 * caller-derived destination would be a request-forgery surface.
 */
export function resolveApiOrigin(
  env: Readonly<Record<string, string | undefined>>,
): Result<string, OriginError> {
  const configured = env[API_ORIGIN_ENV_VAR];
  const raw =
    configured === undefined || configured.length === 0
      ? DEFAULT_API_ORIGIN
      : configured;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      error: {
        code: OriginErrorCodes.UNPARSEABLE,
        message: `${API_ORIGIN_ENV_VAR} is not an absolute URL`,
      },
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      error: {
        code: OriginErrorCodes.NOT_HTTP,
        message: `${API_ORIGIN_ENV_VAR} must be an http or https origin`,
      },
    };
  }
  return { ok: true, value: url.origin };
}
