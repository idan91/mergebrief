import {
  DEFAULT_DETAIL_CONCURRENCY,
  DEFAULT_HUGE_SPAN_RATIO,
  DEFAULT_REVISION_NARRATIVE_ENABLED,
  type RevisionNarrativeConfig,
} from "brief-core";
import {
  loadGeneratorConfig,
  type ContextSourcesConfig,
  type GeneratorConfig,
  type LinkFetchPolicy,
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
  /** Connections the worker's pool opens at most (DATABASE_POOL_MAX). */
  readonly poolMax: number;
  /** Slots the runner drains jobs into (WORKER_CONCURRENCY). A slot is one
   * in-flight generation: an API stream, or a CLI child for CLI providers. */
  readonly concurrency: number;
  /** Slots of the large pool, which drains the multi-call runs (WORKER_LARGE_CONCURRENCY). */
  readonly largeConcurrency: number;
  /** Detail calls a multi-call run keeps in flight at once (`generator.detailConcurrency`). */
  readonly detailConcurrency: number;
  /** `generator.forceMultiCall`: every brief runs multi-call; off when unset. */
  readonly forceMultiCall: boolean;
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
   * The daily generation cap the task enforces: 300 when the config file
   * carries no `spend` block, uncapped only under `unlimited`.
   */
  readonly spend: SpendPolicy;
  /** The credentialed context providers to construct; empty = built-ins only. */
  readonly contextSources: ContextSourcesConfig;
  /** The instance's default boards; a repo's own settings replace them. */
  readonly trackers: readonly TrackerConfig[];
  /** Whether issue references resolve beyond the PR's repo and its `issuesRepo`; off by default. */
  readonly siblingRepos: boolean;
  /** What the generic link fetcher may read; public when the block is absent. */
  readonly linkFetch: LinkFetchPolicy;
  /** `SERVER_VERSION`, recorded in `instance_version` at boot; `dev` when unset. */
  readonly serverVersion: string;
  /** `generator.revisionNarrative`; on when unset. */
  readonly revisionNarrative: RevisionNarrativeConfig;
  /** `generator.hugeSpanRatio`; brief-core's default when unset. */
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
/** One large slot: a multi-call run holds up to `detailConcurrency` streams by itself. */
const DEFAULT_LARGE_CONCURRENCY = 1;

/** The worker's own knobs, parsed beside the loaders other packages own. */
interface WorkerKnobs {
  readonly concurrency: number;
  readonly largeConcurrency: number;
  readonly publicBaseUrl: string;
  readonly serverVersion: string;
}

/**
 * Read the slot count. Unset and empty both mean the default: compose passes an
 * unset variable through as an empty string.
 */
function parseConcurrency(
  raw: string | undefined,
  defaultSlots: number,
): Result<number, string> {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, value: defaultSlots };
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

function parseWorkerKnobs(
  env: Readonly<Record<string, string | undefined>>,
): Result<WorkerKnobs, readonly string[]> {
  const concurrency = parseConcurrency(
    env["WORKER_CONCURRENCY"],
    DEFAULT_CONCURRENCY,
  );
  const largeConcurrency = parseConcurrency(
    env["WORKER_LARGE_CONCURRENCY"],
    DEFAULT_LARGE_CONCURRENCY,
  );
  const publicBaseUrl = parsePublicBaseUrl(env["PUBLIC_BASE_URL"]);
  const serverVersion = parseServerVersion(env["SERVER_VERSION"]);

  const allParsed =
    concurrency.ok &&
    largeConcurrency.ok &&
    publicBaseUrl.ok &&
    serverVersion.ok;
  if (allParsed) {
    return {
      ok: true,
      value: {
        concurrency: concurrency.value,
        largeConcurrency: largeConcurrency.value,
        publicBaseUrl: publicBaseUrl.value,
        serverVersion: serverVersion.value,
      },
    };
  }

  const keyed = [
    ["WORKER_CONCURRENCY", concurrency],
    ["WORKER_LARGE_CONCURRENCY", largeConcurrency],
    ["PUBLIC_BASE_URL", publicBaseUrl],
    ["SERVER_VERSION", serverVersion],
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
      poolMax: persistence.value.poolMax,
      concurrency: knobs.value.concurrency,
      largeConcurrency: knobs.value.largeConcurrency,
      detailConcurrency:
        generatorConfig.value.generator.detailConcurrency ??
        DEFAULT_DETAIL_CONCURRENCY,
      forceMultiCall: generatorConfig.value.generator.forceMultiCall ?? false,
      auditRetentionDays: persistence.value.auditRetentionDays,
      prRetentionDays: persistence.value.prRetentionDays,
      generator: generatorConfig.value.generator,
      publicBaseUrl: knobs.value.publicBaseUrl,
      spend: generatorConfig.value.spend,
      contextSources: generatorConfig.value.contextSources,
      trackers: generatorConfig.value.trackers,
      siblingRepos: generatorConfig.value.siblingRepos,
      linkFetch: generatorConfig.value.linkFetch,
      serverVersion: knobs.value.serverVersion,
      revisionNarrative: {
        enabled:
          generatorConfig.value.generator.revisionNarrative ??
          DEFAULT_REVISION_NARRATIVE_ENABLED,
      },
      hugeSpanRatio:
        generatorConfig.value.generator.hugeSpanRatio ??
        DEFAULT_HUGE_SPAN_RATIO,
    },
  };
}
