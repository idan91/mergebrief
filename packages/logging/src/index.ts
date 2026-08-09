// ENTRY — the package's public surface (`package.json` `exports["."]`).

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

// graphile-worker adapter (worker startup wiring).
export {
  createGraphileLogFactory,
  type GraphileLogFactory,
  type GraphileLogFunction,
} from "./graphile";
