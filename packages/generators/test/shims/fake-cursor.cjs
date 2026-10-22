#!/usr/bin/env node
/**
 * Fake `cursor-agent` binary for harness tests (fake the BINARY, not the
 * spawn). Scenario via SHIM_SCENARIO; the answer payload via SHIM_OUTPUT.
 *
 * Emits envelope-accurate `--output-format stream-json` NDJSON with the
 * CLI's verified quirk:
 * NOTHING reaches the pipe until process exit: events are buffered and
 * flushed in one write at termination.
 */
const {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const { join } = require("node:path");

// One JSON line per invocation: the spawn cwd and what it held at startup.
if (process.env.SHIM_CWD_LOG) {
  const record = {
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    entries: readdirSync(process.cwd()),
  };
  if (existsSync(".cursor/cli.json")) {
    record.cursorConfig = readFileSync(".cursor/cli.json", "utf8");
  }
  appendFileSync(process.env.SHIM_CWD_LOG, `${JSON.stringify(record)}\n`);
}

const scenario = process.env.SHIM_SCENARIO ?? "valid";
const output = process.env.SHIM_OUTPUT ?? '{"ok":true}';

// Pipe-silence realism: buffer, then flush everything at exit.
const buffered = [];
function emit(event) {
  buffered.push(`${JSON.stringify(event)}\n`);
}
function flushAndExit(code) {
  process.stdout.write(buffered.join(""), () => process.exit(code));
}

function init() {
  emit({
    type: "system",
    subtype: "init",
    apiKeySource: process.env.SHIM_API_KEY_SOURCE ?? "login",
    model: process.env.SHIM_MODEL_DISPLAY ?? "GPT-5.2 Medium",
    permissionMode: process.env.SHIM_PERMISSION_MODE ?? "plan",
    cwd: process.cwd(),
    session_id: "shim-session",
  });
}

function resultEnvelope(overrides) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 12000,
    duration_api_ms: 4000,
    result: output,
    session_id: "shim-session",
    request_id: "shim-request",
    usage: {
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
    },
    ...overrides,
  };
}

function stayAlive() {
  setInterval(() => {}, 60_000);
}

function drainStdinThen(fn) {
  let stdin = "";
  process.stdin.on("data", (chunk) => {
    stdin += chunk;
  });
  process.stdin.on("end", () => fn(stdin));
}

// Boot-probe surface: `--version` and `about --format json` (§3: `about`
// exits 0 in BOTH auth states; the verdict lives in its JSON body).
const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  if (scenario === "version-broken") {
    process.exit(1);
  }
  process.stdout.write(`${process.env.SHIM_VERSION ?? "2026.10.19-3e8eec8"}\n`);
  process.exit(0);
}
if (argv[0] === "about") {
  if (scenario === "auth-hang") {
    stayAlive();
    return;
  }
  if (scenario === "auth-fail-if-credentials") {
    // Billing-route pin for the PROBE path: CURSOR_API_KEY deliberately
    // SURVIVES the spawn strip (it is the subscription route); everything
    // else credential-shaped must have been stripped.
    const leaked = Object.keys(process.env).filter(
      (name) =>
        name !== "CURSOR_API_KEY" &&
        /API_KEY|AUTH_TOKEN|ACCESS_TOKEN|USE_BEDROCK|USE_VERTEX|BASE_URL|API_ENDPOINT/.test(
          name,
        ),
    );
    if (leaked.length > 0) {
      process.stderr.write(`credential vars leaked: ${leaked.join(",")}\n`);
      process.exit(1);
    }
  }
  process.stdout.write(`${aboutJson()}\n`);
  process.exit(0);
}

function aboutJson() {
  if (process.env.SHIM_ABOUT) {
    return process.env.SHIM_ABOUT;
  }
  const identity =
    scenario === "auth-logged-out"
      ? { userEmail: null, subscriptionTier: null }
      : { userEmail: "shim@example.com", subscriptionTier: "pro" };
  return JSON.stringify({
    cliVersion: process.env.SHIM_VERSION ?? "2026.10.19-3e8eec8",
    model: "auto",
    ...identity,
  });
}

// Scripted mode (adapter + contract tests): SHIM_SCRIPT_DIR holds turns.json
// (array of per-invocation scripts), a counter file selecting the turn, and
// receives argv-N.json / stdin-N.txt recordings.
if (scenario === "scripted") {
  const dir = process.env.SHIM_SCRIPT_DIR;
  if (!dir) {
    process.stderr.write("fake-cursor: scripted needs SHIM_SCRIPT_DIR\n");
    process.exit(64);
  }
  const counterFile = join(dir, "counter");
  const turn = existsSync(counterFile)
    ? Number(readFileSync(counterFile, "utf8"))
    : 0;
  writeFileSync(counterFile, String(turn + 1));
  const turns = JSON.parse(readFileSync(join(dir, "turns.json"), "utf8"));
  const script = turns[turn] ?? turns[turns.length - 1];
  writeFileSync(join(dir, `argv-${turn}.json`), JSON.stringify(argv));
  drainStdinThen((stdin) => {
    writeFileSync(join(dir, `stdin-${turn}.txt`), stdin);
    if (script.hang) {
      stayAlive();
      return;
    }
    if (script.stderr !== undefined) {
      // Real-CLI failure shape: exit 1 + stderr prefix, NO result envelope.
      process.stderr.write(`${script.stderr}\n`, () =>
        process.exit(script.exitCode ?? 1),
      );
      return;
    }
    if (script.noEnvelope) {
      init();
      flushAndExit(script.exitCode ?? 0);
      return;
    }
    init();
    if (script.isError) {
      emit(
        resultEnvelope({
          subtype: script.subtype ?? "error",
          is_error: true,
          result: script.output ?? "",
        }),
      );
      flushAndExit(script.exitCode ?? 0);
      return;
    }
    emit(resultEnvelope({ result: script.output ?? output }));
    flushAndExit(0);
  });
  return;
}

switch (scenario) {
  case "valid":
    drainStdinThen(() => {
      init();
      emit(resultEnvelope({}));
      flushAndExit(0);
    });
    break;
  case "env-echo":
    // Billing-route guarantee, generation path: reports every
    // credential-shaped var that reached the child (CURSOR_API_KEY is the
    // deliberate survivor and is reported so the test can assert BOTH ways).
    drainStdinThen(() => {
      init();
      emit(
        resultEnvelope({
          result: JSON.stringify({
            leakedVars: Object.keys(process.env)
              .filter((name) =>
                /API_KEY|AUTH_TOKEN|ACCESS_TOKEN|USE_BEDROCK|USE_VERTEX|BASE_URL|API_ENDPOINT/.test(
                  name,
                ),
              )
              .toSorted(),
            envNames: Object.keys(process.env).toSorted(),
            cwd: process.cwd(),
          }),
        }),
      );
      flushAndExit(0);
    });
    break;
  case "stderr-auth":
    drainStdinThen(() => {
      process.stderr.write(
        "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.\n",
        () => process.exit(1),
      );
    });
    break;
  case "stderr-bad-model":
    drainStdinThen(() => {
      process.stderr.write(
        "Cannot use this model: shim-model. Available models: ...\n",
        () => process.exit(1),
      );
    });
    break;
  case "stderr-unknown-option":
    drainStdinThen(() => {
      process.stderr.write("error: unknown option '--mode'\n", () =>
        process.exit(1),
      );
    });
    break;
  case "stderr-exit":
    drainStdinThen(() => {
      process.stderr.write(process.env.SHIM_STDERR ?? "shim exploded\n", () =>
        process.exit(Number(process.env.SHIM_EXIT_CODE ?? 1)),
      );
    });
    break;
  case "hang":
    // TRUE pipe-silence: no output, never exits; only wall-clock saves us.
    drainStdinThen(() => {
      stayAlive();
    });
    break;
  case "envelope-drift":
    drainStdinThen(() => {
      emit({ type: "totally-new-envelope", payload: "surprise" });
      flushAndExit(0);
    });
    break;
  default:
    process.stderr.write(`fake-cursor: unknown scenario ${scenario}\n`);
    process.exit(64);
}
