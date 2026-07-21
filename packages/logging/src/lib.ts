// ENTRY — the package's public surface (`package.json` `exports["."]`).

// The seam: interface + factory. pino never leaks past logger.ts.
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

// graphile-worker adapter (worker composition root).
export {
  createGraphileLogFactory,
  type GraphileLogFactory,
  type GraphileLogFunction,
} from "./graphile";
