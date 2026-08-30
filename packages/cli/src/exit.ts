// The exit-code contract — a PUBLIC surface: additive-only, never
// renumbered. These codes are what make unattended agent loops safe:
// 3 → re-mint, 4 → wrong target, 5 → fix the payload and retry,
// 6 → the server/CLI pair cannot run the required operation.
import type { ValueOf } from "types";

export const ExitCodes = {
  /** Success — including modeled unavailability (`delta`'s available:false). */
  OK: 0,
  /** Generic/unexpected: network, 5xx, server-400 skew. */
  GENERIC: 1,
  /** Usage error caught client-side (bad flags, custom span, bad JSON shape). */
  USAGE: 2,
  /** Auth (401) — re-mint the token. */
  AUTH: 3,
  /** Not found (404, incl. an unmodeled delta 404). */
  NOT_FOUND: 4,
  /** Server rejected the payload (4xx validation) — self-correcting loops. */
  SERVER_REJECTED: 5,
  /** `capabilities --require` failed — stop before driving the operation. */
  INCOMPATIBLE: 6,
} as const;
export type ExitCode = ValueOf<typeof ExitCodes>;

/**
 * The one expected-failure envelope inside the CLI: commands throw it, the
 * runner maps it to the stream/exit invariant (empty stdout, ONE stderr
 * line, the carried code). Anything else that escapes is a programmer error
 * → GENERIC with the same invariant.
 */
export class CliError extends Error {
  readonly code: ExitCode;

  constructor(code: ExitCode, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

/** Map an HTTP failure status to the contract. */
export function exitCodeForStatus(status: number): ExitCode {
  if (status === 401) return ExitCodes.AUTH;
  if (status === 404) return ExitCodes.NOT_FOUND;
  // Any other 4xx is a server-side payload/validation rejection.
  if (status >= 400 && status < 500) return ExitCodes.SERVER_REJECTED;
  // 5xx and anything else unexpected.
  return ExitCodes.GENERIC;
}
