// The API process's own configuration, parsed from an INJECTED env map: the
// address it listens on and the values `createApp` needs that no other loader
// owns. Every other config block comes from the package that owns it.
import { isHttpUrl, parseServerVersion } from "persistence";
import type { Result, ValueOf } from "types/utils";
import { z } from "zod/v4";
import { DEFAULT_UPDATE_CHECK_URL } from "./update-check/consts";

/** Loopback by default: the API is reached through the web tier, not directly. */
export const DEFAULT_API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 3001;

/** The env var name the reviewer session tokens seal under. */
export const SESSION_KEY_REF = "SESSION_KEY_V1";

export const ConfigErrorCodes = {
  INVALID: "invalid",
} as const;
export type ConfigErrorCode = ValueOf<typeof ConfigErrorCodes>;

export interface ConfigError {
  readonly code: ConfigErrorCode;
  /** Per-field problems as `field: reason`, never the offending VALUES. */
  readonly issues: readonly string[];
}

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  /** The origin the OAuth callback URL is built from. */
  readonly publicBaseUrl: string;
  readonly serverVersion: string;
  /** `MERGEBRIEF_UPDATE_CHECK`: the hourly fetch of the release manifest. */
  readonly updateCheck: boolean;
  readonly updateCheckUrl: string;
}

const TRUE_TOKENS: ReadonlySet<string> = new Set(["true", "1", "yes", "on"]);
const FALSE_TOKENS: ReadonlySet<string> = new Set(["false", "0", "no", "off"]);

/** `z.coerce.boolean()` reads "false" as true; this maps the explicit tokens.
 * Unset and empty both take the default: compose passes an unset variable
 * through as an empty string. */
function parseEnvBool(defaultValue: boolean): z.ZodType<boolean> {
  return z.preprocess(
    (value) => {
      if (value === undefined) {
        return defaultValue;
      }
      if (typeof value !== "string") {
        return value;
      }
      const token = value.trim().toLowerCase();
      if (token === "") {
        return defaultValue;
      }
      if (TRUE_TOKENS.has(token)) {
        return true;
      }
      if (FALSE_TOKENS.has(token)) {
        return false;
      }
      return value;
    },
    z.boolean({ error: "must be true or false" }),
  );
}

const PortSchema = z
  .string()
  .refine((value) => /^\d+$/.test(value), "MERGEBRIEF_API_PORT must be a port")
  .transform((value) => Number(value))
  .refine(
    (value) => value >= 0 && value <= 65535,
    "MERGEBRIEF_API_PORT must be a port",
  );

const PUBLIC_BASE_URL_REQUIRED =
  "PUBLIC_BASE_URL is required for reviewer auth";

const ConfigSchema = z.object({
  MERGEBRIEF_API_HOST: z.string().min(1).optional(),
  MERGEBRIEF_API_PORT: PortSchema.optional(),
  PUBLIC_BASE_URL: z
    .string({ error: PUBLIC_BASE_URL_REQUIRED })
    .min(1, { error: PUBLIC_BASE_URL_REQUIRED, abort: true })
    .refine(
      isHttpUrl,
      "PUBLIC_BASE_URL must be an absolute http(s) URL without credentials",
    ),
  MERGEBRIEF_UPDATE_CHECK: parseEnvBool(true),
  MERGEBRIEF_UPDATE_CHECK_URL: z
    .string()
    .refine(
      isHttpUrl,
      "MERGEBRIEF_UPDATE_CHECK_URL must be an absolute http(s) URL without credentials",
    )
    .optional(),
});

function buildConfigError(issues: readonly string[]): ConfigError {
  return { code: ConfigErrorCodes.INVALID, issues };
}

/** The one API knob the migrate entry needs: the version it records. */
export function loadServerVersion(
  env: Readonly<Record<string, string | undefined>>,
): Result<string, ConfigError> {
  const parsed = parseServerVersion(env["SERVER_VERSION"]);
  if (!parsed.ok) {
    return {
      ok: false,
      error: buildConfigError([`SERVER_VERSION: ${parsed.error}`]),
    };
  }
  return parsed;
}

/** Parse the process env into the API's own knobs. Never throws. */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
): Result<ApiConfig, ConfigError> {
  const parsed = ConfigSchema.safeParse(env);
  const serverVersion = loadServerVersion(env);

  const issues: string[] = [];
  if (!parsed.success) {
    issues.push(
      ...parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  }
  if (!serverVersion.ok) {
    issues.push(...serverVersion.error.issues);
  }
  const refused = !parsed.success || !serverVersion.ok;
  if (refused) {
    return { ok: false, error: buildConfigError(issues) };
  }

  const value = parsed.data;
  return {
    ok: true,
    value: {
      host: value.MERGEBRIEF_API_HOST ?? DEFAULT_API_HOST,
      port: value.MERGEBRIEF_API_PORT ?? DEFAULT_API_PORT,
      publicBaseUrl: value.PUBLIC_BASE_URL,
      serverVersion: serverVersion.value,
      updateCheck: value.MERGEBRIEF_UPDATE_CHECK,
      updateCheckUrl:
        value.MERGEBRIEF_UPDATE_CHECK_URL ?? DEFAULT_UPDATE_CHECK_URL,
    },
  };
}
