import { parseHugeSpanRatio, type RevisionNarrativeConfig } from "brief-core";
import {
  loadGeneratorConfig,
  type ContextSourcesConfig,
  type GeneratorConfig,
  type SpendPolicy,
  type TrackerConfig,
} from "generators";
import {
  isHttpUrl,
  loadConfig as loadPersistenceConfig,
  parseServerVersion,
  type ResolveDsnOptions,
} from "persistence";
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
  /** Days a closed pull request outlives its close before the scheduled
   * sweep erases it; null = keep forever (the default). */
  readonly prRetentionDays: number | null;
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
  /** The instance's default boards; a repo's own settings replace them. */
  readonly trackers: readonly TrackerConfig[];
  /** `SERVER_VERSION`, recorded in `instance_version` at boot; `dev` when unset. */
  readonly serverVersion: string;
  /** `REVISION_NARRATIVE_ENABLED`; on when unset. */
  readonly revisionNarrative: RevisionNarrativeConfig;
  /** `HUGE_SPAN_RATIO`; brief-core's default when unset. */
  readonly hugeSpanRatio: number;
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

const DEFAULT_REVISION_NARRATIVE = true;

const TRUE_TOKENS: ReadonlySet<string> = new Set(["true", "1", "yes", "on"]);
const FALSE_TOKENS: ReadonlySet<string> = new Set(["false", "0", "no", "off"]);

/** The worker's own knobs, parsed beside the loaders other packages own. */
interface WorkerKnobs {
  readonly concurrency: number;
  readonly publicBaseUrl: string;
  readonly serverVersion: string;
  readonly revisionNarrative: RevisionNarrativeConfig;
  readonly hugeSpanRatio: number;
}

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

function parsePublicBaseUrl(raw: string | undefined): Result<string, string> {
  if (raw === undefined || raw === "") {
    return {
      ok: false,
      error: "required (the Entry comment's deep-link base)",
    };
  }
  const httpUrl = isHttpUrl(raw);
  if (!httpUrl) {
    return {
      ok: false,
      error: "must be an absolute http(s) URL without credentials",
    };
  }
  return { ok: true, value: raw };
}

/** Unset and empty both take the default; any other token outside the two
 * sets refuses boot rather than reading as on. */
function parseFlag(
  raw: string | undefined,
  defaultValue: boolean,
): Result<boolean, string> {
  const token = raw?.trim().toLowerCase() ?? "";
  if (token === "") {
    return { ok: true, value: defaultValue };
  }
  const isTrueToken = TRUE_TOKENS.has(token);
  if (isTrueToken) {
    return { ok: true, value: true };
  }
  const isFalseToken = FALSE_TOKENS.has(token);
  if (isFalseToken) {
    return { ok: true, value: false };
  }
  return { ok: false, error: "must be true or false" };
}

function parseWorkerKnobs(
  env: Readonly<Record<string, string | undefined>>,
): Result<WorkerKnobs, readonly string[]> {
  const concurrency = parseConcurrency(env["WORKER_CONCURRENCY"]);
  const publicBaseUrl = parsePublicBaseUrl(env["PUBLIC_BASE_URL"]);
  const serverVersion = parseServerVersion(env["SERVER_VERSION"]);
  const narrative = parseFlag(
    env["REVISION_NARRATIVE_ENABLED"],
    DEFAULT_REVISION_NARRATIVE,
  );
  const hugeSpanRatio = parseHugeSpanRatio(env["HUGE_SPAN_RATIO"]);

  const allParsed =
    concurrency.ok &&
    publicBaseUrl.ok &&
    serverVersion.ok &&
    narrative.ok &&
    hugeSpanRatio.ok;
  if (allParsed) {
    return {
      ok: true,
      value: {
        concurrency: concurrency.value,
        publicBaseUrl: publicBaseUrl.value,
        serverVersion: serverVersion.value,
        revisionNarrative: { enabled: narrative.value },
        hugeSpanRatio: hugeSpanRatio.value,
      },
    };
  }

  const keyed = [
    ["WORKER_CONCURRENCY", concurrency],
    ["PUBLIC_BASE_URL", publicBaseUrl],
    ["SERVER_VERSION", serverVersion],
    ["REVISION_NARRATIVE_ENABLED", narrative],
    ["HUGE_SPAN_RATIO", hugeSpanRatio],
  ] as const;
  const issues = keyed.flatMap(([key, parsed]) =>
    parsed.ok ? [] : [`${key}: ${parsed.error}`],
  );
  return { ok: false, error: issues };
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
  persistenceOptions: ResolveDsnOptions = {},
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

  const knobs = parseWorkerKnobs(env);
  if (!knobs.ok) {
    issues.push(...knobs.error);
  }

  const refused =
    issues.length > 0 || !persistence.ok || !generatorConfig.ok || !knobs.ok;
  if (refused) {
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
      concurrency: knobs.value.concurrency,
      auditRetentionDays: persistence.value.auditRetentionDays,
      prRetentionDays: persistence.value.prRetentionDays,
      generator: generatorConfig.value.generator,
      publicBaseUrl: knobs.value.publicBaseUrl,
      spend: generatorConfig.value.spend,
      contextSources: generatorConfig.value.contextSources,
      trackers: generatorConfig.value.trackers,
      serverVersion: knobs.value.serverVersion,
      revisionNarrative: knobs.value.revisionNarrative,
      hugeSpanRatio: knobs.value.hugeSpanRatio,
    },
  };
}
