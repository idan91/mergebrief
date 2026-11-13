// The API process's own configuration, parsed from an INJECTED env map: the
// address it listens on and the values `createApp` needs that no other loader
// owns. Every other config block comes from the package that owns it.
import { isHttpUrl, parseServerVersion } from "persistence";
import { Runtimes } from "types/runtime";
import type { Mutable, Result, ValueOf } from "types/utils";
import { z } from "zod/v4";

/** Loopback by default: the API is reached through the web tier, not directly. */
export const DEFAULT_API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 3001;

/** The env var NAME new GitHub tokens seal under when `SESSION_KEY_REF` is unset. */
const DEFAULT_SESSION_KEY_REF = "SESSION_KEY_V1";

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
  /** `MERGEBRIEF_OUT_DIR`, as written; never set in production. */
  readonly localBriefsDir?: string;
  /** `SESSION_KEY_REF`: the env var NAME sign-in and refresh seal under. */
  readonly sessionKeyRef: string;
}

// A ref names a variable, so a value shaped like key material is refused
// before it could be logged as a name.
const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const SessionKeyRefSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === "") {
      return DEFAULT_SESSION_KEY_REF;
    }
    return value;
  },
  z
    .string()
    .regex(
      ENV_VAR_NAME_PATTERN,
      "must name an env var, such as SESSION_KEY_V2",
    ),
);

const PortSchema = z
  .string()
  .refine((value) => /^\d+$/.test(value), "MERGEBRIEF_API_PORT must be a port")
  .transform((value) => Number(value))
  .refine(
    (value) => value >= 0 && value <= 65535,
    "MERGEBRIEF_API_PORT must be a port",
  );

const PRODUCTION_NODE_ENV = "production";

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
  MERGEBRIEF_OUT_DIR: z.string().optional(),
  MERGEBRIEF_RUNTIME: z.string().optional(),
  NODE_ENV: z.string().optional(),
  SESSION_KEY_REF: SessionKeyRefSchema,
});
type ParsedConfig = z.infer<typeof ConfigSchema>;

/**
 * The dev file surface. The shipped image bakes its runtime marker, so the
 * image never serves it whatever else the environment says.
 */
function readLocalBriefsDir(value: ParsedConfig): string | undefined {
  const runsShippedImage = value.MERGEBRIEF_RUNTIME === Runtimes.COMPOSE_WORKER;
  const runsProduction =
    runsShippedImage || value.NODE_ENV === PRODUCTION_NODE_ENV;
  if (runsProduction) {
    return undefined;
  }

  const dir = value.MERGEBRIEF_OUT_DIR?.trim();
  return dir === "" ? undefined : dir;
}

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
  const config: Mutable<ApiConfig> = {
    host: value.MERGEBRIEF_API_HOST ?? DEFAULT_API_HOST,
    port: value.MERGEBRIEF_API_PORT ?? DEFAULT_API_PORT,
    publicBaseUrl: value.PUBLIC_BASE_URL,
    serverVersion: serverVersion.value,
    sessionKeyRef: value.SESSION_KEY_REF,
  };

  const localBriefsDir = readLocalBriefsDir(value);
  if (localBriefsDir !== undefined) {
    config.localBriefsDir = localBriefsDir;
  }
  return { ok: true, value: config };
}
