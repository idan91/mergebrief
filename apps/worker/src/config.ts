import {
  loadGeneratorConfig,
  type ContextSourcesConfig,
  type GeneratorConfig,
  type SpendPolicy,
} from "generators";
import {
  loadConfig as loadPersistenceConfig,
  type LoadConfigOptions as PersistenceLoadOptions,
} from "persistence";
import { z } from "zod";
import type { Result, ValueOf } from "types/utils";

// ---------------------------------------------------------------------------
// Public config shape.
// ---------------------------------------------------------------------------

export interface WorkerConfig {
  /** Postgres connection URL; one DB is both store and queue. */
  readonly databaseUrl: string;
  /** Apply migrations at boot vs check-only refusal (MERGEBRIEF_AUTO_MIGRATE). */
  readonly autoMigrate: boolean;
  /** Slots the runner drains jobs into (WORKER_CONCURRENCY). A slot is one
   * in-flight generation: an API stream, or a CLI child for CLI providers. */
  readonly concurrency: number;
  /** Audit retention window the scheduled sweep enforces; null = keep forever
   * (the default). Validated; floor included; by persistence's loader. */
  readonly auditRetentionDays: number | null;
  /** The validated generator block (instance config or zero-config default).
   * Key resolution + boot probes happen inside createGenerator. */
  readonly generator: GeneratorConfig;
  /** The web deployment's public origin; the Entry comment's deep-link base. */
  readonly publicBaseUrl: string;
  /**
   * The daily generation cap the task enforces. Uncapped when the config file
   * carries no `spend` block.
   */
  readonly spend: SpendPolicy;
  /** The credentialed context providers to construct; empty = built-ins only. */
  readonly contextSources: ContextSourcesConfig;
  /** Operator PAT backstop for url-box jobs; undefined disables it. */
  readonly urlBoxToken: string | undefined;
}

// ---------------------------------------------------------------------------
// Errors; expected failure (bad/missing env). Never throws.
// ---------------------------------------------------------------------------

export const ConfigErrorCodes = {
  INVALID: "invalid",
} as const;
export type ConfigErrorCode = ValueOf<typeof ConfigErrorCodes>;

export interface ConfigError {
  readonly code: ConfigErrorCode;
  readonly message: string;
  /**
   * Per-field problems as `field: reason`. Deliberately excludes the offending
   * VALUES; the connection string and the provider key are credentials.
   */
  readonly issues: readonly string[];
}

/** One slot: the bounded default a self-hosted worker boots with. */
const DEFAULT_CONCURRENCY = 1;
/** Zero slots would drain nothing, so the knob's floor is one. */
const MIN_CONCURRENCY = 1;

const publicBaseUrlSchema = z
  .string({ required_error: "required (the Entry comment's deep-link base)" })
  .url("must be a valid URL");

/**
 * Read the slot count. Unset and empty both mean the default: compose passes an
 * unset variable through as an empty string.
 */
function parseConcurrency(raw: string | undefined): Result<number, string> {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, value: DEFAULT_CONCURRENCY };
  }

  const slots = Number(raw);
  if (!Number.isInteger(slots) || slots < MIN_CONCURRENCY) {
    return { ok: false, error: "must be a whole number of at least 1" };
  }

  return { ok: true, value: slots };
}

// ---------------------------------------------------------------------------
// Loader.
// ---------------------------------------------------------------------------

/**
 * Parse worker config from an injected env map, or a `ConfigError` listing the
 * invalid fields (values omitted; keys and connection strings are secrets).
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

  // Loud migration gate: the removed variable must not be silently ignored;
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

  const concurrency = parseConcurrency(env["WORKER_CONCURRENCY"]);
  if (!concurrency.ok) {
    issues.push(`WORKER_CONCURRENCY: ${concurrency.error}`);
  }

  const baseUrlParsed = publicBaseUrlSchema.safeParse(env["PUBLIC_BASE_URL"]);
  if (!baseUrlParsed.success) {
    // Only the reason is echoed, never the value; as on every field here.
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
    !concurrency.ok ||
    !baseUrlParsed.success
  ) {
    return {
      ok: false,
      error: {
        code: ConfigErrorCodes.INVALID,
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
      concurrency: concurrency.value,
      auditRetentionDays: persistence.value.auditRetentionDays,
      generator: generatorConfig.value.generator,
      publicBaseUrl: baseUrlParsed.data,
      spend: generatorConfig.value.spend,
      contextSources: generatorConfig.value.contextSources,
      urlBoxToken: env["MERGEBRIEF_URL_BOX_TOKEN"] || undefined,
    },
  };
}
