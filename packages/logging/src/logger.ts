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

// Substring scrub (BRIEF-88): key-path redaction removes secret-named FIELDS
// but is structurally blind to secrets embedded in strings — a pg/drizzle
// error quotes DATABASE_URL back inside `err.message`/`err.stack`, and pino's
// stock err serializer also copies every enumerable own prop verbatim.
// Scope is `err`/`error` values (every string field of the serialized error,
// post-serialization) plus `msg` — NOT the rest of the LogFields bag, which
// stays key-path redaction's job: a secret placed under an arbitrary field
// name still emits verbatim, so structured secrets must ride the SECRET_KEYS
// vocabulary. Full-URL redaction on purpose: query-string tokens
// (`?access_token=…`) have no userinfo shape a narrower regex could target.
// `file://` is EXEMPT: every consumer is ESM, so Node renders stack frames
// as `file:///abs/path:10:5` — blanket redaction would erase the entire
// stack (path disclosure to the operator's own logs is acceptable). The `\b`
// keeps the lookahead from sliding one character right and matching `ile://`.
const URL_SHAPED = /\b(?!file:\/\/)\w+:\/\/\S+/g;
const REDACTED_URL = "[redacted-url]";

function scrubString(text: string): string {
  return text.replace(URL_SHAPED, REDACTED_URL);
}

// Copy-on-write: the non-Error path hands us the CALLER's object, which must
// not be mutated. `seen` breaks cycles the serializer's own guard cannot see
// (it only tags error-like values, not plain nested objects).
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

// Mirrors pino-std-serializers' own guard EXACTLY (`err-helpers.js`): routing
// must match what the serializer would do internally, or duck-typed
// error-likes (a hand-built `{message, cause}`, a cross-realm Error) skip the
// cause-chain folding and lose their diagnostics to the plain deep-copy.
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

// Error-likes go through pino's serializer first (cause chains fold into
// message/stack); anything else — a thrown string, a number — is deep-scrubbed
// as-is, so the scrub holds regardless of input shape.
function scrubbedErrSerializer(value: unknown): unknown {
  let serialized = value;
  if (isErrorLike(value)) {
    try {
      serialized = stdSerializers.err(value);
    } catch {
      // A frozen/non-extensible error-like makes pino's cycle-tag write
      // throw, and pino calls serializers with no try/catch — a logger must
      // never crash its call site. Fall back to deep-scrubbing the raw
      // value: diagnostics degrade (no cause folding), secrets still die.
    }
  }
  return scrubValue(serialized, new WeakSet());
}

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
    error: (msg, fields) => instance.error(fields ?? {}, scrubString(msg)),
    warn: (msg, fields) => instance.warn(fields ?? {}, scrubString(msg)),
    info: (msg, fields) => instance.info(fields ?? {}, scrubString(msg)),
    debug: (msg, fields) => instance.debug(fields ?? {}, scrubString(msg)),
    child: (bindings) => wrap(instance.child(bindings)),
  };
}

/**
 * The ONE place pino is constructed. Level + format from the injected env
 * (`resolveLoggerConfig`); secret redaction with `remove: true`; the
 * URL-scrubbing `err`/`error` serializer (BRIEF-88); string level labels
 * (`"level":"warn"`) for a greppable operator contract.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { env = {}, base, destination } = options;
  const { level, pretty } = resolveLoggerConfig(env);

  const pinoOptions = {
    level,
    redact: { paths: REDACT_PATHS, remove: true },
    // Both keys on purpose: all call sites use `err:` today, but an `error:`
    // slip-up under pino's default path would DROP message/stack (non-
    // enumerable) while emitting enumerable props — the exact leak shape.
    serializers: { err: scrubbedErrSerializer, error: scrubbedErrSerializer },
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
    destination === undefined
      ? pino(pinoOptions)
      : pino(pinoOptions, destination);
  return wrap(instance);
}
