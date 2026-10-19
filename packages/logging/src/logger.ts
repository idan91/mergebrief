// The structured-logging boundary: pino is constructed here and nowhere else,
// and no pino type or value ever appears in an exported signature.
import { isSpanContextValid, trace } from "@opentelemetry/api";
import { pino, stdSerializers, type LoggerOptions } from "pino";
import type { ValueOf } from "types/utils";
import { scrubSecrets, URL_SHAPED_LOG } from "./scrub";

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

// Four levels only (matches graphile-worker); no `fatal`, fatal moments log
// `error` and exit.
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
 * Pure env → config decision. An unknown `LOG_LEVEL` throws so a
 * misconfigured process fails loudly at boot rather than limping along at a
 * level the operator didn't choose.
 */
export function resolveLoggerConfig(env: NodeJS.ProcessEnv): LoggerConfig {
  // `||` on purpose: a blank `LOG_LEVEL=` means unset, not a misconfiguration.
  const raw = env["LOG_LEVEL"] || LogLevels.INFO;
  if (!isLogLevel(raw)) {
    throw new Error(
      `invalid LOG_LEVEL "${raw}" — expected one of: ${LEVEL_VALUES.join(", ")}`,
    );
  }
  return { level: raw, pretty: env["NODE_ENV"] === "development" };
}

// Redact secret keys at top level and one wildcard depth, including params and sensitive headers.
// Remove keys without placeholders. Narrowing the vocabulary needs a decision-record amendment.
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
  ...SECRET_KEYS.map((key) => `params.${key}`),
  ...SECRET_KEYS.map((key) => `*.params.${key}`),
];

// Shared scrub.ts patterns protect strings that key-path redaction cannot recognize.
// Scrub every serialized err/error string and msg only. Other fields must use SECRET_KEYS
// to avoid leaking structured secrets; there is deliberately no disable option.
function scrubString(text: string): string {
  return scrubSecrets(text, URL_SHAPED_LOG);
}

// Copy-on-write: the non-Error path hands us the CALLER's object, which must
// not be mutated. `seen` breaks cycles pino's own guard misses (it only tags
// error-like values, not plain nested objects).
function scrubValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return scrubString(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    return value.map((entry) => scrubValue(entry, seen));
  }
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = scrubValue(entry, seen);
    }
    return copy;
  }
  return value;
}

// Must mirror pino-std-serializers' own guard exactly, or duck-typed
// error-likes skip cause-chain folding and lose their diagnostics.
function isErrorLike(value: unknown): value is Error {
  if (value instanceof Error) {
    return true;
  }
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  );
}

// Non-error input (a thrown string, a number) is deep-scrubbed as-is, so the
// scrub holds regardless of input shape.
function scrubbedErrSerializer(value: unknown): unknown {
  let serialized = value;
  if (isErrorLike(value)) {
    try {
      serialized = stdSerializers.err(value);
    } catch {
      // A frozen error-like makes pino's cycle-tag write throw, and pino calls
      // serializers with no try/catch, a logger must never crash its call
      // site. Diagnostics degrade here; the scrub below still runs.
    }
  }
  return scrubValue(serialized, new WeakSet());
}

interface TraceFields {
  trace_id?: string;
  span_id?: string;
}

// With tracing off the API is a no-op with no active span, so a line gains
// nothing. Snake case is the OTel log data model's, which Datadog's Agent
// detects on its own.
function readTraceFields(): TraceFields {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext === undefined) {
    return {};
  }
  if (!isSpanContextValid(spanContext)) {
    return {};
  }
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}

/** Anything with a sonic-boom-compatible `write`, injectable for tests. */
export interface LogDestination {
  write(line: string): void;
}

export interface CreateLoggerOptions {
  /** Ambient env, injected by the startup wiring (never read here). */
  env?: NodeJS.ProcessEnv;
  /** Bindings stamped on every line this logger and its children emit. */
  base?: LogFields;
  /** Test interface: capture lines instead of writing to stdout. Forces NDJSON. */
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
    error: (msg, fields) => instance.error(fields ?? {}, scrubString(msg)),
    warn: (msg, fields) => instance.warn(fields ?? {}, scrubString(msg)),
    info: (msg, fields) => instance.info(fields ?? {}, scrubString(msg)),
    debug: (msg, fields) => instance.debug(fields ?? {}, scrubString(msg)),
    child: (bindings) => wrap(instance.child(bindings)),
  };
}

/**
 * The ONE place pino is constructed. Env is injected, this package never
 * reads `process.env`. String level labels (`"level":"warn"`) are part of the
 * operator-facing line shape; changing the rendering is a breaking change.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { env = {}, base, destination } = options;
  const { level, pretty } = resolveLoggerConfig(env);

  const pinoOptions: LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, remove: true },
    // Both keys on purpose: an `error:` slip-up under pino's default path
    // drops message/stack while emitting enumerable props, the leak shape.
    serializers: { err: scrubbedErrSerializer, error: scrubbedErrSerializer },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    mixin: readTraceFields,
  };

  if (base !== undefined) {
    pinoOptions.base = base;
  }
  // pino-pretty is a devDependency: referenced only in dev mode, resolved
  // lazily inside pino's worker thread.
  if (pretty && destination === undefined) {
    pinoOptions.transport = { target: "pino-pretty" };
  }

  const instance =
    destination === undefined
      ? pino(pinoOptions)
      : pino(pinoOptions, destination);
  return wrap(instance);
}
