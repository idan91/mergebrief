import type { ValueOf } from "types";

/**
 * The reconciled generation-failure taxonomy (BRIEF-11 decision 5, ADR 0030
 * #5). `generate()` keeps throwing — `Result` is for construction only — and
 * every adapter throws this one class so callers classify failures without
 * knowing the transport:
 *
 *   auth                expired/invalid credentials (API 401/403, CLI auth error)
 *   config              boot-knowable misconfiguration reaching runtime
 *                       (unknown model, unsupported response format, no route)
 *   provider-transient  429/5xx-class failures after the SDK's own retries
 *   timeout             the adapter's wall-clock or inactivity watchdog fired
 *   schema-floor        validate→salvage→retry pipeline exhausted (ADR 0013 #3)
 *   refusal             the model declined to produce the artifact
 *   cli-missing         harness binary not found / not runnable
 *   opaque              unclassifiable — carries whatever context exists
 *                       (stderr tail, exit code) in the message
 */
export const GeneratorErrorKind = {
  AUTH: "auth",
  CONFIG: "config",
  PROVIDER_TRANSIENT: "provider-transient",
  TIMEOUT: "timeout",
  SCHEMA_FLOOR: "schema-floor",
  REFUSAL: "refusal",
  CLI_MISSING: "cli-missing",
  OPAQUE: "opaque",
} as const;
export type GeneratorErrorKind = ValueOf<typeof GeneratorErrorKind>;

/**
 * Expected construction failure (bad config, missing key var, failed boot
 * probe). Mirrors the worker-config ConfigError pattern: per-field issues,
 * VALUES OMITTED — key material never appears, env vars by NAME only.
 */
export interface ConfigError {
  readonly code: "invalid";
  readonly message: string;
  readonly issues: readonly string[];
}

/** Build the failed Result for a construction path. */
export function configError(
  issues: readonly string[],
): { ok: false; error: ConfigError } {
  return {
    ok: false,
    error: {
      code: "invalid",
      message: "invalid generator configuration",
      issues,
    },
  };
}

/**
 * The one failure class every adapter throws from `generate()`. Messages
 * follow the repo rule: never a secret, a token, or a connection string —
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
