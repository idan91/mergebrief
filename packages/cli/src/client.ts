// The client boundary. Takes an injected fetch-compatible function, so command
// tests run against the REAL api Hono app (`app.request` is fetch-shaped) with
// zero network. Every non-2xx becomes a `CliError` carrying the 6-code mapping
// and ONE stderr-ready line: a known wire `code` renders its catalog
// template + HTTP status; anything else relays the server's `error` text
// verbatim. Success bodies pass through VERBATIM — never re-shaped.
import { createI18n, en } from "i18n";
import { CliError, ExitCode, exitCodeForStatus } from "./exit";

// One instance for the process — resources are baked in, init is sync.
const i18n = createI18n();

/** `fetch`-compatible; `app.request` satisfies it in tests. */
export type FetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly redirect?: "manual" | "follow" | "error";
  },
) => Promise<Response>;

export interface ApiClientOptions {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  readonly token: string | undefined;
  /** Extra static per-profile headers (the IdP escape hatch). */
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

export interface ApiRequest {
  readonly method?: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
}

export interface ApiResponse {
  readonly status: number;
  /** The VERBATIM body text — passthrough, never re-serialized. */
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
 * probe: a known wire `code` renders the catalog template (with `params`
 * interpolated); an unknown/absent code — or a render that comes back
 * empty — relays the `error` field verbatim.
 */
function serverErrorLine(bodyText: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed)) {
      const code = parsed["code"];
      const params = parsed["params"];
      if (typeof code === "string" && isKnownErrorCode(code)) {
        // `replace` isolates interpolation variables from i18next OPTIONS —
        // a wire param named `count`/`context` must not steer the lookup.
        const rendered = i18n.t(`errors.${code}`, {
          replace: isRecord(params) ? params : {},
        });
        // Missing params leave literal {{tokens}} (skipOnVariables default):
        // an unrendered template relays the server's line instead.
        if (rendered.trim() !== "" && !rendered.includes("{{")) {
          return `${rendered} (HTTP ${status})`;
        }
      }
      const error = parsed["error"];
      if (typeof error === "string") {
        return `${error} (HTTP ${status})`;
      }
    }
  } catch {
    // Non-JSON error body — fall through to the generic line.
  }
  return `request failed (HTTP ${status})`;
}

export interface ApiClient {
  /** Perform a request; 2xx returns the verbatim body, non-2xx throws CliError. */
  request(req: ApiRequest): Promise<ApiResponse>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.baseUrl.replace(/\/+$/, "");

  return {
    async request(req) {
      const headers: Record<string, string> = {
        accept: "application/json, text/plain",
        ...options.headers,
      };
      if (options.token !== undefined) {
        headers["authorization"] = `Bearer ${options.token}`;
      }
      let body: string | undefined;
      if (req.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(req.body);
      }

      let response: Response;
      try {
        response = await options.fetch(`${base}${req.path}`, {
          method: req.method ?? "GET",
          headers,
          ...(body === undefined ? {} : { body }),
          // Redirects are a PROXY smell, not an API behavior — surface them.
          redirect: "manual",
        });
      } catch (error) {
        throw new CliError(
          ExitCode.GENERIC,
          `could not reach ${base}: ${error instanceof Error ? error.message : "network error"}`,
        );
      }

      // Proxy/IdP detection: the API never redirects and never serves HTML.
      // Either one means the base URL sits behind an interactive login.
      const contentType = response.headers.get("content-type") ?? "";
      if (
        (response.status >= 300 && response.status < 400) ||
        contentType.includes("text/html")
      ) {
        throw new CliError(
          ExitCode.GENERIC,
          `${base} answered like an identity-provider proxy (redirect/HTML) — exempt /api/* from the IdP for Bearer traffic (see docs/self-host)`,
        );
      }

      const bodyText = await response.text();
      if (!response.ok) {
        throw new CliError(
          exitCodeForStatus(response.status),
          serverErrorLine(bodyText, response.status),
        );
      }
      return { status: response.status, bodyText };
    },
  };
}
