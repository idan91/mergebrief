import {
  spawn,
  type SpawnOptionsWithStdioTuple,
  type StdioPipe,
} from "node:child_process";
import { GeneratorError, GeneratorErrorKinds } from "../contract/errors";
import type { Logger } from "../contract/generator";

/**
 * Spawn argv without a shell and deliver prompts through stdin.
 * CLI adapters have no native timeout: keep both hard and inactivity watchdogs.
 * Cancellation and timeout share the SIGINT/grace/SIGKILL ladder; adapters own envelope quirks.
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
 * How much stderr is retained for failure classification and messages,
 * measured in UTF-16 code units (string .slice), not bytes: the bound keeps
 * errors and dumps small, it is not a wire-level byte contract. Non-ASCII
 * stderr may occupy up to three times this many UTF-8 bytes.
 */
const STDERR_TAIL_UNITS = 4096;

/** How much of stderr's HEAD is retained (same unit caveats as the tail). */
const STDERR_HEAD_UNITS = 1024;

/**
 * Output floods can reset inactivity indefinitely and exhaust memory before the hard timer.
 * Bound UTF-16 accumulation with headroom above normal generation envelopes.
 */
const DEFAULT_MAX_STDOUT_UNITS = 16 * 1024 * 1024;

/** Per-instance timer tunables. */
export interface HarnessTimeoutOverrides {
  hardMs?: number | undefined;
  inactivityMs?: number | undefined;
  killGraceMs?: number | undefined;
}

/** Explicit per-field merge: a present-but-undefined override key must not
 * clobber a default (exactOptionalPropertyTypes-safe). */
export function resolveHarnessTimeouts(
  overrides: HarnessTimeoutOverrides | undefined,
): HarnessTimeouts {
  return {
    hardMs: overrides?.hardMs ?? DEFAULT_HARNESS_TIMEOUTS.hardMs,
    inactivityMs:
      overrides?.inactivityMs ?? DEFAULT_HARNESS_TIMEOUTS.inactivityMs,
    killGraceMs: overrides?.killGraceMs ?? DEFAULT_HARNESS_TIMEOUTS.killGraceMs,
  };
}

export interface HarnessRunArgs {
  /** Binary path or name (resolved via PATH by spawn, never a shell). */
  command: string;
  argv: readonly string[];
  /** The prompt. Written to stdin, then stdin closes (dodges ARG_MAX). */
  stdin: string;
  timeouts: HarnessTimeouts;
  /**
   * Cooperative cancellation: abort runs the kill ladder and
   * the returned promise rejects with the signal's reason UNTOUCHED.
   */
  signal?: AbortSignal;
  /** Complete stdout lines, in order, the adapters' envelope boundary. */
  onStdoutLine?: (line: string) => void;
  /** Spawn env, from the composition root (CLIs need HOME/keychain for auth). */
  env: Record<string, string | undefined>;
  cwd?: string;
  log?: Logger;
  /** Cap on accumulated stdout, UTF-16 code units. Default 16M. */
  maxStdoutUnits?: number;
}

export interface HarnessRunResult {
  stdout: string;
  /**
   * First ~1 KB of stderr, failure PREFIXES live at the head, and a long
   * payload after them (cursor's ~200-id available-models list) flushes
   * them out of the rolling tail below.
   */
  stderrHead: string;
  /** Last ~4 KB of stderr, classification context, never dumped wholesale. */
  stderrTail: string;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  /** Which timer killed the run, if any. */
  timedOut: "hard" | "inactivity" | null;
}

/**
 * Timer kills resolve to classified outcomes. Only aborts and spawn failures reject;
 * preserve abort reasons unchanged and classify missing binaries as cli-missing.
 */
export async function runHarnessProcess(
  args: HarnessRunArgs,
): Promise<HarnessRunResult> {
  if (args.signal?.aborted) {
    throw toAbortReason(args.signal);
  }
  return new Promise<HarnessRunResult>((resolve, reject) => {
    // detached: the child leads its own process GROUP, so the kill ladder
    // can signal the whole tree, agentic CLIs fork subprocesses, and a
    // SIGKILL to the direct child alone would orphan them past the timers.
    const spawnOptions: SpawnOptionsWithStdioTuple<
      StdioPipe,
      StdioPipe,
      StdioPipe
    > = {
      env: envForSpawn(args.env),
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    };

    if (args.cwd) spawnOptions.cwd = args.cwd;

    const child = spawn(args.command, [...args.argv], spawnOptions);

    let stdout = "";
    let stderrHead = "";
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
      // Never signal a child without a positive pid. During macOS spawn failure its internal
      // handle may still use pid 0; child.kill or kill(-0) would signal our own process group.
      if (!pid) return;
      try {
        process.kill(-pid, sig);
      } catch {
        // Group already gone or unsupported, try the direct child.
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
        // SIGKILL itself, after this callback ran, that second kill could
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

    // Consumer exceptions must kill and reject rather than escape the event callback.
    // Once a terminal cause wins, suppress kill-grace output so a malformed flush cannot replace it.
    const deliverLine = (line: string): void => {
      if (terminalCause() || !args.onStdoutLine) return;
      try {
        args.onStdoutLine(line);
      } catch (error) {
        // Re-check: a REENTRANT callback may have aborted the signal (or a
        // timer fired) before throwing, the earlier cause keeps the run.
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
        // the group, finish the ladder for the group NOW (ESRCH-safe).
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
      // SIGINT-ignoring flooder) are dropped, appending would defeat the
      // bound being enforced.
      if (stdoutCapped) return;
      resetInactivity();
      stdout += text;
      // Runaway-output bound. The BOUND is enforced unconditionally, a
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
      if (stderrHead.length < STDERR_HEAD_UNITS) {
        stderrHead = (stderrHead + text).slice(0, STDERR_HEAD_UNITS);
      }
      stderrTail = (stderrTail + text).slice(-STDERR_TAIL_UNITS);
    });

    // The child may exit before draining stdin (EPIPE), that's the child's
    // outcome to report via exit code, not a spawn failure.
    child.stdin.on("error", () => {});
    child.stdin.write(args.stdin);
    child.stdin.end();

    child.on("error", (error: NodeJS.ErrnoException) => {
      // Only PRE-spawn failures (ENOENT/EACCES, pid never assigned) are
      // cli-missing; post-spawn process-control errors (e.g. a kill failing)
      // must not hijack the run's outcome, the close handler owns it.
      if (child.pid !== undefined) return;
      cleanup();
      // An abort that landed during the async spawn gap still wins: the
      // abort rejection propagates untouched.
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
            GeneratorErrorKinds.OPAQUE,
            `${args.command}: stdout exceeded ${maxStdoutUnits} characters — runaway output, process killed`,
          ),
        );
        return;
      }
      resolve({
        stdout,
        stderrHead,
        stderrTail,
        exitCode,
        exitSignal,
        timedOut,
      });
    });
  });
}

/**
 * Codes meaning "this executable does not exist or cannot be executed",
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
      GeneratorErrorKinds.CLI_MISSING,
      `${command}: not found or not runnable (${code})`,
      { cause: error },
    );
  }
  return new GeneratorError(
    GeneratorErrorKinds.OPAQUE,
    `${command}: spawn failed (${code})`,
    { cause: error },
  );
}

/** The abort rejection: the signal's reason, untouched. */
function toAbortReason(signal: AbortSignal | undefined): unknown {
  // UNTOUCHED includes falsy reasons: abort(null) sets reason to null and
  // the caller gets null back. (abort() with no argument sets an AbortError
  // DOMException per spec, so an aborted signal's reason is never absent.)
  // The fallback exists only for the impossible no-signal call shape.
  return signal !== undefined ? signal.reason : new Error("aborted");
}

/**
 * Strip credential/billing redirects that override the CLI's interactive login.
 * CLAUDE_CODE_OAUTH_TOKEN survives as the intended subscription route.
 * Settings-file apiKeyHelper is outside this environment boundary.
 */
export const HARNESS_STRIPPED_CREDENTIAL_VARS = [
  // claude: key/token outrank OAuth; the cloud switches + base-url redirect
  // outrank everything.
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  // codex: CODEX_API_KEY is the documented `codex exec` env auth;
  // OPENAI_API_KEY is login-time; CODEX_ACCESS_TOKEN is enterprise tokens.
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  // cursor: the endpoint redirect must never reach a spawn. CURSOR_API_KEY
  // deliberately SURVIVES, it outranks the stored login in the CLI's auth
  // precedence but bills the SAME subscription pool (the claude vars above
  // are stripped for the opposite reason: they rebill to an API account).
  "CURSOR_API_ENDPOINT",
] as const;

/**
 * Spawn env: strip undefined values (spawn requires string values) and the
 * credential vars above (billing-route guarantee).
 */
function envForSpawn(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const source = env;
  const stripped = new Set<string>(HARNESS_STRIPPED_CREDENTIAL_VARS);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && !stripped.has(key)) out[key] = value;
  }
  return out;
}
