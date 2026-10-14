// Keep success bodies verbatim. Non-2xx responses become one stderr line plus an exit code.
// Known wire codes use catalog templates and HTTP status; unknown ones relay server error text.
// Inject fetch so CLI tests exercise the real Hono app without network calls.
import { createI18n, en } from "i18n";
import type { Mutable, Result } from "types/utils";
import { CliError, ExitCodes, exitCodeForStatus, type ExitCode } from "./exit";
import { VERSION_HEADER } from "./version";

// One instance for the process, resources are baked in, init is sync.
const i18n = createI18n();

const RETRY_AFTER_HEADER = "retry-after";
const WHOLE_SECONDS = /^\d+$/;
const IMF_FIXDATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const MS_PER_SECOND = 1000;
const UNRECOGNIZED_RETRY_AFTER = "not delta-seconds or an IMF-fixdate";
const RETRY_AFTER_OUT_OF_RANGE = "delta-seconds past the safe integer range";
const INVALID_RETRY_AFTER_DATE = "an IMF-fixdate that is no calendar date";

/** Whole seconds to wait, never negative. */
type RetryAfterParse = Result<number, string>;

/**
 * This CLI's version, stamped at build time from `package.json` (`0.0.0` in
 * the repo, the dev sentinel that switches every version check off; the tag
 * at publish). Sent as the user-agent so an audit row can say which client
 * did something. Purely forensic: the server must never branch on it.
 */
export const CLI_VERSION: string =
  typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0";

/** The request options the client hands its fetch. */
export interface FetchInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | Uint8Array;
  readonly redirect?: "manual" | "follow" | "error";
}

/** `fetch`-compatible; `app.request` satisfies it in tests. */
export type FetchLike = (input: string, init?: FetchInit) => Promise<Response>;

export interface ApiClientOptions {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  readonly token: string | undefined;
  /** Extra static per-profile headers (the IdP escape hatch). */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** The build-time version by default; a test seam. */
  readonly cliVersion?: string | undefined;
  /** Told once, on the first response that carries `MergeBrief-Version`. */
  readonly onServerVersion?: ((version: string) => void) | undefined;
  /** Test seam; production takes the clock. */
  readonly now?: () => number;
}

/** A raw body sent as-is under its own content type (an image upload). */
export interface BytesBody {
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface ApiRequest {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  /** JSON-encoded; exclusive with `bytes`. */
  readonly body?: unknown;
  readonly bytes?: BytesBody;
}

export interface ApiResponse {
  readonly status: number;
  /** The VERBATIM body text, passthrough, never re-serialized. */
  readonly bodyText: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKnownErrorCode(value: string): value is keyof typeof en.errors {
  return Object.hasOwn(en.errors, value);
}

/**
 * Best-effort extraction of the server's one-line error text. Tolerant
 * probe: a known wire `code` renders its catalog line; an unknown or absent
 * code, or a render that comes back empty, relays the `error` field verbatim.
 */
function resolveCatalogErrorLine(
  body: Record<string, unknown>,
  statusLabel: string,
): string | undefined {
  const code = body["code"];
  if (typeof code !== "string" || !isKnownErrorCode(code)) {
    return undefined;
  }

  const rendered = i18n.t(`errors.${code}`);
  if (rendered.trim() === "") {
    return undefined;
  }
  const line = `${rendered} (${statusLabel})`;
  return line;
}

function serverErrorLine(bodyText: string, statusLabel: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed)) {
      const catalogLine = resolveCatalogErrorLine(parsed, statusLabel);
      if (catalogLine !== undefined) {
        return catalogLine;
      }
      const error = parsed["error"];
      if (typeof error === "string") {
        return `${error} (${statusLabel})`;
      }
    }
  } catch {
    // Non-JSON error body, fall through to the generic line.
  }
  return `request failed (${statusLabel})`;
}

/** Seconds until an IMF-fixdate, rounded up; a past date waits 0. */
function parseRetryAfterDate(header: string, nowMs: number): RetryAfterParse {
  const isFixdate = IMF_FIXDATE.test(header);
  if (!isFixdate) {
    return { ok: false, error: UNRECOGNIZED_RETRY_AFTER };
  }
  const retryAtMs = Date.parse(header);
  const isCalendarDate = !Number.isNaN(retryAtMs);
  if (!isCalendarDate) {
    return { ok: false, error: INVALID_RETRY_AFTER_DATE };
  }

  const waitSeconds = Math.ceil((retryAtMs - nowMs) / MS_PER_SECOND);
  const clampedSeconds = Math.max(0, waitSeconds);
  return { ok: true, value: clampedSeconds };
}

/** Digits-only delta seconds or an IMF-fixdate; anything else is refused. */
function parseRetryAfterSeconds(
  header: string,
  nowMs: number,
): RetryAfterParse {
  const isWholeSeconds = WHOLE_SECONDS.test(header);
  if (!isWholeSeconds) {
    return parseRetryAfterDate(header, nowMs);
  }

  const seconds = Number(header);
  const isSafeSeconds = Number.isSafeInteger(seconds);
  if (!isSafeSeconds) {
    return { ok: false, error: RETRY_AFTER_OUT_OF_RANGE };
  }
  return { ok: true, value: seconds };
}

function describeStatus(
  response: Response,
  exitCode: ExitCode,
  nowMs: number,
): string {
  const label = `HTTP ${response.status}`;
  if (exitCode !== ExitCodes.RATE_LIMITED) {
    return label;
  }

  const header = response.headers.get(RETRY_AFTER_HEADER);
  if (header === null) {
    return label;
  }
  const parsed = parseRetryAfterSeconds(header, nowMs);
  if (!parsed.ok) {
    return label;
  }
  return `${label}, retry after ${parsed.value}s`;
}

export interface ApiClient {
  /** Perform a request; 2xx returns the verbatim body, non-2xx throws CliError. */
  request(req: ApiRequest): Promise<ApiResponse>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const cliVersion = options.cliVersion ?? CLI_VERSION;
  const userAgent = `mergebrief/${cliVersion}`;
  const now = options.now ?? Date.now;
  let serverVersion: string | undefined;

  function noteServerVersion(response: Response): void {
    const header = response.headers.get(VERSION_HEADER);
    if (serverVersion === undefined && header !== null && header !== "") {
      serverVersion = header;
      options.onServerVersion?.(header);
    }
  }

  return {
    async request(req) {
      const headers: Record<string, string> = {
        accept: "application/json, text/plain",
        "user-agent": userAgent,
        ...options.headers,
      };
      if (options.token !== undefined) {
        headers["authorization"] = `Bearer ${options.token}`;
      }
      let body: string | Uint8Array | undefined;
      if (req.bytes !== undefined) {
        headers["content-type"] = req.bytes.contentType;
        body = req.bytes.body;
      } else if (req.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(req.body);
      }

      const init: Mutable<FetchInit> = {
        method: req.method ?? "GET",
        headers,
        // Redirects are a PROXY smell, not an API behavior, surface them.
        redirect: "manual",
      };

      if (body !== undefined) {
        init.body = body;
      }

      let response: Response;
      try {
        response = await options.fetch(`${base}${req.path}`, init);
      } catch (error) {
        throw new CliError(
          ExitCodes.GENERIC,
          `could not reach ${base}: ${error instanceof Error ? error.message : "network error"}`,
        );
      }

      noteServerVersion(response);

      // Proxy/IdP detection: the API never redirects and never serves HTML.
      // Either one means the base URL sits behind an interactive login.
      const contentType = response.headers.get("content-type") ?? "";
      if (
        (response.status >= 300 && response.status < 400) ||
        contentType.includes("text/html")
      ) {
        throw new CliError(
          ExitCodes.GENERIC,
          `${base} answered like an identity-provider proxy (redirect/HTML) — exempt /api/* from the IdP for Bearer traffic (see docs/self-host)`,
        );
      }

      const bodyText = await response.text();
      if (!response.ok) {
        const exitCode = exitCodeForStatus(response.status);
        const statusLabel = describeStatus(response, exitCode, now());
        throw new CliError(exitCode, serverErrorLine(bodyText, statusLabel));
      }
      return { status: response.status, bodyText };
    },
  };
}
