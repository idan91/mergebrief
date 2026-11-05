// Public exit codes are additive-only; never renumber them.
import type { ValueOf } from "types/utils";

export const ExitCodes = {
  /** Success; including modeled unavailability (`delta`'s available:false). */
  OK: 0,
  /** Generic/unexpected: network, 5xx, server-400 skew. */
  GENERIC: 1,
  /** Usage error caught client-side (bad flags, custom span, bad JSON shape). */
  USAGE: 2,
  /** Auth (401); re-mint the token. */
  AUTH: 3,
  /** Not found (404, incl. an unmodeled delta 404). */
  NOT_FOUND: 4,
  /** Server rejected the payload (4xx validation); self-correcting loops. Also a no-flag `submit` the CLI refuses: same next move, re-read and re-target. */
  SERVER_REJECTED: 5,
  /** `capabilities --require` failed; stop before driving the operation. */
  INCOMPATIBLE: 6,
  /** Rate limited (429); wait the seconds the error line names, then retry. */
  RATE_LIMITED: 7,
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

export function exitCodeForStatus(status: number): ExitCode {
  if (status === 401) {
    return ExitCodes.AUTH;
  }
  if (status === 404) {
    return ExitCodes.NOT_FOUND;
  }
  if (status === 429) {
    return ExitCodes.RATE_LIMITED;
  }
  // Any other 4xx is a server-side payload/validation rejection.
  if (status >= 400 && status < 500) {
    return ExitCodes.SERVER_REJECTED;
  }
  // 5xx and anything else unexpected.
  return ExitCodes.GENERIC;
}
