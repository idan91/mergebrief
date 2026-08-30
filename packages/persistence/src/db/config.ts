// Persistence env config, Zod-parsed from an INJECTED env map. This module
// NEVER reads `process.env` implicitly at import time: `loadConfig(env)` takes
// the env explicitly so tests are hermetic and the read happens where the
// caller decides (startup wiring), not as an import side effect.
//
//   DATABASE_URL             required; a postgres(ql):// connection URL.
//   DATABASE_URL_FILE        optional; path to a file holding the URL. Wins
//                            over DATABASE_URL with a warning via the
//                            injected sink; see `dsn.ts`.
//   PERSIST_BASELINE_SNAPSHOT bool, default TRUE.
//   STORE_DISPLAY_NAMES       bool, default TRUE.
//   AUDIT_RETENTION_DAYS      int days, UNSET = keep forever (the default).
//                            Refused below a 30-day floor: audit must outlive
//                            a review session.
//   AUDIT_PRIVATE_WRITES      bool, default TRUE. External writes and denials
//                            are recorded regardless — not switchable.
//   AUDIT_CALLER_IP           bool, default FALSE. The socket address is the
//                            highest-privacy-cost field and the credential
//                            already identifies the caller.
//   MERGEBRIEF_AUTO_MIGRATE   bool, default TRUE — apply migrations at boot;
//                             false = check-only, for a runtime role without
//                             DDL; see db/migrate.ts.
//
// The minimization defaults encode the SELF-HOST posture: the adopter controls
// its own code and names. A stricter deployment flips them via env.
import { z } from "zod";
import type { Result, ValueOf } from "../types";
import { resolveDatabaseUrl, type ResolveDsnOptions } from "./dsn";
import { checkDsnTls } from "./tls";

// ---------------------------------------------------------------------------
// Public config shape.
// ---------------------------------------------------------------------------

export interface PersistenceConfig {
  /** Postgres connection URL (`pg` driver, one pool for data + queue). */
  readonly databaseUrl: string;
  /** Persist the `base->checkpoint` baseline snapshot. Self-host: ON. */
  readonly persistBaselineSnapshot: boolean;
  /** Keep purgeable display-name columns populated. Self-host: ON. */
  readonly storeDisplayNames: boolean;
  /** Apply migrations at boot (default) vs check-only refusal — the posture
   * for a runtime role without DDL. */
  readonly autoMigrate: boolean;
  /** Days of audit history the sweep keeps; `null` = keep forever. */
  readonly auditRetentionDays: number | null;
  /** Record private writes in the audit log. Self-host: ON. */
  readonly auditPrivateWrites: boolean;
  /** Populate `audit_log.caller_ip`. Self-host: OFF. */
  readonly auditCallerIp: boolean;
}

// ---------------------------------------------------------------------------
// Errors — expected failure (bad/missing env). Never throws.
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

/** Audit history must outlive a review session, so a shorter window is a
 * misconfiguration to refuse, not a value to silently widen. */
export const AUDIT_RETENTION_FLOOR_DAYS = 30;

/**
 * Optional retention window in days. Absent → `null` (keep forever), which is
 * the default posture. A present value must be a whole number of days at or
 * above the floor; anything else fails validation like every sibling knob.
 */
const auditRetentionDaysSchema = z.preprocess(
  (value) => (value === undefined || value === "" ? null : value),
  z.coerce
    .number({ invalid_type_error: "AUDIT_RETENTION_DAYS must be a number" })
    .int("AUDIT_RETENTION_DAYS must be a whole number of days")
    .min(
      AUDIT_RETENTION_FLOOR_DAYS,
      `AUDIT_RETENTION_DAYS must be at least ${AUDIT_RETENTION_FLOOR_DAYS} days`,
    )
    .nullable(),
);

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
  MERGEBRIEF_AUTO_MIGRATE: envBool(true),
  AUDIT_RETENTION_DAYS: auditRetentionDaysSchema,
  AUDIT_PRIVATE_WRITES: envBool(true),
  AUDIT_CALLER_IP: envBool(false),
});

// ---------------------------------------------------------------------------
// Loader.
// ---------------------------------------------------------------------------

/** Injectable collaborators for `loadConfig`: the secret-file reader and the
 * warning sink `dsn.ts` documents. */
export type LoadConfigOptions = ResolveDsnOptions;

/**
 * Parse persistence config from an injected env map into a `PersistenceConfig`,
 * or a `ConfigError` listing the invalid fields (values omitted — a connection
 * string is a secret). Unknown env keys are ignored. Never reads `process.env`
 * itself — the caller passes it. `DATABASE_URL_FILE` resolution (and its
 * shadow warning) happens here so every consumer of this loader — web and
 * worker both — gets the `_FILE` convention without its own wiring.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options: LoadConfigOptions = {},
): Result<PersistenceConfig, ConfigError> {
  const dsn = resolveDatabaseUrl(env, options);
  if (!dsn.ok) {
    return {
      ok: false,
      error: {
        code: ConfigErrorCodes.INVALID,
        message: "invalid persistence configuration",
        issues: [dsn.error],
      },
    };
  }

  const parsed = ConfigSchema.safeParse({ ...env, DATABASE_URL: dsn.value });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path.join(".") || "(root)";
      return `${field}: ${issue.message}`;
    });
    return {
      ok: false,
      error: {
        code: ConfigErrorCodes.INVALID,
        message: "invalid persistence configuration",
        issues,
      },
    };
  }
  // TLS explicit-or-refuse: runs on the RESOLVED DSN (env or file), after
  // scheme validation — see `tls.ts` for the rule and its loopback exemption.
  const tls = checkDsnTls(parsed.data.DATABASE_URL);
  if (!tls.ok) {
    return {
      ok: false,
      error: {
        code: ConfigErrorCodes.INVALID,
        message: "invalid persistence configuration",
        issues: [tls.error],
      },
    };
  }

  return {
    ok: true,
    value: {
      databaseUrl: parsed.data.DATABASE_URL,
      persistBaselineSnapshot: parsed.data.PERSIST_BASELINE_SNAPSHOT,
      storeDisplayNames: parsed.data.STORE_DISPLAY_NAMES,
      autoMigrate: parsed.data.MERGEBRIEF_AUTO_MIGRATE,
      auditRetentionDays: parsed.data.AUDIT_RETENTION_DAYS,
      auditPrivateWrites: parsed.data.AUDIT_PRIVATE_WRITES,
      auditCallerIp: parsed.data.AUDIT_CALLER_IP,
    },
  };
}
