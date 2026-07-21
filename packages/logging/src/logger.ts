// The structured-logging seam (ADR 0034 #1): call sites depend on `Logger`
// and `createLogger` only — pino is constructed here and nowhere else, and
// its types never leak. A later OTel/metrics addition reimplements this
// interface without touching call sites.
import { pino, stdSerializers } from "pino";
import type { ValueOf } from "types";

/** Structured fields riding a log line. Secrets go HERE, never in `msg`. */
export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  error(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  /** A logger whose every line carries `bindings` (correlation keys). */
  child(bindings: LogFields): Logger;
}

// Four levels only (matches graphile-worker; ADR 0034 #1) — fatal moments
// log `error` and exit.
export const LogLevels = {
  ERROR: "error",
  WARN: "warn",
  INFO: "info",
  DEBUG: "debug",
} as const;

export type LogLevel = ValueOf<typeof LogLevels>;

const LEVEL_VALUES: readonly string[] = Object.values(LogLevels);

function isLogLevel(value: string): value is LogLevel {
  return LEVEL_VALUES.includes(value);
}

export interface LoggerConfig {
  level: LogLevel;
  /** Human-readable dev rendering (pino-pretty) instead of NDJSON. */
  pretty: boolean;
}

/**
 * Pure env → config decision: `LOG_LEVEL` (default `info`), format switched
 * on `NODE_ENV` — JSON unless `development` (ADR 0034 #3). An unknown
 * LOG_LEVEL throws: a misconfigured process must fail loudly at boot, not
 * limp along at a level the operator didn't choose.
 */
export function resolveLoggerConfig(env: NodeJS.ProcessEnv): LoggerConfig {
  // `||` on purpose: a blank `LOG_LEVEL=` line (common in .env templates)
  // means unset, not a misconfiguration.
  const raw = env["LOG_LEVEL"] || LogLevels.INFO;
  if (!isLogLevel(raw)) {
    throw new Error(
      `invalid LOG_LEVEL "${raw}" — expected one of: ${LEVEL_VALUES.join(", ")}`,
    );
  }
  return { level: raw, pretty: env["NODE_ENV"] === "development" };
}

// Secret vocabulary redacted at top level AND one wildcard depth, plus the
// sensitive request headers (ADR 0034 #4). `remove: true` — redacted keys
// VANISH from the line, no `[Redacted]` placeholder.
const SECRET_KEYS = [
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "webhookSecret",
  "privateKey",
  "clientSecret",
  "connectionString",
  "databaseUrl",
] as const;

const REDACT_PATHS = [
  "headers.authorization",
  "headers.cookie",
  'headers["x-hub-signature-256"]',
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((key) => `*.${key}`),
];

/** Anything with a sonic-boom-compatible `write` — injectable for tests. */
export interface LogDestination {
  write(line: string): void;
}

export interface CreateLoggerOptions {
  /** Ambient env, injected by the composition root (never read here). */
  env?: NodeJS.ProcessEnv;
  /** Bindings stamped on every line this logger and its children emit. */
  base?: LogFields;
  /** Test seam: capture lines instead of writing to stdout. Forces NDJSON. */
  destination?: LogDestination;
}

interface PinoLike {
  error(fields: LogFields, msg: string): void;
  warn(fields: LogFields, msg: string): void;
  info(fields: LogFields, msg: string): void;
  debug(fields: LogFields, msg: string): void;
  child(bindings: LogFields): PinoLike;
}

function wrap(instance: PinoLike): Logger {
  return {
    error: (msg, fields) => instance.error(fields ?? {}, msg),
    warn: (msg, fields) => instance.warn(fields ?? {}, msg),
    info: (msg, fields) => instance.info(fields ?? {}, msg),
    debug: (msg, fields) => instance.debug(fields ?? {}, msg),
    child: (bindings) => wrap(instance.child(bindings)),
  };
}

/**
 * The ONE place pino is constructed. Level + format from the injected env
 * (`resolveLoggerConfig`); secret redaction with `remove: true`; pino's
 * stock `err` serializer; string level labels (`"level":"warn"`) for a
 * greppable operator contract.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { env = {}, base, destination } = options;
  const { level, pretty } = resolveLoggerConfig(env);

  const pinoOptions = {
    level,
    redact: { paths: REDACT_PATHS, remove: true },
    serializers: { err: stdSerializers.err },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    ...(base === undefined ? {} : { base }),
    // pino-pretty is a devDependency: the transport is only referenced in
    // dev mode and resolves lazily inside pino's worker thread.
    ...(pretty && destination === undefined
      ? { transport: { target: "pino-pretty" } }
      : {}),
  };

  const instance =
    destination === undefined ? pino(pinoOptions) : pino(pinoOptions, destination);
  return wrap(instance);
}
