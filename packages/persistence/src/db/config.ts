// Persistence env config, Zod-parsed from an INJECTED env map; this module
// NEVER reads `process.env`. `DATABASE_URL_FILE` wins over `DATABASE_URL`
// with a warning (see `dsn.ts`). The retention windows and the audit switch
// come from the instance config, never from here; the floors below are the
// sweeps' own guard.
// MERGEBRIEF_AUTO_MIGRATE=false is check-only, for a runtime role without DDL
// (see db/migrate.ts). The minimization defaults encode the SELF-HOST posture.
import { parse } from "pg-connection-string";
import { z } from "zod/v4";
import type { Result, ValueOf } from "types/utils";
import { resolveDatabaseUrl, type ResolveDsnOptions } from "./dsn";
import { checkDsnTls, isLoopbackHost } from "./tls";

// ---------------------------------------------------------------------------
// Public config shape.
// ---------------------------------------------------------------------------

export interface PersistenceConfig {
  /** Postgres connection URL (`pg` driver, one pool for data + queue). */
  readonly databaseUrl: string;
  /** Apply migrations at boot (default) vs check-only refusal, the posture
   * for a runtime role without DDL. */
  readonly autoMigrate: boolean;
  /** Connections this process's pool opens at most. */
  readonly poolMax: number;
}

// ---------------------------------------------------------------------------
// Errors: expected failure (bad/missing env). Never throws.
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
   * VALUES: `DATABASE_URL` may carry a password, which must not reach a log.
   */
  readonly issues: readonly string[];
}

// ---------------------------------------------------------------------------
// Env-value parsers.
// ---------------------------------------------------------------------------

const TRUE_TOKENS = new Set(["true", "1", "yes", "on"]);
const FALSE_TOKENS = new Set(["false", "0", "no", "off", ""]);

/**
 * Boolean from an env string. `z.coerce.boolean()` is unusable here: it treats
 * any non-empty string (including "false") as `true`. This maps an explicit
 * token set; an absent var takes `defaultValue`; anything else fails validation.
 */
function envBool(defaultValue: boolean): z.ZodType<boolean> {
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

/** A closed pull request is swept the day after its close at the shortest. */
export const PR_RETENTION_FLOOR_DAYS = 1;

/** Postgres connection URL: a parseable URL whose scheme is postgres(ql). */
const databaseUrlSchema = z
  .string({ error: "DATABASE_URL is required" })
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

/** What `docker-compose.yml` sets when `POSTGRES_PASSWORD` is unset. */
const SHIPPED_PASSWORDS: ReadonlySet<string> = new Set(["mergebrief"]);

/**
 * A warning, never a refusal: making the variable required would stop an
 * instance on its own database, whose compose overlay still reads this file.
 * Loopback is a checkout's development database.
 */
function warnOnShippedPassword(
  databaseUrl: string,
  onWarning: ResolveDsnOptions["onWarning"],
): void {
  // Read as the driver reads it, like the TLS gate that already accepted it.
  const dsn = parse(databaseUrl);
  const hasShippedPassword =
    typeof dsn.password === "string" && SHIPPED_PASSWORDS.has(dsn.password);
  const shipsOffTheHost = hasShippedPassword && !isLoopbackHost(dsn.host);
  if (shipsOffTheHost) {
    onWarning?.(
      "the database password is the one docker-compose.yml ships; set POSTGRES_PASSWORD in .env and change the database user's password to match",
    );
  }
}

/** node-postgres's own default, kept when `DATABASE_POOL_MAX` is unset. */
const DEFAULT_POOL_MAX = 10;

/**
 * graphile pins one client of the worker's queue pool to its job listener for
 * the process lifetime, and claims jobs through the same pool with no
 * checkout bound: one connection would wedge the worker silently.
 */
const MIN_POOL_MAX = 2;

const poolMaxSchema = z.preprocess(
  (value) => (value === undefined || value === "" ? DEFAULT_POOL_MAX : value),
  z.coerce
    .number({ error: "DATABASE_POOL_MAX must be a number" })
    .int("DATABASE_POOL_MAX must be a whole number of connections")
    .min(
      MIN_POOL_MAX,
      `DATABASE_POOL_MAX must be at least ${MIN_POOL_MAX}: the job queue holds one connection for its listener and needs another to work`,
    ),
);

const ConfigSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  MERGEBRIEF_AUTO_MIGRATE: envBool(true),
  DATABASE_POOL_MAX: poolMaxSchema,
});

// ---------------------------------------------------------------------------
// Loader.
// ---------------------------------------------------------------------------

/**
 * Parse persistence config from an injected env map into a `PersistenceConfig`,
 * or a `ConfigError` listing the invalid fields, values omitted because a
 * connection string is a secret. Unknown env keys are ignored. Never reads
 * `process.env` itself; the caller passes it. `DATABASE_URL_FILE` resolution
 * and its shadow warning happen here so every consumer of this loader, web
 * and worker both, gets the `_FILE` convention without its own wiring.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options: ResolveDsnOptions = {},
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
  // TLS allowlist: runs on the RESOLVED DSN (env or file), after
  // scheme validation; see `tls/` for the rule and its loopback exemption.
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

  warnOnShippedPassword(parsed.data.DATABASE_URL, options.onWarning);

  return {
    ok: true,
    value: {
      databaseUrl: parsed.data.DATABASE_URL,
      autoMigrate: parsed.data.MERGEBRIEF_AUTO_MIGRATE,
      poolMax: parsed.data.DATABASE_POOL_MAX,
    },
  };
}
