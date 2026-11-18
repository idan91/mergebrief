// Adapter for graphile-worker's `@graphile/logger`. Types are structural on
// purpose: this package stays framework-free, with no graphile imports;
// compatibility is checked where the worker passes the factory in.
import type { LogFields, Logger } from "./logger";
import { removeQueryParams } from "./query-params";
import { isRecord } from "./utils";

/** Structural mirror of `@graphile/logger`'s `LogFunction`. */
export type GraphileLogFunction = (
  level: string,
  message: string,
  meta?: Record<string, unknown>,
) => void;

/** Structural mirror of `@graphile/logger`'s `LogFunctionFactory`. */
export type GraphileLogFactory = (
  scope: Record<string, unknown>,
) => GraphileLogFunction;

/**
 * The job columns a line keeps. The payload and `last_error` stay out: a job
 * that succeeds on a retry still holds the last attempt's whole error.
 */
const JOB_FIELDS = [
  "id",
  "task_identifier",
  "attempts",
  "max_attempts",
] as const;

interface FailedJobLine {
  readonly message: string;
  readonly fields: LogFields;
}

function keepJobFields(job: Record<string, unknown>): LogFields {
  const kept: LogFields = {};
  for (const field of JOB_FIELDS) {
    kept[field] = job[field];
  }
  return kept;
}

/** The meta keys graphile lists several job rows under, as a shutdown does. */
const JOB_LIST_KEYS = ["jobs", "cancelledJobs"] as const;

/** The meta keys graphile puts an error under beside `error`, which no serializer reads. */
const EXTRA_ERROR_KEYS = ["reason", "fatalError", "secondError"] as const;

function keepJobRowFields(row: unknown): unknown {
  return isRecord(row) ? keepJobFields(row) : row;
}

/**
 * Any line's meta with every job row cut to those columns and every other
 * error cut to its message lines.
 */
function slimGraphileMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (meta === undefined) {
    return undefined;
  }

  const slim: Record<string, unknown> = { ...meta };
  const job = meta["job"];
  if (isRecord(job)) {
    slim["job"] = keepJobFields(job);
  }
  for (const key of JOB_LIST_KEYS) {
    const rows = meta[key];
    if (Array.isArray(rows)) {
      slim[key] = rows.map(keepJobRowFields);
    }
  }
  for (const key of EXTRA_ERROR_KEYS) {
    if (key in meta) {
      slim[key] = readMessageLines(meta[key]);
    }
  }
  return slim;
}

/** How many causes a line reads after the error itself, so a chain that loops still ends. */
const MAX_NAMED_CAUSES = 3;

function readFirstLine(message: unknown): string {
  const [firstLine = ""] = String(message).split("\n", 1);
  return firstLine;
}

/**
 * The first line of an error's message and of each cause's, with no bound
 * query value: a query error's own message is its statement, and the
 * database's reason rides on its cause.
 */
function readMessageLines(error: unknown): string {
  const safe = removeQueryParams(error);
  const lines = [readFirstLine(isRecord(safe) ? safe["message"] : safe)];

  let cause = isRecord(safe) ? safe["cause"] : undefined;
  for (let depth = 0; depth < MAX_NAMED_CAUSES; depth += 1) {
    if (!isRecord(cause)) {
      break;
    }
    const line = readFirstLine(cause["message"]);
    const alreadyNamed = lines.some((named) => named.includes(line));
    if (!alreadyNamed) {
      lines.push(line);
    }
    cause = cause["cause"];
  }
  return lines.join(": ");
}

/**
 * graphile-worker reports a task that threw with the whole error, its stack
 * in the message and the job row. An error's props and stacks can carry
 * request contents, so the line keeps its message lines only.
 */
function shapeFailedJobLine(
  meta: Record<string, unknown>,
): FailedJobLine | undefined {
  const job = meta["job"];
  if (meta["failure"] !== true) {
    return undefined;
  }
  if (!isRecord(job)) {
    return undefined;
  }

  const kept = keepJobFields(job);
  const attempt = `attempt ${String(job["attempts"])} of ${String(job["max_attempts"])}`;
  const task = `${String(job["id"])} (${String(job["task_identifier"])}, ${attempt})`;

  return {
    message: `Failed task ${task}: ${readMessageLines(meta["error"])}`,
    fields: { failure: true, job: kept, duration: meta["duration"] },
  };
}

// graphile levels: "error" | "warning" | "info" | "debug". Anything
// unrecognized logs as info: never drop a line over a vocabulary mismatch.
function forward(
  logger: Logger,
  level: string,
  graphileMessage: string,
  graphileMeta?: Record<string, unknown>,
): void {
  const failed =
    graphileMeta === undefined ? undefined : shapeFailedJobLine(graphileMeta);
  const message = failed?.message ?? graphileMessage;
  const meta = failed?.fields ?? slimGraphileMeta(graphileMeta);

  switch (level) {
    case "error":
      logger.error(message, meta);
      return;
    case "warning":
      logger.warn(message, meta);
      return;
    case "debug":
      logger.debug(message, meta);
      return;
    default:
      logger.info(message, meta);
  }
}

export function createGraphileLogFactory(logger: Logger): GraphileLogFactory {
  return (scope) => {
    const scoped = logger.child(scope);
    return (level, message, meta) => forward(scoped, level, message, meta);
  };
}
