// Shared test logging seam (BRIEF-51): `createApp` requires a logger, so
// suites inject one that captures NDJSON lines instead of writing to stdout
// — assertable where a test cares, silent everywhere else.
import { createLogger, type Logger } from "logging";

export interface CapturedLine {
  [key: string]: unknown;
}

export interface TestLogging {
  readonly logger: Logger;
  lines(): CapturedLine[];
}

function isRecord(value: unknown): value is CapturedLine {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function testLogging(env: NodeJS.ProcessEnv = {}): TestLogging {
  const written: string[] = [];
  const logger = createLogger({
    env,
    destination: { write: (line: string) => void written.push(line) },
  });
  return {
    logger,
    lines: () =>
      written.map((line) => {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) {
          throw new Error(`expected an NDJSON object line, got: ${line}`);
        }
        return parsed;
      }),
  };
}

/** A capture-backed logger for suites that never assert on log output. */
export function testLogger(): Logger {
  return testLogging().logger;
}
