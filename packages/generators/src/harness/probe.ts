import type { Result } from "types";
import { configError, type ConfigError } from "../contract/errors";
import { GeneratorError, GeneratorErrorKind } from "../contract/errors";
import {
  runHarnessProcess,
  type HarnessRunResult,
  type HarnessTimeouts,
} from "./run";

// ---------------------------------------------------------------------------
// Boot probe (ADR 0030 #5): a misconfigured instance refuses boot, never
// limps into jobs. `<cli> --version` proves the binary exists and runs; the
// auth preflight proves a credential is present.
// ---------------------------------------------------------------------------

export interface HarnessProbeArgs {
  command: string;
  versionArgv: readonly string[];
  /**
   * Auth preflight argv; nonzero exit = not authenticated. REQUIRED — a
   * probe that skips auth would let an unauthenticated CLI limp into jobs
   * (ADR 0030 #5). An adapter whose CLI has no status command supplies its
   * best equivalent (settled per-adapter at implementation).
   */
  authArgv: readonly string[];
  /** Human hint appended to the auth failure (e.g. "run `claude /login`"). */
  authFailureHint: string;
  /** Probe ceiling per invocation (default 10 s). */
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

export async function probeHarnessCli(
  args: HarnessProbeArgs,
): Promise<Result<void, ConfigError>> {
  const timeouts: HarnessTimeouts = {
    hardMs: args.timeoutMs ?? 10_000,
    inactivityMs: args.timeoutMs ?? 10_000,
    killGraceMs: 1_000,
  };
  const base = {
    command: args.command,
    stdin: "",
    timeouts,
    ...(args.env ? { env: args.env } : {}),
  };

  let version: HarnessRunResult;
  try {
    version = await runHarnessProcess({ ...base, argv: args.versionArgv });
  } catch (error) {
    if (error instanceof GeneratorError) {
      // Only a missing binary earns the PATH remediation; a system-level
      // spawn failure (EMFILE et al) reports itself (message is code-only,
      // never stderr content).
      return configError([
        error.kind === GeneratorErrorKind.CLI_MISSING
          ? `${args.command}: not found on PATH`
          : error.message,
      ]);
    }
    throw error;
  }
  if (version.timedOut) {
    return configError([
      `${args.command}: version probe timed out before completing`,
    ]);
  }
  if (version.exitCode !== 0) {
    return configError([
      `${args.command}: version probe failed (exit ${version.exitCode ?? "signal"})`,
    ]);
  }

  let auth: HarnessRunResult;
  try {
    auth = await runHarnessProcess({ ...base, argv: args.authArgv });
  } catch (error) {
    if (error instanceof GeneratorError) {
      return configError([
        `${args.command}: auth preflight could not run — ${
          error.kind === GeneratorErrorKind.CLI_MISSING
            ? "binary disappeared mid-probe"
            : error.message
        }`,
      ]);
    }
    throw error;
  }
  if (auth.timedOut) {
    // A hung preflight is NOT an auth verdict — telling an authenticated
    // operator to log in again would be a false diagnosis.
    return configError([
      `${args.command}: auth preflight timed out before completing`,
    ]);
  }
  if (auth.exitCode === null) {
    // Killed by an external signal — no auth verdict was produced; the
    // login hint would be a false diagnosis (same honesty rule as timeouts).
    return configError([
      `${args.command}: auth preflight terminated by signal ${auth.exitSignal ?? "unknown"} before completing`,
    ]);
  }
  if (auth.exitCode !== 0) {
    return configError([
      `${args.command}: not authenticated — ${args.authFailureHint}`,
    ]);
  }

  return { ok: true, value: undefined };
}
