// Worker env config (BRIEF-3 Part 1; BRIEF-11 instance config). Zod-parsed
// from an INJECTED env map — this module NEVER reads `process.env` implicitly
// at import time: the composition root (`main.ts`) decides when and what to
// read, mirroring `packages/persistence/src/config.ts`.
//
//   DATABASE_URL             required; postgres(ql):// URL (validated by
//                            persistence's own loader — one source of truth).
//   MERGEBRIEF_CONFIG        optional; path to mergebrief.config.yaml. Unset
//                            → zero-config defaults (anthropic +
//                            ANTHROPIC_API_KEY + Opus 4.8). The generator
//                            block inside selects the adapter; API keys still
//                            resolve by env-var NAME (apiKeyEnv — BYOK, ADR
//                            0013: the key never lives in DB or file config).
//   PUBLIC_BASE_URL          required; the web deployment's public origin —
//                            the Entry comment's deep-link base (ADR 0016 #3).
//
//   GENERATOR_API_KEY_ENV    REMOVED (BRIEF-11 decision 6). Setting it now
//                            refuses boot with a migration hint — a stale
//                            deployment must not silently fall back to the
//                            default key variable.
import { loadGeneratorConfig, type GeneratorConfig } from "generators";
import { loadConfig as loadPersistenceConfig } from "persistence";
import { z } from "zod";
import type { Result, ValueOf } from "types";

// ---------------------------------------------------------------------------
// Public config shape.
// ---------------------------------------------------------------------------

export interface WorkerConfig {
  /** Postgres connection URL — one DB is both store and queue (ADR 0015). */
  readonly databaseUrl: string;
  /** The validated generator block (instance config or zero-config default).
   * Key resolution + boot probes happen inside createGenerator. */
  readonly generator: GeneratorConfig;
  /** The web deployment's public origin — the Entry comment's deep-link base. */
  readonly publicBaseUrl: string;
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

const publicBaseUrlSchema = z
  .string({ required_error: "required (the Entry comment's deep-link base)" })
  .url("must be a valid URL");

// ---------------------------------------------------------------------------
// Loader.
// ---------------------------------------------------------------------------

/**
 * Parse worker config from an injected env map, or a `ConfigError` listing the
 * invalid fields (values omitted — keys and connection strings are secrets).
 * The generator block comes from the instance config (`MERGEBRIEF_CONFIG` →
 * mergebrief.config.yaml) or the zero-config default; API keys resolve by
 * env-var NAME inside `createGenerator` (BYOK-by-env-name, ADR 0013).
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Result<WorkerConfig, ConfigError> {
  const issues: string[] = [];

  const persistence = loadPersistenceConfig(env);
  if (!persistence.ok) {
    issues.push(...persistence.error.issues);
  }

  // Loud migration gate: the removed variable must not be silently ignored —
  // a deployment that still sets it believes it controls the key source.
  if (env["GENERATOR_API_KEY_ENV"] !== undefined) {
    issues.push(
      "GENERATOR_API_KEY_ENV: removed (BRIEF-11) — set generator.apiKeyEnv in mergebrief.config.yaml instead",
    );
  }

  const generatorConfig = loadGeneratorConfig(env);
  if (!generatorConfig.ok) {
    issues.push(...generatorConfig.error.issues);
  }

  const baseUrlParsed = publicBaseUrlSchema.safeParse(env["PUBLIC_BASE_URL"]);
  if (!baseUrlParsed.success) {
    // The value may be misconfigured but is not a secret; still, only the
    // reason is echoed — consistent with the rest of this surface.
    issues.push(...baseUrlParsed.error.issues.map((issue) => `PUBLIC_BASE_URL: ${issue.message}`));
  }

  if (issues.length > 0 || !persistence.ok || !generatorConfig.ok || !baseUrlParsed.success) {
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
      generator: generatorConfig.value.generator,
      publicBaseUrl: baseUrlParsed.data,
    },
  };
}
