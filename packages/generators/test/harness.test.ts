import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GeneratorError, GeneratorErrorKind } from "../src/contract/errors";
import {
  HARNESS_STRIPPED_CREDENTIAL_VARS,
  runHarnessProcess,
  spawnFailureError,
  type HarnessTimeouts,
} from "../src/harness/run";
import { harnessTimeoutError, redactSecrets } from "../src/harness/redact";
import { probeHarnessCli } from "../src/harness/probe";
import { configError } from "../src/contract/errors";

/**
 * Process-lifecycle tests against REAL child processes running fake CLI
 * binaries (fake the binary, never the spawn).
 * Timer durations are injected at tens-of-milliseconds scale with ~10x
 * ratios between tiers; assertions are about BEHAVIOR (which timer fired,
 * which signal, marker files), never about durations.
 */

const shimDir = fileURLToPath(new URL("./shims/", import.meta.url));
const FAKE_CLAUDE = join(shimDir, "fake-claude.cjs");

/**
 * Scaled-real timers with CI-load headroom: inactivity (400ms) comfortably
 * exceeds a loaded-machine node startup; hard keeps a ~10x ratio; grace
 * gives SIGINT handlers real scheduling room. Assertions stay behavioral.
 */
const TEST_TIMEOUTS: HarnessTimeouts = {
  hardMs: 4000,
  inactivityMs: 400,
  killGraceMs: 150,
};

function run(
  scenario: string,
  extra: {
    env?: Record<string, string>;
    signal?: AbortSignal;
    timeouts?: HarnessTimeouts;
    stdin?: string;
    onStdoutLine?: (line: string) => void;
  } = {},
) {
  return runHarnessProcess({
    command: process.execPath,
    argv: [FAKE_CLAUDE],
    stdin: extra.stdin ?? "prompt body",
    timeouts: extra.timeouts ?? TEST_TIMEOUTS,
    env: { SHIM_SCENARIO: scenario, ...extra.env },
    ...(extra.signal ? { signal: extra.signal } : {}),
    ...(extra.onStdoutLine ? { onStdoutLine: extra.onStdoutLine } : {}),
  });
}

describe("runHarnessProcess", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "harness-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("collects stdout, exits clean, no timeout, lines delivered in order", async () => {
    const lines: string[] = [];
    const result = await run("valid", {
      env: { SHIM_OUTPUT: '{"title":"t"}' },
      onStdoutLine: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBeNull();
    expect(result.stdout).toContain('"type":"result"');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toContain('"init"');
  });

  it("delivers the prompt via stdin (no argv, no ARG_MAX exposure)", async () => {
    const marker = `prompt-${Date.now()}-with ünïcode and "quotes"`;
    const result = await run("echo-stdin", { stdin: marker });
    expect(result.stdout).toContain(JSON.stringify(marker).slice(1, -1));
  });

  it("fires the inactivity watchdog on a silent hang", async () => {
    const result = await run("hang");
    expect(result.timedOut).toBe("inactivity");
    expect(result.exitCode).not.toBe(0);
  });

  it("does not fire the watchdog while output drips slower than the hard cap", async () => {
    // Total drip time (12 x 100ms = 1.2s) far exceeds inactivityMs (400ms):
    // only the resets keep it alive. Then the shim exits cleanly.
    const result = await run("slow-drip", {
      env: {
        SHIM_DRIP_MS: "100",
        SHIM_DRIP_COUNT: "12",
        SHIM_DRIP_THEN: "exit",
        SHIM_OUTPUT: '{"title":"t"}',
      },
    });
    expect(result.timedOut).toBeNull();
    expect(result.exitCode).toBe(0);
  });

  it("still bounds a dripping-forever run with the hard timeout", async () => {
    const result = await run("slow-drip", {
      env: { SHIM_DRIP_MS: "100", SHIM_DRIP_COUNT: "1000" },
      timeouts: { hardMs: 1200, inactivityMs: 400, killGraceMs: 150 },
    });
    expect(result.timedOut).toBe("hard");
  });

  it("escalates SIGINT to SIGKILL when the process ignores it", async () => {
    const markerFile = join(dir, "sigint-marker");
    const result = await run("ignores-sigint", {
      env: { SHIM_MARKER_FILE: markerFile },
    });
    expect(result.timedOut).toBe("inactivity");
    // SIGINT was delivered AND recorded…
    expect(readFileSync(markerFile, "utf8")).toContain("SIGINT");
    // …and the ladder finished the job.
    expect(result.exitSignal).toBe("SIGKILL");
  });

  it("delivers multibyte characters split across chunks intact", async () => {
    const lines: string[] = [];
    const result = await run("split-multibyte", {
      onStdoutLine: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("héllo");
    expect(result.stdout).not.toContain("�");
    expect(lines.join("")).toContain("héllo");
  });

  it("finishes the group SIGKILL even when a cooperative child closes first", async () => {
    // Parent dies on SIGINT; the SIGINT-ignoring grandchild must still be
    // taken down by the ladder's group escalation after close.
    const pidFile = join(dir, "grandchild-pid");
    const result = await run("spawn-grandchild", {
      env: { SHIM_GRANDCHILD_PID_FILE: pidFile },
    });
    expect(result.timedOut).toBe("inactivity");
    const grandchildPid = Number(readFileSync(pidFile, "utf8"));
    expect(Number.isInteger(grandchildPid)).toBe(true);
    // Poll until the grandchild is gone (signal 0 throws ESRCH when dead).
    await expect
      .poll(
        () => {
          try {
            process.kill(grandchildPid, 0);
            return "alive";
          } catch {
            return "dead";
          }
        },
        { timeout: 2000 },
      )
      .toBe("dead");
  });

  it("propagates an abort rejection untouched and kills the process", async () => {
    const controller = new AbortController();
    const reason = new Error("superseded by newer head");
    const promise = run("hang", {
      signal: controller.signal,
      timeouts: { hardMs: 5000, inactivityMs: 5000, killGraceMs: 40 },
    });
    setTimeout(() => controller.abort(reason), 50);
    await expect(promise).rejects.toBe(reason);
  });

  it("keeps the timeout outcome when an abort lands during the kill grace", async () => {
    const controller = new AbortController();
    const markerFile = join(dir, "grace-marker");
    const promise = run("ignores-sigint", {
      signal: controller.signal,
      env: { SHIM_MARKER_FILE: markerFile },
      timeouts: { hardMs: 4000, inactivityMs: 300, killGraceMs: 600 },
    });
    // Well inside the grace window: watchdog (300ms) fired, SIGKILL (900ms) not yet.
    setTimeout(() => controller.abort(new Error("late abort")), 600);
    const result = await promise;
    expect(result.timedOut).toBe("inactivity");
  });

  it("settles the run when the line consumer throws (no uncaught escape)", async () => {
    const boom = new Error("adapter parse failure");
    const promise = run("slow-drip", {
      env: { SHIM_DRIP_MS: "100", SHIM_DRIP_COUNT: "1000" },
      onStdoutLine: () => {
        throw boom;
      },
    });
    // Rejects with the consumer's error — and the process was killed rather
    // than dripping until a timer fired.
    await expect(promise).rejects.toBe(boom);
  });

  it("keeps the timeout outcome when a dying CLI's flush makes the consumer throw", async () => {
    const result = await run("flush-on-sigint", {
      onStdoutLine: () => {
        throw new Error("consumer chokes on the dying flush");
      },
    });
    // Watchdog fired first; the grace-window flush is not delivered.
    expect(result.timedOut).toBe("inactivity");
  });

  it("keeps the abort rejection when a dying CLI's flush makes the consumer throw", async () => {
    const controller = new AbortController();
    const reason = new Error("superseded");
    const promise = run("flush-on-sigint", {
      signal: controller.signal,
      timeouts: { hardMs: 5000, inactivityMs: 5000, killGraceMs: 300 },
      onStdoutLine: () => {
        throw new Error("consumer chokes on the dying flush");
      },
    });
    setTimeout(() => controller.abort(reason), 80);
    await expect(promise).rejects.toBe(reason);
  });

  it("lets an abort during the spawn gap beat an ENOENT rejection", async () => {
    const controller = new AbortController();
    const reason = new Error("aborted before spawn settled");
    const promise = runHarnessProcess({
      command: join(dir, "definitely-not-a-real-binary"),
      argv: [],
      stdin: "",
      timeouts: TEST_TIMEOUTS,
      signal: controller.signal,
    });
    // Same tick, before the async 'error' event fires.
    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
  });

  it("keeps a reentrant callback's abort over its own throw", async () => {
    const controller = new AbortController();
    const reason = new Error("callback-initiated abort");
    const promise = run("slow-drip", {
      signal: controller.signal,
      env: { SHIM_DRIP_MS: "100", SHIM_DRIP_COUNT: "1000" },
      onStdoutLine: () => {
        controller.abort(reason);
        throw new Error("and then it threw");
      },
    });
    await expect(promise).rejects.toBe(reason);
  });

  it("rejects a consumer failure on the unterminated final line without a post-close ladder", async () => {
    // The child exits cleanly leaving an unterminated line; the consumer
    // throws on the close-time flush. The run must reject with that error —
    // and must NOT signal the (post-close, possibly reused) process group.
    const boom = new Error("final-line consumer failure");
    const promise = runHarnessProcess({
      command: process.execPath,
      argv: ["-e", "process.stdout.write('unterminated-final')"],
      stdin: "",
      timeouts: TEST_TIMEOUTS,
      onStdoutLine: () => {
        throw boom;
      },
    });
    await expect(promise).rejects.toBe(boom);
  });

  it("keeps a reentrant abort from the final-line flush over its own throw", async () => {
    const controller = new AbortController();
    const reason = new Error("aborted from the final flush");
    const promise = runHarnessProcess({
      command: process.execPath,
      argv: ["-e", "process.stdout.write('unterminated-final')"],
      stdin: "",
      timeouts: TEST_TIMEOUTS,
      signal: controller.signal,
      onStdoutLine: () => {
        controller.abort(reason);
        throw new Error("and then it threw");
      },
    });
    await expect(promise).rejects.toBe(reason);
  });

  it("propagates a null abort reason untouched", async () => {
    // abort(null) sets signal.reason to null — the caller must get null
    // back, not a synthesized Error — untouched means falsy too.
    const controller = new AbortController();
    const promise = run("hang", { signal: controller.signal });
    setTimeout(() => controller.abort(null), 50);
    await expect(promise).rejects.toBe(null);
  });

  it("kills a flooding CLI at the stdout cap with a classified overflow error", async () => {
    // Steady large chunks keep resetting the inactivity watchdog — the cap
    // must terminate the run long before the hard timer.
    const promise = runHarnessProcess({
      command: process.execPath,
      argv: [
        "-e",
        "const b = 'x'.repeat(65536) + '\\n'; setInterval(() => process.stdout.write(b), 5)",
      ],
      stdin: "",
      timeouts: TEST_TIMEOUTS,
      maxStdoutUnits: 256 * 1024,
    });
    await expect(promise).rejects.toBeInstanceOf(GeneratorError);
    await expect(promise).rejects.toMatchObject({
      kind: GeneratorErrorKind.OPAQUE,
    });
    await expect(promise).rejects.toThrow(/stdout exceeded/);
  });

  it("keeps the stdout bound during another cause's kill grace", async () => {
    // Silent hang → the inactivity watchdog fires FIRST (owns the outcome);
    // on SIGINT the dying CLI floods stdout through the grace window — the
    // returned partial stdout must still respect the cap.
    const cap = 64 * 1024;
    const result = await runHarnessProcess({
      command: process.execPath,
      argv: [
        "-e",
        "process.on('SIGINT', () => { const b = 'x'.repeat(65536) + '\\n'; setInterval(() => process.stdout.write(b), 5); }); setInterval(() => {}, 60000)",
      ],
      stdin: "",
      timeouts: { hardMs: 4000, inactivityMs: 300, killGraceMs: 200 },
      maxStdoutUnits: cap,
    });
    expect(result.timedOut).toBe("inactivity");
    expect(result.stdout.length).toBeLessThanOrEqual(cap);
  });

  it("classifies spawn failures honestly: missing binary vs system failure", () => {
    const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    expect(spawnFailureError("claude", enoent).kind).toBe(
      GeneratorErrorKind.CLI_MISSING,
    );
    // Resource exhaustion is not a missing binary — no PATH remediation.
    const emfile = Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" });
    const systemFailure = spawnFailureError("claude", emfile);
    expect(systemFailure.kind).toBe(GeneratorErrorKind.OPAQUE);
    expect(systemFailure.message).toContain("EMFILE");
    expect(systemFailure.message).not.toContain("not found");
  });

  it("classifies a missing binary as cli-missing", async () => {
    const promise = runHarnessProcess({
      command: join(dir, "definitely-not-a-real-binary"),
      argv: [],
      stdin: "",
      timeouts: TEST_TIMEOUTS,
    });
    await expect(promise).rejects.toBeInstanceOf(GeneratorError);
    await expect(promise).rejects.toMatchObject({
      kind: GeneratorErrorKind.CLI_MISSING,
    });
  });

  it("captures a bounded stderr head and tail", async () => {
    // Long stderr keeps BOTH ends: the head (failure prefixes live there —
    // a payload after them flushes the rolling tail) and the tail.
    const big = "x".repeat(10_000);
    const result = await run("stderr-exit", {
      env: { SHIM_STDERR: `THE-START${big}THE-END`, SHIM_EXIT_CODE: "3" },
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderrHead.length).toBeLessThanOrEqual(1024);
    expect(result.stderrHead).toContain("THE-START");
    expect(result.stderrTail.length).toBeLessThanOrEqual(4096);
    expect(result.stderrTail).toContain("THE-END");
    expect(result.stderrTail).not.toContain("THE-START");
  });
});

/** Every stripped var set to a live value — derived from the exported
 * list so a var added there is automatically under test. */
const leakedCredentials = () =>
  Object.fromEntries(
    HARNESS_STRIPPED_CREDENTIAL_VARS.map((name) => [name, `leaked-${name}`]),
  );

describe("billing-route guarantee: credential vars never reach the CLI", () => {
  it("strips every listed var from the spawn env while HOME passes through", async () => {
    const result = await run("env-echo", {
      env: { ...leakedCredentials(), HOME: "/fake/home" },
    });
    expect(result.exitCode).toBe(0);
    const envelope: unknown = result.stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line): unknown => JSON.parse(line))
      .find(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "structured_output" in event,
      );
    expect(envelope).toMatchObject({
      structured_output: { leakedVars: [], home: "/fake/home" },
    });
  });

  it("strips the vars on the PROBE path too — boot verifies the credential generation will use", async () => {
    const probe = await probeHarnessCli({
      command: process.execPath,
      versionArgv: [FAKE_CLAUDE, "--version"],
      authArgv: [FAKE_CLAUDE, "auth", "status"],
      authFailureHint: "hint",
      env: {
        ...leakedCredentials(),
        SHIM_SCENARIO: "auth-fail-if-credentials",
      },
    });
    // The shim's auth status FAILS if any credential var reached it — an
    // ok probe proves the strip covers the preflight, not just generation.
    expect(probe.ok).toBe(true);
  });
});

describe("harnessTimeoutError / redactSecrets", () => {
  it("redacts credential-shaped stderr before it reaches the message", async () => {
    const result = await runHarnessProcess({
      command: process.execPath,
      argv: [FAKE_CLAUDE],
      stdin: "p",
      timeouts: TEST_TIMEOUTS,
      env: {
        SHIM_SCENARIO: "stderr-exit",
        SHIM_STDERR:
          "auth failed for sk-ant-api03-supersecretvalue Bearer abc.def.ghi last\n",
        SHIM_EXIT_CODE: "1",
      },
    });
    // Simulate a timeout classification carrying that stderr tail.
    const error = harnessTimeoutError("brief", { ...result, timedOut: "hard" });
    expect(error.kind).toBe(GeneratorErrorKind.TIMEOUT);
    expect(error.message).not.toContain("supersecretvalue");
    expect(error.message).not.toContain("abc.def.ghi");
    expect(error.message).toContain("(redacted)");
    expect(error.message).toContain("last");
  });

  it("redacts credential assignments and query parameters", async () => {
    const result = await runHarnessProcess({
      command: process.execPath,
      argv: [FAKE_CLAUDE],
      stdin: "p",
      timeouts: TEST_TIMEOUTS,
      env: {
        SHIM_SCENARIO: "stderr-exit",
        SHIM_STDERR:
          "login failed: password=hunter2 token: abc.def AWS_ACCESS_KEY_ID=AKIAXXXX GET /v1?api_key=zzz9 tail\n",
        SHIM_EXIT_CODE: "1",
      },
    });
    const error = harnessTimeoutError("brief", { ...result, timedOut: "hard" });
    expect(error.message).not.toContain("hunter2");
    expect(error.message).not.toContain("abc.def");
    expect(error.message).not.toContain("AKIAXXXX");
    expect(error.message).not.toContain("zzz9");
    expect(error.message).toContain("tail");
  });

  it("redacts a compound 'token: Bearer x' as a unit", async () => {
    const result = await runHarnessProcess({
      command: process.execPath,
      argv: [FAKE_CLAUDE],
      stdin: "p",
      timeouts: TEST_TIMEOUTS,
      env: {
        SHIM_SCENARIO: "stderr-exit",
        SHIM_STDERR: "refused: token: Bearer abc.def.ghi rest\n",
        SHIM_EXIT_CODE: "1",
      },
    });
    const error = harnessTimeoutError("brief", { ...result, timedOut: "hard" });
    expect(error.message).not.toContain("abc.def.ghi");
    expect(error.message).toContain("rest");
  });

  it("redacts Authorization headers (Basic and Digest) and bare JWTs", async () => {
    const result = await runHarnessProcess({
      command: process.execPath,
      argv: [FAKE_CLAUDE],
      stdin: "p",
      timeouts: TEST_TIMEOUTS,
      env: {
        SHIM_SCENARIO: "stderr-exit",
        // Header rules take the line remainder (Digest is a param list, not
        // one token) — unrelated text goes on its own lines.
        SHIM_STDERR:
          'Authorization: Basic dXNlcjpwYXNz\nProxy-Authorization: Digest username="u", response="abc123"\nthen eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.s1g_9 tail\n',
        SHIM_EXIT_CODE: "1",
      },
    });
    const error = harnessTimeoutError("brief", { ...result, timedOut: "hard" });
    expect(error.message).not.toContain("dXNlcjpwYXNz");
    expect(error.message).not.toContain("username=");
    expect(error.message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(error.message).toContain("tail");
  });

  it("leaves text after 'Basic' alone while redacting encoded credentials", () => {
    const out = redactSecrets(
      "Basic usage failed; sent Basic dXNlcjpwYXNz here",
    );
    expect(out).toContain("Basic usage failed");
    expect(out).not.toContain("dXNlcjpwYXNz");
    expect(out).toContain("here");
    // Scheme case-insensitivity (RFC 7235) without loosening the token check:
    // any scheme casing redacts, lowercase text still survives.
    const lower = redactSecrets(
      "using basic dXNlcjpwYXNz; basic authentication failed",
    );
    expect(lower).not.toContain("dXNlcjpwYXNz");
    expect(lower).toContain("basic authentication failed");
    expect(redactSecrets("bAsIc dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz");
  });

  it("redacts cookie headers whole-line and quoted assignment values", () => {
    const cookies = redactSecrets(
      "Set-Cookie: sessionid=hunter2; HttpOnly\nsent Cookie: sid=abc123zz\nnext line stays",
    );
    expect(cookies).not.toContain("hunter2");
    expect(cookies).not.toContain("abc123zz");
    expect(cookies).toContain("next line stays");
    // Quoted values are consumed to the closing quote — password="hunter 2"
    // must not strand a credential suffix after the space.
    const quoted = redactSecrets(`login password="hunter 2" attempt`);
    expect(quoted).not.toContain("hunter 2");
    expect(quoted).not.toContain('2"');
    expect(quoted).toContain("attempt");
    // JSON-shaped keys and headers (CLIs dump JSON error bodies to stderr).
    const json = redactSecrets(
      `{"password":"hunter2","Authorization":"Basic dXNlcjpwYXNz"} trailing`,
    );
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("dXNlcjpwYXNz");
  });

  it("redacts URL-embedded credentials and hex secrets", async () => {
    const result = await runHarnessProcess({
      command: process.execPath,
      argv: [FAKE_CLAUDE],
      stdin: "p",
      timeouts: TEST_TIMEOUTS,
      env: {
        SHIM_SCENARIO: "stderr-exit",
        SHIM_STDERR:
          "dial postgres://svc:hunter2@db.internal:5432/app failed; token deadbeefdeadbeefdeadbeefdeadbeef end\n",
        SHIM_EXIT_CODE: "1",
      },
    });
    const error = harnessTimeoutError("brief", {
      ...result,
      timedOut: "inactivity",
    });
    expect(error.message).not.toContain("hunter2");
    expect(error.message).not.toContain("deadbeefdeadbeef");
    expect(error.message).toContain("postgres://(redacted)@db.internal");
    expect(error.message).toContain("end");
  });
});

describe("probeHarnessCli", () => {
  const probeArgs = {
    command: process.execPath,
    versionArgv: [FAKE_CLAUDE, "--version"],
    authArgv: [FAKE_CLAUDE, "auth", "status"],
    authFailureHint: "log the CLI in interactively first",
  };

  it("passes when version and auth both succeed", async () => {
    const result = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
    });
    expect(result.ok).toBe(true);
  });

  it("fails with a cli-missing issue when the binary is absent", async () => {
    const result = await probeHarnessCli({
      ...probeArgs,
      command: "/nonexistent/claude-binary",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("not found");
  });

  it("fails when the version probe exits nonzero", async () => {
    const result = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "version-broken" },
    });
    expect(result.ok).toBe(false);
  });

  it("fails with the auth hint when the auth preflight exits nonzero", async () => {
    const result = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "auth-error" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain(
      "log the CLI in interactively first",
    );
  });

  it("reports a signalled auth preflight as incomplete, not as not-authenticated", async () => {
    // Externally killed preflight: exitCode null, no auth verdict produced.
    const result = await probeHarnessCli({
      ...probeArgs,
      authArgv: ["-e", 'process.kill(process.pid, "SIGTERM")'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain("terminated by signal");
    expect(text).not.toContain("not authenticated");
  });

  it("reports a hung auth preflight as a timeout, not as not-authenticated", async () => {
    const result = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "auth-hang" },
      timeoutMs: 400,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain("timed out");
    expect(text).not.toContain("not authenticated");
  });

  it("surfaces interpreter warnings through log and still passes", async () => {
    const warnings: string[] = [];
    const seen: { version?: string; auth?: string } = {};
    const result = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      log: (message) => warnings.push(message),
      interpretVersionOutput: (stdout) => {
        seen.version = stdout;
        return "warning: version below the verified floor";
      },
      interpretAuthOutput: (stdout) => {
        seen.auth = stdout;
        return { ok: true, value: "warning: billing route unverifiable" };
      },
    });
    expect(result.ok).toBe(true);
    expect(warnings).toEqual([
      "warning: version below the verified floor",
      "warning: billing route unverifiable",
    ]);
    // Interpreters read the probes' actual stdout, not a reformatting.
    expect(seen.version).toContain("Claude Code");
    expect(seen.auth).toContain("claude.ai");
  });

  it("stays silent when interpreters return no warning", async () => {
    const warnings: string[] = [];
    const result = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      log: (message) => warnings.push(message),
      interpretVersionOutput: () => null,
      interpretAuthOutput: () => ({ ok: true, value: null }),
    });
    expect(result.ok).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("refuses boot when the auth interpreter rejects the route", async () => {
    const result = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      interpretAuthOutput: () => configError(["billing route is an API key"]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toEqual(["billing route is an API key"]);
  });

  it("redacts interpreter strings before they reach logs or errors", async () => {
    // Interpreters may embed untrusted CLI stdout; the startup-check boundary redacts
    // both channels regardless of adapter discipline.
    const warnings: string[] = [];
    const warned = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      log: (message) => warnings.push(message),
      interpretVersionOutput: () =>
        "warning: odd version sk-ant-api03-supersecretvalue reported",
    });
    expect(warned.ok).toBe(true);
    expect(warnings.join("; ")).not.toContain("supersecretvalue");
    expect(warnings.join("; ")).toContain("odd version");

    const refused = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      interpretAuthOutput: () =>
        configError(["route uses Bearer abc.def.ghi credentials"]),
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    const text = refused.error.issues.join("; ");
    expect(text).not.toContain("abc.def.ghi");
    expect(text).toContain("route uses");
  });

  it("never invokes interpreters when their probe step failed", async () => {
    // Nonzero auth exit keeps the generic not-authenticated verdict; the
    // route interpreter must not run against a failed preflight's output.
    let called = 0;
    const result = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "auth-error" },
      interpretAuthOutput: () => {
        called++;
        return { ok: true, value: null };
      },
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(0);

    // Same contract on the version side: a failed --version keeps its
    // generic verdict and never reaches the interpreter.
    let versionCalled = 0;
    const broken = await probeHarnessCli({
      ...probeArgs,
      env: { SHIM_SCENARIO: "version-broken" },
      interpretVersionOutput: () => {
        versionCalled++;
        return null;
      },
    });
    expect(broken.ok).toBe(false);
    expect(versionCalled).toBe(0);
  });
});

describe("shim self-checks", () => {
  it("fake-codex answers with a JSON string needing a double parse", async () => {
    const FAKE_CODEX = join(shimDir, "fake-codex.cjs");
    const lines: string[] = [];
    await runHarnessProcess({
      command: process.execPath,
      argv: [FAKE_CODEX],
      stdin: "prompt",
      timeouts: TEST_TIMEOUTS,
      env: { SHIM_SCENARIO: "valid", SHIM_OUTPUT: '{"title":"t"}' },
      onStdoutLine: (line) => lines.push(line),
    });
    const agentTexts: string[] = [];
    for (const line of lines) {
      const event: unknown = JSON.parse(line);
      if (typeof event !== "object" || event === null) continue;
      if (Reflect.get(event, "type") !== "item.completed") continue;
      const item: unknown = Reflect.get(event, "item");
      if (typeof item !== "object" || item === null) continue;
      if (Reflect.get(item, "type") !== "agent_message") continue;
      const text: unknown = Reflect.get(item, "text");
      if (typeof text === "string") agentTexts.push(text);
    }
    // Preliminary narration first, the answer LAST — consumers must pick the
    // last agent_message.
    expect(agentTexts.length).toBeGreaterThanOrEqual(2);
    const last = agentTexts.at(-1);
    // First parse: JSONL event; the answer itself is STILL a JSON string.
    expect(typeof last).toBe("string");
    expect(JSON.parse(last ?? "")).toEqual({ title: "t" });
  });

  it("marker file is absent when a cooperative process exits before SIGINT", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "harness-marker-"));
    const markerFile = join(dir2, "marker");
    await run("valid", {
      env: { SHIM_OUTPUT: '{"a":1}', SHIM_MARKER_FILE: markerFile },
    });
    expect(existsSync(markerFile)).toBe(false);
    rmSync(dir2, { recursive: true, force: true });
  });
});
