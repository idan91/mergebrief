import { spawn } from "node:child_process";
import type { Result } from "types";
import { configError, GeneratorError, GeneratorErrorKind, type ConfigError } from "./errors";
import type { Logger } from "./generator";

/**
 * The shared harness-execution core (ADR 0030 #2/#4): everything the CLI
 * adapters have in common — argv spawn (NO shell), prompt via stdin then
 * close, streaming line consumption as the liveness signal, the two
 * mandatory timers (hard wall-clock + output-inactivity watchdog), the
 * SIGINT → grace → SIGKILL kill ladder shared by cancellation and timer
 * fire, stderr tail capture, and the construction-time boot probe.
 *
 * The per-CLI adapters (PRs 5-6) own only flags, envelope parsing, and
 * provenance quirks. NO CLI has a built-in timeout, and this project has a
 * lived codex hang precedent — the timers are not optional.
 */

export interface HarnessTimeouts {
  /** Hard wall-clock ceiling for one process (default 15 min). */
  hardMs: number;
  /** Output-inactivity watchdog; any stdout/stderr data resets it (default 3 min). */
  inactivityMs: number;
  /** Grace between SIGINT and SIGKILL in the kill ladder (default 5 s). */
  killGraceMs: number;
}

export const DEFAULT_HARNESS_TIMEOUTS: HarnessTimeouts = {
  hardMs: 15 * 60_000,
  inactivityMs: 3 * 60_000,
  killGraceMs: 5_000,
};

/**
 * How much stderr is retained for failure classification and messages —
 * measured in UTF-16 code units (string .slice), not bytes: the bound keeps
 * errors and dumps small, it is not a wire-level byte contract. Non-ASCII
 * stderr may occupy up to three times this many UTF-8 bytes.
 */
const STDERR_TAIL_UNITS = 4096;

/**
 * Default cap on accumulated stdout (UTF-16 code units). A flooding CLI
 * keeps resetting the inactivity watchdog, so without a size bound it can
 * exhaust worker memory long before the hard timer fires. Generation
 * envelopes are at most a few MB; 16M units is an order of magnitude of
 * headroom.
 */
const DEFAULT_MAX_STDOUT_UNITS = 16 * 1024 * 1024;

export interface HarnessRunArgs {
  /** Binary path or name (resolved via PATH by spawn — never a shell). */
  command: string;
  argv: readonly string[];
  /** The prompt. Written to stdin, then stdin closes (dodges ARG_MAX). */
  stdin: string;
  timeouts: HarnessTimeouts;
  /**
   * Cooperative cancellation (ADR 0006 #6): abort runs the kill ladder and
   * the returned promise rejects with the signal's reason UNTOUCHED.
   */
  signal?: AbortSignal;
  /** Complete stdout lines, in order — the adapters' envelope seam. */
  onStdoutLine?: (line: string) => void;
  /** Spawn env; defaults to process.env (CLIs need HOME/keychain for auth). */
  env?: Record<string, string | undefined>;
  cwd?: string;
  log?: Logger;
  /** Cap on accumulated stdout, UTF-16 code units. Default 16M. */
  maxStdoutUnits?: number;
}

export interface HarnessRunResult {
  stdout: string;
  /** Last ~4 KB of stderr — classification context, never dumped wholesale. */
  stderrTail: string;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  /** Which timer killed the run, if any. */
  timedOut: "hard" | "inactivity" | null;
}

/**
 * Run one CLI process to completion under the timers. Resolves with the
 * outcome (including timer kills — those become classified failures at the
 * adapter); rejects ONLY for aborts (with the signal's reason, untouched)
 * and for spawn-level failures (missing binary → GeneratorError
 * cli-missing).
 */
export async function runHarnessProcess(
  args: HarnessRunArgs,
): Promise<HarnessRunResult> {
  if (args.signal?.aborted) {
    throw toAbortReason(args.signal);
  }
  return new Promise<HarnessRunResult>((resolve, reject) => {
    // detached: the child leads its own process GROUP, so the kill ladder
    // can signal the whole tree — agentic CLIs fork subprocesses, and a
    // SIGKILL to the direct child alone would orphan them past the timers.
    const child = spawn(args.command, [...args.argv], {
      env: envForSpawn(args.env),
      ...(args.cwd ? { cwd: args.cwd } : {}),
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    let stdout = "";
    let stderrTail = "";
    let lineBuffer = "";
    let timedOut: HarnessRunResult["timedOut"] = null;
    let aborted = false;
    let spawnFailure: GeneratorError | null = null;
    let consumerFailure: unknown;
    let consumerFailed = false;
    let overflowed = false;
    let stdoutCapped = false;
    const maxStdoutUnits = args.maxStdoutUnits ?? DEFAULT_MAX_STDOUT_UNITS;
    // ONE first-terminal-cause-wins guard for every trigger site: whichever
    // of timer/abort/consumer-failure/overflow lands first owns the outcome.
    const terminalCause = (): boolean =>
      timedOut !== null || aborted || consumerFailed || overflowed;

    // --- kill ladder (shared by both timers and abort) ---------------------
    // Signals go to the process GROUP (negative pid) so forked grandchildren
    // die with the CLI; falls back to the direct child if the group is gone.
    const signalTree = (sig: NodeJS.Signals): void => {
      const pid = child.pid;
      // A child that never spawned (ENOENT — pid never assigned) has nothing
      // to signal. Never fall through to child.kill here: during macOS's
      // async spawn-failure window the internal handle still exists with
      // pid 0, and signalling it is kill(0) — our OWN process group. The
      // !pid check also refuses pid 0 itself: kill(-0) is kill(0) too.
      if (!pid) return;
      try {
        process.kill(-pid, sig);
      } catch {
        // Group already gone or unsupported — try the direct child.
        child.kill(sig);
      }
    };
    // Idempotent: the FIRST terminal trigger (timer or abort) owns the one
    // escalation timer; later triggers must not start a second ladder or
    // orphan a pending SIGKILL (a stale timer could signal a reused pgid).
    let killTimer: NodeJS.Timeout | null = null;
    let ladderStarted = false;
    let closed = false;
    const killLadder = (): void => {
      // After close there is nothing we own left to signal: a clean exit
      // never starts a ladder (descendants of a successful run are not our
      // kill responsibility), and the pgid may already be reused. A ladder
      // that was already pending completes via cleanup(), unaffected.
      if (ladderStarted || closed) return;
      ladderStarted = true;
      signalTree("SIGINT");
      killTimer = setTimeout(() => {
        // Mark the escalation as done BEFORE signalling: cleanup() treats a
        // non-null killTimer as a pending escalation and fires the group
        // SIGKILL itself — after this callback ran, that second kill could
        // target a reused pgid.
        killTimer = null;
        signalTree("SIGKILL");
      }, args.timeouts.killGraceMs);
    };

    // --- timers -------------------------------------------------------------
    const hardTimer = setTimeout(() => {
      if (terminalCause()) return;
      timedOut = "hard";
      killLadder();
    }, args.timeouts.hardMs);
    let inactivityTimer: NodeJS.Timeout | null = null;
    const resetInactivity = (): void => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        if (terminalCause()) return;
        timedOut = "inactivity";
        killLadder();
      }, args.timeouts.inactivityMs);
    };
    resetInactivity();

    // A throwing consumer callback must SETTLE the run (kill + reject), not
    // escape an EventEmitter callback as an uncaught exception. Once ANY
    // terminal cause exists (abort, timer, earlier consumer failure), lines
    // flushed during the kill-grace window are no longer delivered — a
    // dying CLI's malformed flush must not overwrite the first cause.
    const deliverLine = (line: string): void => {
      if (terminalCause() || !args.onStdoutLine) return;
      try {
        args.onStdoutLine(line);
      } catch (error) {
        // Re-check: a REENTRANT callback may have aborted the signal (or a
        // timer fired) before throwing — the earlier cause keeps the run.
        if (terminalCause()) return;
        consumerFailed = true;
        consumerFailure = error;
        killLadder();
      }
    };

    const onAbort = (): void => {
      // First terminal cause wins: an abort landing after a watchdog fired
      // must not erase the timeout classification mid-kill.
      if (terminalCause()) return;
      aborted = true;
      killLadder();
    };
    args.signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(hardTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (killTimer) {
        clearTimeout(killTimer);
        // The direct child closed while an escalation was pending: a
        // SIGINT-cooperative CLI may leave a SIGINT-ignoring descendant in
        // the group — finish the ladder for the group NOW (ESRCH-safe).
        signalTree("SIGKILL");
        killTimer = null;
      }
      args.signal?.removeEventListener("abort", onAbort);
    };

    // --- stdio --------------------------------------------------------------
    // setEncoding: Node's StringDecoder holds multibyte sequences split
    // across chunks, so a UTF-8 character never decodes as replacement junk
    // mid-envelope.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      // Once the cap is hit, further chunks (e.g. kill-grace flushes from a
      // SIGINT-ignoring flooder) are dropped — appending would defeat the
      // bound being enforced.
      if (stdoutCapped) return;
      resetInactivity();
      stdout += text;
      // Runaway-output bound. The BOUND is enforced unconditionally — a
      // flood during another cause's kill grace must not grow memory for up
      // to killGraceMs. The overflow CLASSIFICATION stays first-cause-wins:
      // only a flood with no prior terminal cause owns the outcome.
      if (stdout.length > maxStdoutUnits) {
        stdoutCapped = true;
        if (!terminalCause()) {
          overflowed = true;
          killLadder();
          return;
        }
        stdout = stdout.slice(0, maxStdoutUnits);
        return;
      }
      if (args.onStdoutLine) {
        // Split once per chunk; only the trailing incomplete line carries
        // over (O(chunk) instead of O(chunk × lines)).
        const parts = (lineBuffer + text).split("\n");
        lineBuffer = parts.pop() ?? "";
        for (const line of parts) {
          if (line.trim() !== "") deliverLine(line);
        }
      }
    });
    child.stderr.on("data", (text: string) => {
      resetInactivity();
      stderrTail = (stderrTail + text).slice(-STDERR_TAIL_UNITS);
    });

    // The child may exit before draining stdin (EPIPE) — that's the child's
    // outcome to report via exit code, not a spawn failure.
    child.stdin.on("error", () => {});
    child.stdin.write(args.stdin);
    child.stdin.end();

    child.on("error", (error: NodeJS.ErrnoException) => {
      // Only PRE-spawn failures (ENOENT/EACCES — pid never assigned) are
      // cli-missing; post-spawn process-control errors (e.g. a kill failing)
      // must not hijack the run's outcome — the close handler owns it.
      if (child.pid !== undefined) return;
      cleanup();
      // An abort that landed during the async spawn gap still wins: the
      // abort rejection propagates untouched (ADR 0006 #6).
      if (aborted) {
        reject(toAbortReason(args.signal));
        return;
      }
      spawnFailure = spawnFailureError(args.command, error);
      reject(spawnFailure);
    });

    child.on("close", (exitCode, exitSignal) => {
      // closed BEFORE the final flush: a consumer that throws (or
      // reentrantly aborts) on the unterminated last line must reject the
      // run, never start a fresh ladder against a post-close pgid.
      closed = true;
      if (lineBuffer.trim() !== "") deliverLine(lineBuffer);
      cleanup();
      if (spawnFailure) return; // already rejected
      if (consumerFailed) {
        reject(consumerFailure);
        return;
      }
      if (aborted) {
        reject(toAbortReason(args.signal));
        return;
      }
      if (overflowed) {
        reject(
          new GeneratorError(
            GeneratorErrorKind.OPAQUE,
            `${args.command}: stdout exceeded ${maxStdoutUnits} characters — runaway output, process killed`,
          ),
        );
        return;
      }
      resolve({ stdout, stderrTail, exitCode, exitSignal, timedOut });
    });
  });
}

/**
 * Codes meaning "this executable does not exist or cannot be executed" —
 * the only shapes that honestly map to cli-missing. Resource exhaustion
 * (EMFILE/ENFILE/ENOMEM/EAGAIN) is a system condition: reporting it as a
 * missing binary sends the operator chasing PATH for nothing.
 */
const CLI_MISSING_SPAWN_CODES = new Set([
  "ENOENT",
  "ENOTDIR",
  "EACCES",
  "EPERM",
  "EISDIR",
]);

/** Classify a pre-spawn failure honestly: missing binary vs system failure. */
export function spawnFailureError(
  command: string,
  error: NodeJS.ErrnoException,
): GeneratorError {
  const code = error.code ?? "spawn error";
  if (CLI_MISSING_SPAWN_CODES.has(code)) {
    return new GeneratorError(
      GeneratorErrorKind.CLI_MISSING,
      `${command}: not found or not runnable (${code})`,
      { cause: error },
    );
  }
  return new GeneratorError(
    GeneratorErrorKind.OPAQUE,
    `${command}: spawn failed (${code})`,
    { cause: error },
  );
}

/** The abort rejection: the signal's reason, untouched (ADR 0006 #6). */
function toAbortReason(signal: AbortSignal | undefined): unknown {
  // UNTOUCHED includes falsy reasons: abort(null) sets reason to null and
  // the caller gets null back. (abort() with no argument sets an AbortError
  // DOMException per spec, so an aborted signal's reason is never absent.)
  // The fallback exists only for the impossible no-signal call shape.
  return signal !== undefined ? signal.reason : new Error("aborted");
}

/** Spawn env: strip undefined values (spawn requires string values). */
function envForSpawn(
  env: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const source = env ?? process.env;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Classified failure for a timer kill: kind timeout, with which timer fired
 * and the stderr tail (partial output goes to the failure dump at the
 * adapter, not into the message).
 */
export function harnessTimeoutError(
  label: string,
  result: HarnessRunResult,
): GeneratorError {
  const which =
    result.timedOut === "hard"
      ? "hard wall-clock timeout"
      : "output-inactivity watchdog";
  // Redact BEFORE truncating: a slice boundary inside a credential could
  // strip the marker (e.g. "Bearer ") and leave a bare secret suffix.
  const tail = redactSecrets(result.stderrTail.trim()).slice(-500);
  const stderrNote = tail === "" ? "" : `; stderr tail: ${tail}`;
  return new GeneratorError(
    GeneratorErrorKind.TIMEOUT,
    `${label}: ${which} fired and the process was killed${stderrNote}`,
  );
}

/**
 * Third-party CLI stderr is untrusted diagnostics — strip credential-shaped
 * substrings before any of it reaches an error message (the no-secrets rule
 * outranks diagnosability; the FULL tail still reaches failure dumps).
 */
export function redactSecrets(text: string): string {
  return (
    text
      // Scheme-carrying forms FIRST: `token: Bearer abc` must fall to the
      // Bearer rule as a unit, not have the assignment rule eat "Bearer"
      // and strand the credential. Authorization headers are taken whole —
      // Digest carries a comma-separated param list, not one token.
      // ["']? before the separator admits JSON-shaped headers/keys, e.g.
      // {"Authorization":"Basic x"} — CLIs dump JSON error bodies to stderr.
      .replace(/\b((?:proxy-)?authorization["']?\s*[=:]\s*)[^\n]+/gi, "$1(redacted)")
      // Cookie headers carry session credentials in arbitrary attr=value
      // pairs the assignment rule's name list can't anticipate — take the
      // whole line.
      .replace(/\b((?:set-)?cookie["']?\s*[=:]\s*)[^\n]+/gi, "$1(redacted)")
      .replace(/Bearer\s+\S+/gi, "Bearer (redacted)")
      // Standalone `Basic <credential>`: the scheme name is case-flexible
      // (RFC 7235: schemes are case-insensitive) but the token check is NOT
      // — an /i flag would let any 8+ lowercase word match. Requiring an
      // encoded-looking token (≥1 uppercase/digit/+/=) keeps prose like
      // "Basic usage failed" — common in stderr diagnostics — while
      // base64("user:pass") never survives.
      .replace(
        /\b([Bb][Aa][Ss][Ii][Cc])\s+(?=[A-Za-z0-9+/=]*[A-Z0-9+/=])[A-Za-z0-9+/=]{8,}(?![\w+/=])/g,
        "$1 (redacted)",
      )
      // Bare JWTs: segments are often too short for the length-based base64
      // rule, but the eyJ prefix (base64 of '{"') is unmistakable.
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "(redacted)")
      .replace(/(\w+:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1(redacted)@")
      .replace(
        // [\w-]* prefix: matches AWS_ACCESS_KEY_ID etc. (underscores are
        // word chars, so \b alone would miss prefixed credential names).
        // Quoted values match BEFORE \S+ — password="hunter 2" must be
        // consumed to its closing quote, not stranded at the first space.
        // ["']? after the name admits JSON-shaped keys: "password":"x".
        /([\w-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key(?:[_-]?id)?|client[_-]?secret|auth))["']?(\s*[=:]\s*)(?!Bearer \(redacted\))("[^"\n]*"|'[^'\n]*'|\S+)/gi,
        "$1$2(redacted)",
      )
      .replace(/([?&](?:api[_-]?key|token|key|secret|password)=)[^&\s]+/gi, "$1(redacted)")
      .replace(/\b(sk|rk|pk)-[\w-]{8,}/g, "$1-(redacted)")
      .replace(/\b[0-9a-f]{24,}\b/gi, "(redacted)")
      .replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, "(redacted)")
  );
}

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
