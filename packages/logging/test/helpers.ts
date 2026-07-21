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
