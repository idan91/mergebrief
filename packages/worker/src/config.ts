// Worker env config, Zod-parsed from an INJECTED env map — this module NEVER
// reads `process.env`: the startup wiring (`main.ts`) decides what is read.
//
//   DATABASE_URL             required; postgres(ql):// URL (validated by
//                            persistence's own loader — one source of truth).
//   MERGEBRIEF_CONFIG        optional; path to mergebrief.config.yaml. Unset
//                            → zero-config defaults. The generator block
//                            inside selects the adapter; API keys resolve by
//                            env-var NAME (apiKeyEnv) — never from DB or file
//                            config. Its `spend` block carries the daily
//                            generation cap; absent → uncapped.
//   PUBLIC_BASE_URL          required; the web deployment's public origin —
//                            the Entry comment's deep-link base.
//   AUDIT_RETENTION_DAYS     optional; validated by persistence's loader
//                            (30-day floor). Unset → the sweep keeps forever.
//
//   GENERATOR_API_KEY_ENV    REMOVED. Setting it now refuses boot with a
//                            migration hint — a stale deployment must not
//                            silently fall back to the default key variable.
import {
  loadGeneratorConfig,
  type GeneratorConfig,
  type SpendPolicy,
} from "generators";
import {
  loadConfig as loadPersistenceConfig,
  type LoadConfigOptions as PersistenceLoadOptions,
} from "persistence";
import { z } from "zod";
import type { Result, ValueOf } from "types";

// ---------------------------------------------------------------------------
// Public config shape.
// ---------------------------------------------------------------------------

export interface WorkerConfig {
  /** Postgres connection URL — one DB is both store and queue. */
  readonly databaseUrl: string;
  /** Apply migrations at boot vs check-only refusal (MERGEBRIEF_AUTO_MIGRATE). */
  readonly autoMigrate: boolean;
  /** Audit retention window the scheduled sweep enforces; null = keep forever
   * (the default). Validated — floor included — by persistence's loader. */
  readonly auditRetentionDays: number | null;
  /** The validated generator block (instance config or zero-config default).
   * Key resolution + boot probes happen inside createGenerator. */
  readonly generator: GeneratorConfig;
  /** The web deployment's public origin — the Entry comment's deep-link base. */
  readonly publicBaseUrl: string;
  /**
   * The daily generation cap the task enforces. Uncapped when the config file
   * carries no `spend` block.
   */
  readonly spend: SpendPolicy;
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
 * API keys resolve by env-var NAME inside `createGenerator`.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  // Forwarded to persistence's loader: the DATABASE_URL_FILE reader + the
  // shadow-warning sink live there; this loader adds nothing.
  persistenceOptions: PersistenceLoadOptions = {},
): Result<WorkerConfig, ConfigError> {
  const issues: string[] = [];

  const persistence = loadPersistenceConfig(env, persistenceOptions);
  if (!persistence.ok) {
    issues.push(...persistence.error.issues);
  }

  // Loud migration gate: the removed variable must not be silently ignored —
  // a deployment that still sets it believes it controls the key source.
  if (env["GENERATOR_API_KEY_ENV"] !== undefined) {
    issues.push(
      "GENERATOR_API_KEY_ENV: removed — set generator.apiKeyEnv in mergebrief.config.yaml instead",
    );
  }

  const generatorConfig = loadGeneratorConfig(env);
  if (!generatorConfig.ok) {
    issues.push(...generatorConfig.error.issues);
  }

  const baseUrlParsed = publicBaseUrlSchema.safeParse(env["PUBLIC_BASE_URL"]);
  if (!baseUrlParsed.success) {
    // Only the reason is echoed, never the value — as on every field here.
    issues.push(
      ...baseUrlParsed.error.issues.map(
        (issue) => `PUBLIC_BASE_URL: ${issue.message}`,
      ),
    );
  }

  if (
    issues.length > 0 ||
    !persistence.ok ||
    !generatorConfig.ok ||
    !baseUrlParsed.success
  ) {
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
      autoMigrate: persistence.value.autoMigrate,
      auditRetentionDays: persistence.value.auditRetentionDays,
      generator: generatorConfig.value.generator,
      publicBaseUrl: baseUrlParsed.data,
      spend: generatorConfig.value.spend,
    },
  };
}
