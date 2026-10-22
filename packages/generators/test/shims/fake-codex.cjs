#!/usr/bin/env node
/**
 * Fake `codex` binary for harness tests. Scenario via SHIM_SCENARIO; the
 * structured payload via SHIM_OUTPUT (a JSON string); SIGINT recording via
 * SHIM_MARKER_FILE.
 *
 * Emits envelope-accurate `codex exec --json` JSONL: thread/turn/item events, the
 * answer as the LAST `item.completed` `agent_message` whose `item.text` is
 * a JSON STRING (the double-parse quirk). No model id anywhere in JSONL:
 * the verified origin blind spot.
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

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function preamble() {
  emit({ type: "thread.started", thread_id: "shim-thread" });
  emit({ type: "turn.started" });
}

function answer(text) {
  emit({
    type: "item.completed",
    item: { id: "item_1", type: "agent_message", text },
  });
  emit({
    type: "turn.completed",
    usage: {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 20,
      reasoning_output_tokens: 5,
    },
  });
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

// Startup-check surface: `--version`; `login status` as the auth-probe boundary
// (real-CLI equivalent probed at adapter implementation, PR 6).
const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  if (scenario === "version-broken") {
    process.exit(1);
  }
  process.stdout.write("codex-cli 0.144.1\n");
  process.exit(0);
}
if (argv[0] === "login" && argv[1] === "status") {
  if (scenario === "auth-error") {
    process.stderr.write("Not logged in\n");
    process.exit(1);
  }
  process.stdout.write("Logged in using ChatGPT\n");
  process.exit(0);
}

// `--output-schema <file>` handoff: record what the adapter passed so tests
// can assert the tempfile contents (PR 6).
const schemaFlag = argv.indexOf("--output-schema");
if (schemaFlag !== -1 && process.env.SHIM_SCHEMA_COPY) {
  try {
    writeFileSync(
      process.env.SHIM_SCHEMA_COPY,
      readFileSync(argv[schemaFlag + 1]),
    );
  } catch {
    // Absent/unreadable schema file: leave no copy; the test will fail loudly.
  }
}

if (process.env.SHIM_MARKER_FILE) {
  process.on("SIGINT", () => {
    appendFileSync(process.env.SHIM_MARKER_FILE, "SIGINT\n");
    if (scenario !== "ignores-sigint") {
      process.exit(1);
    }
  });
}

// Scripted mode (adapter contract tests), mirroring fake-claude: turns.json
// in SHIM_SCRIPT_DIR, counter-selected per invocation, argv/stdin/schema
// recordings. Turn shapes: {output} (answer as JSON string), {hang:true},
// {turnFailed:"msg"}, {fatal:"msg"}.
if (scenario === "scripted") {
  const dir = process.env.SHIM_SCRIPT_DIR;
  if (!dir) {
    process.stderr.write("fake-codex: scripted needs SHIM_SCRIPT_DIR\n");
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
  // Capture the --output-schema tempfile contents before the parent
  // cleans it up.
  const scriptedSchemaFlag = argv.indexOf("--output-schema");
  if (scriptedSchemaFlag !== -1 && existsSync(argv[scriptedSchemaFlag + 1])) {
    const schemaPath = argv[scriptedSchemaFlag + 1];
    writeFileSync(join(dir, `schema-${turn}.json`), readFileSync(schemaPath));
    // Path + mode so tests can assert 0600 while running and removal after.
    const { statSync } = require("node:fs");
    writeFileSync(
      join(dir, `schema-meta-${turn}.json`),
      JSON.stringify({
        path: schemaPath,
        mode: statSync(schemaPath).mode & 0o777,
      }),
    );
  }
  drainStdinThen((stdin) => {
    writeFileSync(join(dir, `stdin-${turn}.txt`), stdin);
    if (script.hang) {
      stayAlive();
      return;
    }
    if (script.turnFailed) {
      preamble();
      emit({ type: "turn.failed", error: { message: script.turnFailed } });
      process.exit(1);
    }
    if (script.fatal) {
      emit({ type: "error", message: script.fatal });
      process.exit(1);
    }
    if (script.fatalBeforeAnswerExitZero) {
      // Drifted-CLI arm: fatal event AND an answer AND exit 0; the real
      // CLI sets error_seen and exits 1; an adapter must void the answer.
      preamble();
      emit({ type: "turn.failed", error: { message: "half-broken" } });
      answer(script.output);
      process.exit(0);
    }
    preamble();
    // Preliminary narration first: consumers must take the LAST message.
    emit({
      type: "item.completed",
      item: { id: "item_0", type: "agent_message", text: "Working on it." },
    });
    answer(script.output);
    if (script.trailingNonString) {
      // Envelope-drift arm: a completed agent_message whose text is not a
      // string arrives AFTER the real answer.
      emit({
        type: "item.completed",
        item: { id: "item_2", type: "agent_message", text: { weird: true } },
      });
      emit({ type: "turn.completed", usage: {} });
    }
    process.exit(0);
  });
  return;
}

switch (scenario) {
  case "valid":
    drainStdinThen(() => {
      preamble();
      // A preliminary narration message first: consumers must select the
      // LAST completed agent_message, not the first.
      emit({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: "Let me work on that.",
        },
      });
      // The double-parse quirk: item.text is a JSON *string* of the payload.
      answer(output);
      process.exit(0);
    });
    break;
  case "env-echo":
    // Spawn-env boundary: reports every var name that reached the child.
    drainStdinThen(() => {
      preamble();
      answer(JSON.stringify({ envNames: Object.keys(process.env).toSorted() }));
      process.exit(0);
    });
    break;
  case "invalid-json":
    drainStdinThen(() => {
      preamble();
      answer(output); // caller sets SHIM_OUTPUT to schema-invalid JSON
      process.exit(0);
    });
    break;
  case "not-json-answer":
    drainStdinThen(() => {
      preamble();
      answer("I could not produce JSON, sorry.");
      process.exit(0);
    });
    break;
  case "hang":
    stayAlive();
    break;
  case "ignores-sigint":
    stayAlive();
    break;
  case "turn-failed":
    drainStdinThen(() => {
      preamble();
      emit({
        type: "turn.failed",
        error: { message: "stream error: rate limited" },
      });
      process.exit(1);
    });
    break;
  case "fatal-error":
    drainStdinThen(() => {
      emit({
        type: "error",
        message: process.env.SHIM_ERROR ?? "something broke",
      });
      process.exit(1);
    });
    break;
  case "envelope-drift":
    drainStdinThen(() => {
      emit({
        type: "item.completed",
        item: { type: "reasoning", text: "hmm" },
      });
      emit({ type: "turn.completed", usage: {} });
      process.exit(0);
    });
    break;
  case "stderr-exit":
    drainStdinThen(() => {
      process.stderr.write(
        process.env.SHIM_STDERR ?? "codex shim exploded\n",
        () => process.exit(Number(process.env.SHIM_EXIT_CODE ?? 1)),
      );
    });
    break;
  default:
    process.stderr.write(`fake-codex: unknown scenario ${scenario}\n`);
    process.exit(64);
}
