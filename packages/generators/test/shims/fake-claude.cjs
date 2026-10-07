#!/usr/bin/env node
/**
 * Fake `claude` binary for harness tests (BRIEF-11 testing strategy: fake
 * the BINARY, not the spawn). Scenario via SHIM_SCENARIO; the structured
 * payload via SHIM_OUTPUT (a JSON string); SIGINT recording via
 * SHIM_MARKER_FILE; drip pacing via SHIM_DRIP_MS / SHIM_DRIP_COUNT.
 *
 * Emits envelope-accurate `--output-format stream-json` NDJSON (see
 * docs/dev/harness-cli-capabilities.md §1): a `system`/`init` event, then a
 * terminal `result` envelope with `structured_output` / `result` /
 * `subtype` / `modelUsage`.
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
  appendFileSync(process.env.SHIM_CWD_LOG, `${JSON.stringify(record)}\n`);
}

const scenario = process.env.SHIM_SCENARIO ?? "valid";
const output = process.env.SHIM_OUTPUT ?? '{"ok":true}';
const model = process.env.SHIM_MODEL ?? "claude-opus-4-8";
const servedModel = process.env.SHIM_SERVED_MODEL ?? model;

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function init() {
  emit({ type: "system", subtype: "init", session_id: "shim-session", model });
}

function resultEnvelope(overrides) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 10,
    duration_api_ms: 8,
    num_turns: 1,
    session_id: "shim-session",
    total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 20 },
    modelUsage: {
      [servedModel]: { inputTokens: 10, outputTokens: 20, costUSD: 0.01 },
    },
    result: output,
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

// Boot-probe surface: `--version` and `auth status` (capabilities note §1).
const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  if (scenario === "version-broken") process.exit(1);
  // Default = the billing-attribution floor (BRIEF-150); SHIM_VERSION
  // overrides for the old-version warning cases.
  process.stdout.write(
    `${process.env.SHIM_VERSION ?? "2.1.226"} (Claude Code)\n`,
  );
  process.exit(0);
}
if (argv[0] === "auth" && argv[1] === "status") {
  if (scenario === "auth-error") {
    process.stderr.write("Not logged in · run /login\n");
    process.exit(1);
  }
  if (scenario === "auth-fail-if-credentials") {
    // Billing-route pin for the PROBE path: authenticated only when no
    // credential var leaked through the spawn boundary.
    const leaked = Object.keys(process.env).filter((name) =>
      /API_KEY|AUTH_TOKEN|ACCESS_TOKEN|USE_BEDROCK|USE_VERTEX|BASE_URL/.test(
        name,
      ),
    );
    if (leaked.length > 0) {
      process.stderr.write(`credential vars leaked: ${leaked.join(",")}\n`);
      process.exit(1);
    }
    process.stdout.write(`${authStatusJson()}\n`);
    process.exit(0);
  }
  if (scenario === "auth-hang") {
    // Authenticated-but-hung CLI: stay alive silently; never reach the
    // generation scenario switch (CJS top-level return).
    setInterval(() => {}, 60_000);
    return;
  }
  process.stdout.write(`${authStatusJson()}\n`);
  process.exit(0);
}

// `auth status` defaults to --json (BRIEF-150 route table); SHIM_AUTH_STATUS
// overrides the whole body for route/drift scenarios.
function authStatusJson() {
  return (
    process.env.SHIM_AUTH_STATUS ??
    JSON.stringify({
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      email: "shim@example.com",
      subscriptionType: "max",
    })
  );
}

if (process.env.SHIM_MARKER_FILE) {
  process.on("SIGINT", () => {
    appendFileSync(process.env.SHIM_MARKER_FILE, "SIGINT\n");
    if (scenario !== "ignores-sigint") process.exit(130);
    // ignores-sigint: recorded, deliberately keep running until SIGKILL.
  });
}

// Scripted mode (adapter contract tests): SHIM_SCRIPT_DIR holds turns.json
// (array of {output} / {hang:true}), a counter file selecting the turn per
// invocation, and receives argv-N.json / stdin-N.txt recordings.
if (scenario === "scripted") {
  const dir = process.env.SHIM_SCRIPT_DIR;
  if (!dir) {
    process.stderr.write("fake-claude: scripted needs SHIM_SCRIPT_DIR\n");
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
  // Capture the system prompt while its temp file still exists (the parent
  // cleans it up after the run) so tests can assert its contents.
  const systemFlag = argv.indexOf("--system-prompt-file");
  if (systemFlag !== -1 && existsSync(argv[systemFlag + 1])) {
    writeFileSync(
      join(dir, `system-${turn}.txt`),
      readFileSync(argv[systemFlag + 1], "utf8"),
    );
  }
  drainStdinThen((stdin) => {
    writeFileSync(join(dir, `stdin-${turn}.txt`), stdin);
    if (script.hang) {
      stayAlive();
      return;
    }
    init();
    if (script.apiRetryCategory) {
      // In-band retry category then death without a result envelope
      // (classification tests, incl. hostile category names).
      emit({
        type: "system",
        subtype: "api_retry",
        error: script.apiRetryCategory,
      });
      process.exit(1);
    }
    if (script.emptySuccess) {
      // Drifted non-error envelope: no output, no structured_output key
      // (the base envelope only carries structured_output via overrides).
      emit(
        resultEnvelope({ subtype: script.subtype ?? "success", result: "" }),
      );
      process.exit(0);
    }
    if (script.errorSubtype) {
      // Drifted/unknown error subtype arm (error-hygiene tests).
      emit(
        resultEnvelope({
          subtype: script.errorSubtype,
          is_error: true,
          result: script.output,
        }),
      );
      process.exit(0);
    }
    let parsed;
    try {
      parsed = JSON.parse(script.output);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || script.forceExhausted) {
      // Mimic the real CLI: an answer its schema validation never accepted
      // arrives as error_max_structured_output_retries with the raw text.
      emit(
        resultEnvelope({
          subtype: "error_max_structured_output_retries",
          is_error: true,
          result: script.output,
          errors: [{ type: "structured_output_validation" }],
        }),
      );
    } else {
      const envelope = resultEnvelope({
        result: script.output,
        structured_output: parsed,
      });
      // Envelope-drift arm: an older/newer CLI without modelUsage.
      if (script.noModelUsage) delete envelope.modelUsage;
      // Hostile-key arm: modelUsage keys straight from the script.
      if (script.servedModels) {
        envelope.modelUsage = Object.fromEntries(
          script.servedModels.map((id) => [id, { inputTokens: 1 }]),
        );
      }
      emit(envelope);
    }
    process.exit(0);
  });
  return;
}

switch (scenario) {
  case "valid":
    drainStdinThen(() => {
      init();
      emit(resultEnvelope({ structured_output: JSON.parse(output) }));
      process.exit(0);
    });
    break;
  case "env-echo":
    // Billing-route guarantee: reports every credential-shaped var that
    // reached the child, so the harness's spawn-env strip is directly
    // observable and the assertion can derive from the exported strip list
    // (no hardcoded-name drift).
    drainStdinThen(() => {
      init();
      emit(
        resultEnvelope({
          structured_output: {
            leakedVars: Object.keys(process.env)
              .filter((name) =>
                /API_KEY|AUTH_TOKEN|ACCESS_TOKEN|USE_BEDROCK|USE_VERTEX|BASE_URL/.test(
                  name,
                ),
              )
              .toSorted(),
            home: process.env.HOME ?? "ABSENT",
          },
        }),
      );
      process.exit(0);
    });
    break;
  case "invalid-json":
    // Schema-invalid answer: no structured_output, raw text in `result`.
    drainStdinThen(() => {
      init();
      emit(
        resultEnvelope({
          subtype: "error_max_structured_output_retries",
          is_error: true,
          errors: [{ type: "structured_output_validation" }],
        }),
      );
      process.exit(0);
    });
    break;
  case "echo-stdin":
    drainStdinThen((stdin) => {
      init();
      emit(resultEnvelope({ result: stdin, structured_output: null }));
      process.exit(0);
    });
    break;
  case "hang":
    // No output, never exits: the inactivity watchdog's case.
    stayAlive();
    break;
  case "spawn-grandchild": {
    // Fork a SIGINT-IGNORING grandchild and (as a cooperative parent) die on
    // SIGINT ourselves: proves the ladder both signals the process GROUP and
    // completes the SIGKILL escalation even after the direct child closed.
    const { spawn } = require("node:child_process");
    const grandchild = spawn(
      process.execPath,
      ["-e", "process.on('SIGINT', () => {}); setInterval(() => {}, 60000)"],
      { stdio: "ignore" },
    );
    writeFileSync(process.env.SHIM_GRANDCHILD_PID_FILE, String(grandchild.pid));
    stayAlive();
    break;
  }
  case "split-multibyte":
    drainStdinThen(() => {
      // One UTF-8 char split across two writes with a scheduling gap: the
      // harness must decode it whole, never as replacement junk.
      const bytes = Buffer.from('{"type":"result","result":"héllo"}\n', "utf8");
      const cut = bytes.indexOf(0xc3); // first byte of "é"
      process.stdout.write(bytes.subarray(0, cut + 1));
      setTimeout(() => {
        process.stdout.write(bytes.subarray(cut + 1), () => process.exit(0));
      }, 30);
    });
    break;
  case "ignores-sigint":
    stayAlive();
    break;
  case "flush-on-sigint":
    // Silent hang; on SIGINT flush malformed output then exit, the
    // grace-window flush a dying CLI produces.
    process.on("SIGINT", () => {
      process.stdout.write("MALFORMED-DYING-FLUSH\n", () => process.exit(130));
    });
    stayAlive();
    break;
  case "slow-drip": {
    // Steady partial events (watchdog keeps resetting)…
    init();
    const dripMs = Number(process.env.SHIM_DRIP_MS ?? 50);
    const count = Number(process.env.SHIM_DRIP_COUNT ?? 10);
    let sent = 0;
    const timer = setInterval(() => {
      emit({ type: "stream_event", event: { type: "content_block_delta" } });
      sent++;
      if (sent >= count) {
        clearInterval(timer);
        if (process.env.SHIM_DRIP_THEN === "exit") {
          emit(resultEnvelope({ structured_output: JSON.parse(output) }));
          process.exit(0);
        }
        stayAlive(); // …then stall with no further output.
      }
    }, dripMs);
    break;
  }
  case "api-retry-auth":
    drainStdinThen(() => {
      init();
      emit({
        type: "system",
        subtype: "api_retry",
        error: "authentication_failed",
      });
      process.stderr.write("authentication_failed\n");
      process.exit(1);
    });
    break;
  case "envelope-drift":
    drainStdinThen(() => {
      emit({ type: "totally-new-envelope", payload: "surprise" });
      process.exit(0);
    });
    break;
  case "stderr-exit":
    drainStdinThen(() => {
      process.stderr.write(process.env.SHIM_STDERR ?? "shim exploded\n", () =>
        process.exit(Number(process.env.SHIM_EXIT_CODE ?? 1)),
      );
    });
    break;
  default:
    process.stderr.write(`fake-claude: unknown scenario ${scenario}\n`);
    process.exit(64);
}
