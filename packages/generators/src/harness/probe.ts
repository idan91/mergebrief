import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import { GeneratorError, GeneratorErrorKinds } from "../contract/errors";
import type { Logger } from "../contract/generator";
import { redactSecrets } from "./redact";
import {
  runHarnessProcess,
  type HarnessCliEnv,
  type HarnessRunArgs,
  type HarnessRunResult,
  type HarnessTimeouts,
} from "./run";
import { createHarnessWorkDir, removeHarnessWorkDir } from "./work-dir";

// Refuse misconfigured boots: version probes prove the CLI runs and auth preflight proves credentials.

export interface HarnessProbeArgs {
  command: string;
  versionArgv: readonly string[];
  /**
   * Auth preflight argv; nonzero exit = not authenticated. REQUIRED, a
   * probe that skips auth would let an unauthenticated CLI limp into jobs.
   * An adapter whose CLI has no status command supplies its best equivalent.
   */
  authArgv: readonly string[];
  /** Human hint appended to the auth failure (e.g. "run `claude /login`"). */
  authFailureHint: string;
  /** Probe ceiling per invocation (default 10 s). */
  timeoutMs?: number;
  env: Record<string, string | undefined>;
  /** The same allowlist extras generation spawns with. */
  cliEnv: HarnessCliEnv;
  /** Sink for interpreter warnings; absent = warnings are dropped. */
  log?: Logger;
  /**
   * Adapter-owned read of a SUCCESSFUL version probe's stdout (exit 0,
   * failures keep their generic verdicts above). Non-null = a warning to
   * surface (e.g. a billing-attribution version floor); never fatal.
   */
  interpretVersionOutput?: (stdout: string) => string | null;
  /**
   * Adapter-owned read of a SUCCESSFUL auth preflight's stdout (exit 0,
   * the CLI says "authenticated"; this decides whether that credential is
   * also the RIGHT one). `ok` carries an optional warning; an error refuses
   * boot (fail-loud, same contract as the generic checks).
   */
  interpretAuthOutput?: (stdout: string) => Result<string | null, ConfigError>;
}

/** Both probe steps share the empty cwd generation runs in, so they read the same CLI config. */
export async function probeHarnessCli(
  args: HarnessProbeArgs,
): Promise<Result<void, ConfigError>> {
  const workDir = createHarnessWorkDir("harness-probe-");
  try {
    return await runHarnessProbes(args, workDir.cwd);
  } finally {
    removeHarnessWorkDir(workDir, args.log);
  }
}

async function runHarnessProbes(
  args: HarnessProbeArgs,
  cwd: string,
): Promise<Result<void, ConfigError>> {
  const timeouts: HarnessTimeouts = {
    hardMs: args.timeoutMs ?? 10_000,
    inactivityMs: args.timeoutMs ?? 10_000,
    killGraceMs: 1_000,
  };
  const base: Omit<HarnessRunArgs, "argv"> = {
    command: args.command,
    stdin: "",
    timeouts,
    env: args.env,
    cliEnv: args.cliEnv,
    cwd,
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
        error.kind === GeneratorErrorKinds.CLI_MISSING
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
  // Interpreter strings may embed untrusted CLI stdout: redact at this boundary
  // so the no-secrets invariant holds regardless of adapter discipline.
  const versionWarning = args.interpretVersionOutput?.(version.stdout) ?? null;
  if (versionWarning !== null) {
    args.log?.(redactSecrets(versionWarning));
  }

  let auth: HarnessRunResult;
  try {
    auth = await runHarnessProcess({ ...base, argv: args.authArgv });
  } catch (error) {
    if (error instanceof GeneratorError) {
      return configError([
        `${args.command}: auth preflight could not run — ${
          error.kind === GeneratorErrorKinds.CLI_MISSING
            ? "binary disappeared mid-probe"
            : error.message
        }`,
      ]);
    }
    throw error;
  }
  if (auth.timedOut) {
    // A hung preflight is NOT an auth verdict, telling an authenticated
    // operator to log in again would be a false diagnosis.
    return configError([
      `${args.command}: auth preflight timed out before completing`,
    ]);
  }
  if (auth.exitCode === null) {
    // Killed by an external signal, no auth verdict was produced; the
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
  if (args.interpretAuthOutput) {
    const verdict = args.interpretAuthOutput(auth.stdout);
    if (!verdict.ok) {
      // Same redaction boundary on the refusal path (transient never applies:
      // a wrong billing route is deterministic config, not a flaky network).
      return configError(verdict.error.issues.map(redactSecrets));
    }
    if (verdict.value !== null) {
      args.log?.(redactSecrets(verdict.value));
    }
  }

  return { ok: true, value: undefined };
}
