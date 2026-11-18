import type { LogDestination } from "../src/logger";

export interface CapturedLine {
  [key: string]: unknown;
}

/** An injectable destination that captures emitted NDJSON lines. */
export interface CaptureDestination extends LogDestination {
  lines(): CapturedLine[];
  raw(): string[];
}

function isRecord(value: unknown): value is CapturedLine {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function captureDestination(): CaptureDestination {
  const written: string[] = [];
  return {
    write(line: string): void {
      written.push(line);
    },
    raw(): string[] {
      return [...written];
    },
    lines(): CapturedLine[] {
      return written.map((line) => {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) {
          throw new Error(`expected an NDJSON object line, got: ${line}`);
        }
        return parsed;
      });
    },
  };
}

export const QUERY_SQL = 'insert into "brief" ("body") values ($1)';
export const QUERY_PARAM = "PRIVATE-BRIEF-BODY";
export const DRIVER_MESSAGE = "duplicate key value violates unique constraint";

/** The shape drizzle throws: bound params ride the message and a prop. */
export class StubQueryError extends Error {
  readonly query = QUERY_SQL;
  readonly params = [QUERY_PARAM];

  constructor(cause: Error) {
    super(`Failed query: ${QUERY_SQL}\nparams: ${QUERY_PARAM}`, { cause });
  }
}
