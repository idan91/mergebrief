import type { Mutable, ValueOf } from "types/utils";

/**
 * Construction returns Result; generate throws this shared transport-independent taxonomy.
 * Provider-transient follows exhausted SDK retries; watchdogs classify as timeout.
 * Schema-floor means salvage/retry exhaustion. Unclassifiable failures retain sanitized context.
 */
export const GeneratorErrorKinds = {
  AUTH: "auth",
  CONFIG: "config",
  PROVIDER_TRANSIENT: "provider-transient",
  TIMEOUT: "timeout",
  SCHEMA_FLOOR: "schema-floor",
  REFUSAL: "refusal",
  /** The output reached its token cap before it finished: no salvage, no feedback retry. */
  OUTPUT_CUT: "output-cut",
  CLI_MISSING: "cli-missing",
  OPAQUE: "opaque",
} as const;
export type GeneratorErrorKind = ValueOf<typeof GeneratorErrorKinds>;

/**
 * Expected construction failure (bad config, missing key var, failed boot
 * probe). Mirrors the worker-config ConfigError pattern: per-field issues,
 * VALUES OMITTED, key material never appears, env vars by NAME only.
 */
export interface ConfigError {
  readonly code: "invalid";
  readonly message: string;
  readonly issues: readonly string[];
  /**
   * Environment-dependent, not deterministic: a boot preflight that failed
   * on network/5xx/429 may succeed on retry, so composition roots keep
   * restart self-heal for it. Absent = deterministic.
   */
  readonly transient?: true;
}

/** Build the failed Result for a construction path. */
export function configError(
  issues: readonly string[],
  opts?: { transient: true },
): {
  ok: false;
  error: ConfigError;
} {
  const error: Mutable<ConfigError> = {
    code: "invalid",
    message: "invalid generator configuration",
    issues,
  };

  if (opts?.transient) {
    error.transient = true;
  }

  return { ok: false, error };
}

/**
 * The one failure class every adapter throws from `generate()`. Messages
 * follow the repo rule: never a secret, a token, or a connection string,
 * env vars are referenced by NAME only.
 */
export class GeneratorError extends Error {
  readonly kind: GeneratorErrorKind;

  constructor(
    kind: GeneratorErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GeneratorError";
    this.kind = kind;
  }
}
