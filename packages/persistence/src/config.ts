// Persistence env config (ADR 0018 plan — "Implementation choices"). Three
// knobs, Zod-parsed from an INJECTED env map. This module NEVER reads
// `process.env` implicitly at import time: `loadConfig(env)` takes the env
// explicitly so tests are hermetic and the read happens where the caller
// decides (composition root), not as an import side effect.
//
//   DATABASE_URL             required; a postgres(ql):// connection URL.
//   PERSIST_BASELINE_SNAPSHOT bool, default TRUE  — self-host default ON (D4).
//   STORE_DISPLAY_NAMES       bool, default TRUE  — self-host default ON (D1).
//
// Defaults encode the SELF-HOST posture (D1/D4): the adopter controls its own
// code and names, so both minimization gates default OFF-meaning-ON here. The
// hosted-strict arm flips them via env, no code change.
import { z } from "zod";
import type { Result, ValueOf } from "./types.js";

// ---------------------------------------------------------------------------
// Public config shape.
// ---------------------------------------------------------------------------

export interface PersistenceConfig {
  /** Postgres connection URL (`pg` driver, one pool for data + queue). */
  readonly databaseUrl: string;
  /** D4: persist the `base->checkpoint` baseline snapshot. Self-host: ON. */
  readonly persistBaselineSnapshot: boolean;
  /** D1: keep purgeable display-name columns populated. Self-host: ON. */
  readonly storeDisplayNames: boolean;
}

// ---------------------------------------------------------------------------
// Errors — expected failure (bad/missing env). Never throws.
// ---------------------------------------------------------------------------

export const ConfigErrorCode = {
  invalid: "invalid",
} as const;
export type ConfigErrorCode = ValueOf<typeof ConfigErrorCode>;

export interface ConfigError {
  readonly code: ConfigErrorCode;
  readonly message: string;
  /**
   * Per-field problems as `field: reason`. Deliberately excludes the offending
   * VALUES — `DATABASE_URL` may carry a password, which must not reach a log.
   */
  readonly issues: readonly string[];
}

// ---------------------------------------------------------------------------
// Env-value parsers.
// ---------------------------------------------------------------------------

const TRUE_TOKENS = new Set(["true", "1", "yes", "on"]);
const FALSE_TOKENS = new Set(["false", "0", "no", "off", ""]);

/**
 * Boolean from an env string. `z.coerce.boolean()` is unusable here — it treats
 * any non-empty string (including "false") as `true`. This maps an explicit
 * token set; an absent var takes `defaultValue`; anything else fails validation.
 */
function envBool(
  defaultValue: boolean,
): z.ZodType<boolean, z.ZodTypeDef, unknown> {
  return z.preprocess((value) => {
    if (value === undefined) {
      return defaultValue;
    }
    if (typeof value === "string") {
      const token = value.trim().toLowerCase();
      if (TRUE_TOKENS.has(token)) {
        return true;
      }
      if (FALSE_TOKENS.has(token)) {
        return false;
      }
    }
    // Non-string / unrecognized token → hand through so z.boolean() rejects it.
    return value;
  }, z.boolean());
}

/** Postgres connection URL: a parseable URL whose scheme is postgres(ql). */
const databaseUrlSchema = z
  .string({ required_error: "DATABASE_URL is required" })
  .min(1, "DATABASE_URL is required")
  .refine(
    isPostgresUrl,
    "DATABASE_URL must be a postgres:// or postgresql:// URL",
  );

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

const ConfigSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  PERSIST_BASELINE_SNAPSHOT: envBool(true),
  STORE_DISPLAY_NAMES: envBool(true),
});

// ---------------------------------------------------------------------------
// Loader.
// ---------------------------------------------------------------------------

/**
 * Parse persistence config from an injected env map into a `PersistenceConfig`,
 * or a `ConfigError` listing the invalid fields (values omitted — a connection
 * string is a secret). Unknown env keys are ignored. Never reads `process.env`
 * itself — the caller passes it.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Result<PersistenceConfig, ConfigError> {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path.join(".") || "(root)";
      return `${field}: ${issue.message}`;
    });
    return {
      ok: false,
      error: {
        code: ConfigErrorCode.invalid,
        message: "invalid persistence configuration",
        issues,
      },
    };
  }
  return {
    ok: true,
    value: {
      databaseUrl: parsed.data.DATABASE_URL,
      persistBaselineSnapshot: parsed.data.PERSIST_BASELINE_SNAPSHOT,
      storeDisplayNames: parsed.data.STORE_DISPLAY_NAMES,
    },
  };
}
