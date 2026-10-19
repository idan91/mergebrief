// ENTRY: the package's public surface (`package.json` `exports["."]`).

// The boundary: interface + factory. pino never leaks past logger.ts.
export {
  createLogger,
  resolveLoggerConfig,
  LogLevels,
  type CreateLoggerOptions,
  type LogDestination,
  type LogFields,
  type Logger,
  type LoggerConfig,
  type LogLevel,
} from "./logger";

// Trace context across the job queue: the enqueue's traceparent, the job's span.
export {
  readActiveTraceparent,
  runInJobSpan,
  type JobSpanOptions,
} from "./trace-context";

export {
  nameRequestSpan,
  traceMethods,
  traceStep,
  type SpanAttributes,
  type SpanHandle,
  type StepSpanOptions,
} from "./spans";

// Boundary sanitizer for error detail leaving the process (wire, DB).
export { sanitizeErrorDetail } from "./sanitize";

// graphile-worker adapter (worker startup wiring).
export {
  createGraphileLogFactory,
  type GraphileLogFactory,
  type GraphileLogFunction,
} from "./graphile";
