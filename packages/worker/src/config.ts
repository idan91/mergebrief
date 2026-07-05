// Worker env config (BRIEF-3 Part 1). Zod-parsed from an INJECTED env map —
// this module NEVER reads `process.env` implicitly at import time: the
// composition root (`main.ts`) decides when and what to read, mirroring
// `packages/persistence/src/config.ts` / `packages/github/src/config.ts`.
//
//   DATABASE_URL             required; postgres(ql):// URL (validated by
//                            persistence's own loader — one source of truth).
//   GENERATOR_API_KEY_ENV    optional; the NAME of the env var holding the
//                            provider API key (BYOK by env-name, ADR 0013/0016
//                            — the key never lives in DB or repo config).
//                            Defaults to ANTHROPIC_API_KEY. The named var must
//                            be set and non-empty.
import { loadConfig as loadPersistenceConfig } from "persistence";
import { z } from "zod";
import type { Result, ValueOf } from "types";

/** The default provider-key env var (the Anthropic adapter's convention). */
const DEFAULT_API_KEY_ENV = "ANTHROPIC_API_KEY";

// ---------------------------------------------------------------------------
// Public config shape.
// ---------------------------------------------------------------------------

export interface WorkerConfig {
  /** Postgres connection URL — one DB is both store and queue (ADR 0015). */
  readonly databaseUrl: string;
  /** The env-var NAME the provider key was resolved from (for logs — safe). */
  readonly providerApiKeyEnv: string;
  /** The resolved provider API key. Never log, never echo in errors. */
  readonly providerApiKey: string;
}

// ---------------------------------------------------------------------------
// Errors — expected failure (bad/missing env). Never throws.
// ---------------------------------------------------------------------------

export const ConfigErrorCode = {
  INVALID: "invalid",
} as const;
export type ConfigErrorCode = ValueOf<typeof ConfigErrorCode>;

export interface ConfigError {
  readonly code: ConfigErrorCode;
  readonly message: string;
  /**
   * Per-field problems as `field: reason`. Deliberately excludes the offending
   * VALUES — the connection string and the provider key are credentials.
   */
  readonly issues: readonly string[];
}

const keyEnvNameSchema = z
  .string()
  .min(1, "GENERATOR_API_KEY_ENV must not be empty")
  .optional();

// ---------------------------------------------------------------------------
// Loader.
// ---------------------------------------------------------------------------

/**
 * Parse worker config from an injected env map, or a `ConfigError` listing the
 * invalid fields (values omitted — the key and connection string are secrets).
 * The provider key is resolved INDIRECTLY: `GENERATOR_API_KEY_ENV` names the
 * variable, the value is read from that name (BYOK-by-env-name, ADR 0013).
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Result<WorkerConfig, ConfigError> {
  const issues: string[] = [];

  const persistence = loadPersistenceConfig(env);
  if (!persistence.ok) {
    issues.push(...persistence.error.issues);
  }

  const keyEnvParsed = keyEnvNameSchema.safeParse(env["GENERATOR_API_KEY_ENV"]);
  let providerApiKeyEnv = DEFAULT_API_KEY_ENV;
  let providerApiKey: string | undefined;
  if (!keyEnvParsed.success) {
    issues.push(
      ...keyEnvParsed.error.issues.map((issue) => `GENERATOR_API_KEY_ENV: ${issue.message}`),
    );
  } else {
    providerApiKeyEnv = keyEnvParsed.data ?? DEFAULT_API_KEY_ENV;
    const key = env[providerApiKeyEnv];
    if (typeof key !== "string" || key.length === 0) {
      // Name the VARIABLE, never any value: the message is log-safe.
      issues.push(
        `${providerApiKeyEnv}: provider API key env var is not set (named by GENERATOR_API_KEY_ENV)`,
      );
    } else {
      providerApiKey = key;
    }
  }

  if (!persistence.ok || providerApiKey === undefined) {
    return {
      ok: false,
      error: {
        code: ConfigErrorCode.INVALID,
        message: "invalid worker configuration",
        issues,
      },
    };
  }

  return {
    ok: true,
    value: {
      databaseUrl: persistence.value.databaseUrl,
      providerApiKeyEnv,
      providerApiKey,
    },
  };
}
