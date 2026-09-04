import { readFailureForStatus } from "../../context/trackers/github";
import type { ContextReadFailure } from "../../context/types";
import { TicketUnreadReasons } from "../../types";

/** `gh` exits 4 when no account is logged in. */
const GH_EXIT_NOT_LOGGED_IN = 4;
const HTTP_STATUS_IN_STDERR = /\(HTTP (\d{3})\)/;

interface ExecFailure {
  readonly name: string;
  readonly code: number | string | undefined;
  readonly stderr: string;
}

function readExecFailure(error: unknown): ExecFailure {
  const failure: {
    name: string;
    code: number | string | undefined;
    stderr: string;
  } = { name: "", code: undefined, stderr: "" };
  if (typeof error !== "object" || error === null) return failure;
  if ("name" in error && typeof error.name === "string") {
    failure.name = error.name;
  }
  if ("code" in error) {
    const code = error.code;
    if (typeof code === "number" || typeof code === "string") {
      failure.code = code;
    }
  }
  if ("stderr" in error && typeof error.stderr === "string") {
    failure.stderr = error.stderr;
  }
  return failure;
}

/** stderr is gh's own wording and may echo request detail: only the status escapes. */
export function toReadFailure(
  error: unknown,
  signal: AbortSignal,
): ContextReadFailure {
  const failure = readExecFailure(error);
  if (signal.aborted || failure.name === "AbortError") {
    return { reason: TicketUnreadReasons.TIMEOUT, detail: "read aborted" };
  }
  if (failure.code === GH_EXIT_NOT_LOGGED_IN) {
    return {
      reason: TicketUnreadReasons.NO_CREDENTIAL,
      detail: "gh is not logged in",
    };
  }
  if (failure.code === "ENOENT") {
    return {
      reason: TicketUnreadReasons.UNSUPPORTED,
      detail: "gh is not installed",
    };
  }

  // gh reports a primary rate limit as a 403 whose text says so.
  if (/rate limit/i.test(failure.stderr)) {
    return {
      reason: TicketUnreadReasons.RATE_LIMITED,
      detail: "gh reported a rate limit",
    };
  }
  const status = HTTP_STATUS_IN_STDERR.exec(failure.stderr)?.[1];
  if (status !== undefined) return readFailureForStatus(Number(status));
  return {
    reason: TicketUnreadReasons.TIMEOUT,
    detail: `gh exited ${String(failure.code ?? "unknown")}`,
  };
}
