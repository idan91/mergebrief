// Adapter for graphile-worker's `@graphile/logger`. Types are structural on
// purpose — this package stays framework-free, with no graphile imports;
// compatibility is checked where the worker passes the factory in.
import type { Logger } from "./logger";

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

// graphile levels: "error" | "warning" | "info" | "debug". Anything
// unrecognized logs as info — never drop a line over a vocabulary mismatch.
function forward(
  logger: Logger,
  level: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
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
