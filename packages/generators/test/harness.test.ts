import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GeneratorError, GeneratorErrorKinds } from "../src/contract/errors";
import { z } from "zod/v4";
import { CLAUDE_CLI_ENV } from "../src/adapters/claudeCode";
import { CODEX_CLI_ENV } from "../src/adapters/codex";
import { CURSOR_CLI_ENV } from "../src/adapters/cursor";
import {
  HARNESS_BASE_ENV_VARS,
  runHarnessProcess,
  spawnFailureError,
  type HarnessCliEnv,
  type HarnessRunArgs,
  type HarnessRunResult,
  type HarnessTimeouts,
} from "../src/harness/run";
import { harnessTimeoutError, redactSecrets } from "../src/harness/redact";
import { probeHarnessCli } from "../src/harness/probe";
import { configError } from "../src/contract/errors";
import { expectEmptyRemovedCwds, SHIM_CLI_ENV } from "./helpers";

/**
 * Fake the CLI binary, never spawn. Use injected short timers with separated tiers
 * and assert outcomes/signals rather than elapsed durations.
 */

const shimDir = fileURLToPath(new URL("./shims/", import.meta.url));
const FAKE_CLAUDE = join(shimDir, "fake-claude.cjs");

/**
 * Node startup under full-suite load can outlast 400ms, so a run that must
 * exit cleanly gets a budget no startup reaches. The 400ms tier is only for
 * runs meant to trip a timer.
 */
const CLEAN_EXIT_TIMEOUTS: HarnessTimeouts = {
  hardMs: 10_000,
  inactivityMs: 10_000,
  killGraceMs: 150,
};

const WATCHDOG_TIMEOUTS: HarnessTimeouts = {
  hardMs: 4000,
  inactivityMs: 400,
  killGraceMs: 150,
};

function makeTimedOutResult(
  stderrTail: string,
  timedOut: HarnessRunResult["timedOut"],
): HarnessRunResult {
  return {
    stdout: "",
    stderrHead: "",
    stderrTail,
    exitCode: null,
    exitSignal: "SIGKILL",
    timedOut,
    durationMs: 1000,
  };
}

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
  const runArgs: HarnessRunArgs = {
    cliEnv: SHIM_CLI_ENV,
    command: process.execPath,
    argv: [FAKE_CLAUDE],
    stdin: extra.stdin ?? "prompt body",
    timeouts: extra.timeouts ?? CLEAN_EXIT_TIMEOUTS,
    env: { SHIM_SCENARIO: scenario, ...extra.env },
  };

  if (extra.signal) {
    runArgs.signal = extra.signal;
  }
  if (extra.onStdoutLine) {
    runArgs.onStdoutLine = extra.onStdoutLine;
  }

  return runHarnessProcess(runArgs);
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

  it("resolves a relative command path against the parent's cwd", async () => {
    const result = await runHarnessProcess({
      cliEnv: SHIM_CLI_ENV,
      command: relative(process.cwd(), FAKE_CLAUDE),
      argv: [],
      stdin: "prompt body",
      timeouts: CLEAN_EXIT_TIMEOUTS,
      env: { ...process.env, SHIM_SCENARIO: "valid" },
      cwd: dir,
    });
    expect(result.timedOut).toBeNull();
    expect(result.exitCode).toBe(0);
  });

  it("delivers prompts through stdin without argv size exposure", async () => {
    const marker = `prompt-${Date.now()}-with ünïcode and "quotes"`;
    const result = await run("echo-stdin", { stdin: marker });
    expect(result.stdout).toContain(JSON.stringify(marker).slice(1, -1));
  });

  it("fires the inactivity watchdog on a silent hang", async () => {
    const result = await run("hang", { timeouts: WATCHDOG_TIMEOUTS });
    expect(result.timedOut).toBe("inactivity");
    expect(result.exitCode).not.toBe(0);

    // The watchdog killed the run, so it cannot have been shorter than that budget.
    expect(result.durationMs).toBeGreaterThanOrEqual(
      WATCHDOG_TIMEOUTS.inactivityMs,
    );
    expect(Number.isFinite(result.durationMs)).toBe(true);

    const error = harnessTimeoutError("brief", result);
    expect(error.kind).toBe(GeneratorErrorKinds.TIMEOUT);
    expect(error.message).toContain(`${String(result.durationMs)}ms`);
    expect(error.message).toContain("output-inactivity watchdog");
  });

  it("does not fire the watchdog while output drips slower than the hard cap", async () => {
    // Total drip time (10 x 200ms) exceeds inactivityMs (1500ms): only the
    // resets keep it alive. Then the shim exits cleanly.
    const result = await run("slow-drip", {
      timeouts: { hardMs: 10_000, inactivityMs: 1500, killGraceMs: 150 },
      env: {
        SHIM_DRIP_MS: "200",
        SHIM_DRIP_COUNT: "10",
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
      timeouts: { hardMs: 1200, inactivityMs: 10_000, killGraceMs: 150 },
    });
    expect(result.timedOut).toBe("hard");
  });

  it("escalates SIGINT to SIGKILL when the process ignores it", async () => {
    const markerFile = join(dir, "sigint-marker");
    const result = await run("ignores-sigint", {
      env: { SHIM_MARKER_FILE: markerFile },
      timeouts: WATCHDOG_TIMEOUTS,
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
      timeouts: WATCHDOG_TIMEOUTS,
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

  it("settles and rejects when the line consumer throws", async () => {
    const boom = new Error("adapter parse failure");
    const promise = run("slow-drip", {
      env: { SHIM_DRIP_MS: "100", SHIM_DRIP_COUNT: "1000" },
      onStdoutLine: () => {
        throw boom;
      },
    });
    // Rejects with the consumer's error, and the process was killed rather
    // than dripping until a timer fired.
    await expect(promise).rejects.toBe(boom);
  });

  it("preserves timeout outcomes when dying CLI flushes throw", async () => {
    const result = await run("flush-on-sigint", {
      timeouts: WATCHDOG_TIMEOUTS,
      onStdoutLine: () => {
        throw new Error("consumer chokes on the dying flush");
      },
    });
    // Watchdog fired first; the grace-window flush is not delivered.
    expect(result.timedOut).toBe("inactivity");
  });

  it("preserves abort reasons when dying CLI flushes throw", async () => {
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
      cliEnv: SHIM_CLI_ENV,
      env: process.env,
      command: join(dir, "definitely-not-a-real-binary"),
      argv: [],
      stdin: "",
      timeouts: CLEAN_EXIT_TIMEOUTS,
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

  it("rejects final-line consumer failures without a post-close kill ladder", async () => {
    // The child exits cleanly leaving an unterminated line; the consumer
    // throws on the close-time flush. The run must reject with that error,
    // and must NOT signal the (post-close, possibly reused) process group.
    const boom = new Error("final-line consumer failure");
    const promise = runHarnessProcess({
      cliEnv: SHIM_CLI_ENV,
      env: process.env,
      command: process.execPath,
      argv: ["-e", "process.stdout.write('unterminated-final')"],
      stdin: "",
      timeouts: CLEAN_EXIT_TIMEOUTS,
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
      cliEnv: SHIM_CLI_ENV,
      env: process.env,
      command: process.execPath,
      argv: ["-e", "process.stdout.write('unterminated-final')"],
      stdin: "",
      timeouts: CLEAN_EXIT_TIMEOUTS,
      signal: controller.signal,
      onStdoutLine: () => {
        controller.abort(reason);
        throw new Error("and then it threw");
      },
    });
    await expect(promise).rejects.toBe(reason);
  });

  it("propagates a null abort reason untouched", async () => {
    // abort(null) sets signal.reason to null, the caller must get null
    // back, not a synthesized Error, untouched means falsy too.
    const controller = new AbortController();
    const promise = run("hang", { signal: controller.signal });
    setTimeout(() => controller.abort(null), 50);
    await expect(promise).rejects.toBe(null);
  });

  it("kills stdout floods with a classified overflow error", async () => {
    // Steady large chunks keep resetting the inactivity watchdog, the cap
    // must terminate the run long before the hard timer.
    const promise = runHarnessProcess({
      cliEnv: SHIM_CLI_ENV,
      env: process.env,
      command: process.execPath,
      argv: [
        "-e",
        "const b = 'x'.repeat(65536) + '\\n'; setInterval(() => process.stdout.write(b), 5)",
      ],
      stdin: "",
      timeouts: CLEAN_EXIT_TIMEOUTS,
      maxStdoutUnits: 256 * 1024,
    });
    await expect(promise).rejects.toBeInstanceOf(GeneratorError);
    await expect(promise).rejects.toMatchObject({
      kind: GeneratorErrorKinds.OPAQUE,
    });
    await expect(promise).rejects.toThrow(/stdout exceeded/);
  });

  it("keeps the stdout bound during another cause's kill grace", async () => {
    // Silent hang → the inactivity watchdog fires FIRST (owns the outcome);
    // on SIGINT the dying CLI floods stdout through the grace window, the
    // returned partial stdout must still respect the cap.
    const cap = 64 * 1024;
    const result = await runHarnessProcess({
      cliEnv: SHIM_CLI_ENV,
      env: process.env,
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
      GeneratorErrorKinds.CLI_MISSING,
    );
    // Resource exhaustion is not a missing binary, no PATH remediation.
    const emfile = Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" });
    const systemFailure = spawnFailureError("claude", emfile);
    expect(systemFailure.kind).toBe(GeneratorErrorKinds.OPAQUE);
    expect(systemFailure.message).toContain("EMFILE");
    expect(systemFailure.message).not.toContain("not found");
  });

  it("classifies a missing binary as cli-missing", async () => {
    const promise = runHarnessProcess({
      cliEnv: SHIM_CLI_ENV,
      env: process.env,
      command: join(dir, "definitely-not-a-real-binary"),
      argv: [],
      stdin: "",
      timeouts: CLEAN_EXIT_TIMEOUTS,
    });
    await expect(promise).rejects.toBeInstanceOf(GeneratorError);
    await expect(promise).rejects.toMatchObject({
      kind: GeneratorErrorKinds.CLI_MISSING,
    });
  });

  it("captures a bounded stderr head and tail", async () => {
    // Long stderr keeps BOTH ends: the head (failure prefixes live there,
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

/** Vars that outrank a CLI's own login and rebill it to an API or cloud account. */
const BILLING_REDIRECT_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "CURSOR_API_ENDPOINT",
];

/** Secrets a worker legitimately holds that no CLI reading PR text may see. */
const HOST_SECRET_VARS = [
  "DATABASE_URL",
  "GITHUB_APP_PRIVATE_KEY",
  "GH_TOKEN",
  "SESSION_KEY_V1",
  "NOTION_TOKEN",
  "CUSTOM_SECRET",
];

function stubLiveValues(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, `leaked-${name}`]));
}

const EnvEchoSchema = z.object({
  structured_output: z.object({
    leakedVars: z.array(z.string()),
    envNames: z.array(z.string()),
    home: z.string(),
  }),
});

function readEnvEcho(result: HarnessRunResult) {
  const events = result.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line): unknown => JSON.parse(line));
  for (const event of events) {
    const parsed = EnvEchoSchema.safeParse(event);
    if (parsed.success) {
      return parsed.data.structured_output;
    }
  }
  throw new Error("no env-echo envelope in stdout");
}

describe("spawn env: only the allowlist reaches the CLI", () => {
  it("strips every billing redirect var while HOME passes through", async () => {
    const result = await run("env-echo", {
      env: { ...stubLiveValues(BILLING_REDIRECT_VARS), HOME: "/fake/home" },
    });
    expect(result.exitCode).toBe(0);
    const echo = readEnvEcho(result);
    expect(echo.leakedVars).toEqual([]);
    for (const name of BILLING_REDIRECT_VARS) {
      expect(echo.envNames).not.toContain(name);
    }
    expect(echo.home).toBe("/fake/home");
  });

  it("keeps the worker's own secrets out of the CLI env", async () => {
    const result = await run("env-echo", {
      env: stubLiveValues(HOST_SECRET_VARS),
    });
    const echo = readEnvEcho(result);
    for (const name of HOST_SECRET_VARS) {
      expect(echo.envNames).not.toContain(name);
    }
  });

  it("passes locale, proxy and CA vars plus the CLI's own extras", async () => {
    const cliEnv: HarnessCliEnv = {
      passVars: [...SHIM_CLI_ENV.passVars, "FAKE_CLI_LOGIN"],
      fixedVars: { FAKE_CLI_UPDATES_OFF: "1" },
    };
    const shim = { SHIM_SCENARIO: "env-echo" };
    const result = await runHarnessProcess({
      command: process.execPath,
      argv: [FAKE_CLAUDE],
      stdin: "prompt body",
      timeouts: CLEAN_EXIT_TIMEOUTS,
      cliEnv,
      env: {
        ...shim,
        LC_ALL: "en_US.UTF-8",
        HTTPS_PROXY: "http://proxy.internal:3128",
        NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
        FAKE_CLI_LOGIN: "login",
        UNLISTED_VAR: "dropped",
      },
    });
    const echo = readEnvEcho(result);
    expect(echo.envNames).toEqual(
      expect.arrayContaining([
        "LC_ALL",
        "HTTPS_PROXY",
        "NODE_EXTRA_CA_CERTS",
        "FAKE_CLI_LOGIN",
        "FAKE_CLI_UPDATES_OFF",
      ]),
    );
    expect(echo.envNames).not.toContain("UNLISTED_VAR");
  });

  it("sets a request var the CLI lists, never one from the root env", async () => {
    const cliEnv: HarnessCliEnv = {
      ...SHIM_CLI_ENV,
      requestVars: ["FAKE_CLI_CAP"],
    };
    const runWith = (requestEnv?: Record<string, string>) => {
      const args: HarnessRunArgs = {
        command: process.execPath,
        argv: [FAKE_CLAUDE],
        stdin: "prompt body",
        timeouts: CLEAN_EXIT_TIMEOUTS,
        cliEnv,
        env: { SHIM_SCENARIO: "env-echo", FAKE_CLI_CAP: "from-root" },
      };
      if (requestEnv !== undefined) {
        args.requestEnv = requestEnv;
      }
      return runHarnessProcess(args);
    };

    const fromRoot = readEnvEcho(await runWith());
    const fromRequest = readEnvEcho(await runWith({ FAKE_CLI_CAP: "64000" }));

    expect(fromRoot.envNames).not.toContain("FAKE_CLI_CAP");
    expect(fromRequest.envNames).toContain("FAKE_CLI_CAP");
  });

  it("refuses a request var the CLI does not list", async () => {
    const refused = runHarnessProcess({
      command: process.execPath,
      argv: [FAKE_CLAUDE],
      stdin: "prompt body",
      timeouts: CLEAN_EXIT_TIMEOUTS,
      cliEnv: SHIM_CLI_ENV,
      env: { SHIM_SCENARIO: "env-echo" },
      requestEnv: { ANTHROPIC_BASE_URL: "https://elsewhere.example" },
    });

    await expect(refused).rejects.toThrow(/ANTHROPIC_BASE_URL/);
  });

  it("lists no billing redirect or host secret var on any allowlist", () => {
    const allowlists = [
      HARNESS_BASE_ENV_VARS,
      CLAUDE_CLI_ENV.passVars,
      CLAUDE_CLI_ENV.requestVars ?? [],
      CODEX_CLI_ENV.passVars,
      CURSOR_CLI_ENV.passVars,
    ];
    for (const names of allowlists) {
      for (const name of [...BILLING_REDIRECT_VARS, ...HOST_SECRET_VARS]) {
        expect(names).not.toContain(name);
      }
    }
  });

  it("strips probe credentials to match generation authentication", async () => {
    const probe = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
      command: process.execPath,
      versionArgv: [FAKE_CLAUDE, "--version"],
      authArgv: [FAKE_CLAUDE, "auth", "status"],
      authFailureHint: "hint",
      env: {
        ...stubLiveValues(BILLING_REDIRECT_VARS),
        SHIM_SCENARIO: "auth-fail-if-credentials",
      },
    });
    // The shim's auth status FAILS if any credential var reached it, an
    // ok probe proves the strip covers the preflight, not just generation.
    expect(probe.ok).toBe(true);
  });
});

describe("harnessTimeoutError / redactSecrets", () => {
  it("redacts credential-shaped stderr before it reaches the message", () => {
    const result = makeTimedOutResult(
      "auth failed for sk-ant-api03-supersecretvalue Bearer abc.def.ghi last\n",
      "hard",
    );
    const error = harnessTimeoutError("brief", result);
    expect(error.kind).toBe(GeneratorErrorKinds.TIMEOUT);
    expect(error.message).not.toContain("supersecretvalue");
    expect(error.message).not.toContain("abc.def.ghi");
    expect(error.message).toContain("(redacted)");
    expect(error.message).toContain("last");
  });

  it("redacts credential assignments and query parameters", () => {
    const result = makeTimedOutResult(
      "login failed: password=hunter2 token: abc.def AWS_ACCESS_KEY_ID=AKIAXXXX GET /v1?api_key=zzz9 tail\n",
      "hard",
    );
    const error = harnessTimeoutError("brief", result);
    expect(error.message).not.toContain("hunter2");
    expect(error.message).not.toContain("abc.def");
    expect(error.message).not.toContain("AKIAXXXX");
    expect(error.message).not.toContain("zzz9");
    expect(error.message).toContain("tail");
  });

  it("redacts a compound 'token: Bearer x' as a unit", () => {
    const result = makeTimedOutResult(
      "refused: token: Bearer abc.def.ghi rest\n",
      "hard",
    );
    const error = harnessTimeoutError("brief", result);
    expect(error.message).not.toContain("abc.def.ghi");
    expect(error.message).toContain("rest");
  });

  it("redacts Basic and Digest authorization headers and bare JWTs", () => {
    // Header rules take the line remainder (Digest is a param list, not
    // one token), unrelated text goes on its own lines.
    const result = makeTimedOutResult(
      'Authorization: Basic dXNlcjpwYXNz\nProxy-Authorization: Digest username="u", response="abc123"\nthen eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.s1g_9 tail\n',
      "hard",
    );
    const error = harnessTimeoutError("brief", result);
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
    // Quoted values are consumed to the closing quote, password="hunter 2"
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

  it("redacts URL-embedded credentials and hex secrets", () => {
    const result = makeTimedOutResult(
      "dial postgres://svc:hunter2@db.internal:5432/app failed; token deadbeefdeadbeefdeadbeefdeadbeef end\n",
      "inactivity",
    );
    const error = harnessTimeoutError("brief", result);
    expect(error.message).not.toContain("hunter2");
    expect(error.message).not.toContain("deadbeefdeadbeef");
    expect(error.message).toContain("postgres://(redacted)@db.internal");
    expect(error.message).toContain("end");
  });
});

describe("probeHarnessCli", () => {
  const probeArgs = {
    env: process.env,
    command: process.execPath,
    versionArgv: [FAKE_CLAUDE, "--version"],
    authArgv: [FAKE_CLAUDE, "auth", "status"],
    authFailureHint: "log the CLI in interactively first",
  };

  it("runs both probes in one empty temp cwd, removed afterwards", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "harness-probe-log-"));
    const cwdLog = join(logDir, "cwd.log");
    try {
      const result = await probeHarnessCli({
        cliEnv: SHIM_CLI_ENV,
        ...probeArgs,
        env: { SHIM_SCENARIO: "valid", SHIM_CWD_LOG: cwdLog },
      });
      expect(result.ok).toBe(true);

      const records = expectEmptyRemovedCwds(cwdLog, "harness-probe-");
      expect(records.map((record) => record.argv)).toEqual([
        ["--version"],
        ["auth", "status"],
      ]);
      expect(records[0]?.cwd).toBe(records[1]?.cwd);
    } finally {
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it("fails with a cli-missing issue when the binary is absent", async () => {
    const result = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      command: "/nonexistent/claude-binary",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain("not found");
  });

  it("fails with the auth hint when the auth preflight exits nonzero", async () => {
    const result = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      env: { SHIM_SCENARIO: "auth-error" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain(
      "log the CLI in interactively first",
    );
  });

  it("marks signalled auth preflights incomplete rather than unauthenticated", async () => {
    // Externally killed preflight: exitCode null, no auth verdict produced.
    const result = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      authArgv: ["-e", 'process.kill(process.pid, "SIGTERM")'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("terminated by signal");
    expect(text).not.toContain("not authenticated");
  });

  it("reports a hung auth preflight as a timeout, not as not-authenticated", async () => {
    const result = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      env: { SHIM_SCENARIO: "auth-hang" },
      timeoutMs: 400,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("timed out");
    expect(text).not.toContain("not authenticated");
  });

  it("surfaces interpreter warnings through log and still passes", async () => {
    const warnings: string[] = [];
    const seen: { version?: string; auth?: string } = {};
    const result = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      log: (message) => warnings.push(message),
      interpretVersionOutput: (stdout) => {
        seen.version = stdout;
        return { ok: true, value: "warning: version below the verified floor" };
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
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      log: (message) => warnings.push(message),
      interpretVersionOutput: () => ({ ok: true, value: null }),
      interpretAuthOutput: () => ({ ok: true, value: null }),
    });
    expect(result.ok).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("refuses boot when the version interpreter refuses", async () => {
    let authRan = false;
    const result = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      interpretVersionOutput: () =>
        configError(["claude 2.0.0 is older than 2.1.307"]),
      interpretAuthOutput: () => {
        authRan = true;
        return { ok: true, value: null };
      },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.issues.join(";")).toContain("older");
    expect(authRan).toBe(false);
  });

  it("refuses boot when the auth interpreter rejects the route", async () => {
    const result = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      interpretAuthOutput: () => configError(["billing route is an API key"]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toEqual(["billing route is an API key"]);
  });

  it("redacts interpreter strings before they reach logs or errors", async () => {
    // Interpreters may embed untrusted CLI stdout; the startup-check boundary redacts
    // both channels regardless of adapter discipline.
    const warnings: string[] = [];
    const warned = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      log: (message) => warnings.push(message),
      interpretVersionOutput: () => ({
        ok: true,
        value: "warning: odd version sk-ant-api03-supersecretvalue reported",
      }),
    });
    expect(warned.ok).toBe(true);
    expect(warnings.join("; ")).not.toContain("supersecretvalue");
    expect(warnings.join("; ")).toContain("odd version");

    const refused = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      env: { SHIM_SCENARIO: "valid" },
      interpretAuthOutput: () =>
        configError(["route uses Bearer abc.def.ghi credentials"]),
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) {
      return;
    }
    const text = refused.error.issues.join("; ");
    expect(text).not.toContain("abc.def.ghi");
    expect(text).toContain("route uses");
  });

  it("never invokes interpreters when their probe step failed", async () => {
    // Nonzero auth exit keeps the generic not-authenticated verdict; the
    // route interpreter must not run against a failed preflight's output.
    let called = 0;
    const result = await probeHarnessCli({
      cliEnv: SHIM_CLI_ENV,
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
      cliEnv: SHIM_CLI_ENV,
      ...probeArgs,
      env: { SHIM_SCENARIO: "version-broken" },
      interpretVersionOutput: () => {
        versionCalled++;
        return { ok: true, value: null };
      },
    });
    expect(broken.ok).toBe(false);
    expect(versionCalled).toBe(0);
  });
});
