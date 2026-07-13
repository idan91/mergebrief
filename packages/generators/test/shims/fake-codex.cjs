#!/usr/bin/env node
/**
 * Fake `codex` binary for harness tests. Scenario via SHIM_SCENARIO; the
 * structured payload via SHIM_OUTPUT (a JSON string); SIGINT recording via
 * SHIM_MARKER_FILE.
 *
 * Emits envelope-accurate `codex exec --json` JSONL (see
 * docs/dev/harness-cli-capabilities.md §2): thread/turn/item events, the
 * answer as the LAST `item.completed` `agent_message` whose `item.text` is
 * a JSON STRING (the double-parse quirk). No model id anywhere in JSONL —
 * the verified provenance blind spot.
 */
const { appendFileSync, writeFileSync } = require("node:fs");

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

// Boot-probe surface: `--version`; `login status` as the auth probe seam
// (real-CLI equivalent probed at adapter implementation, PR 6).
const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  if (scenario === "version-broken") process.exit(1);
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
  const schemaPath = argv[schemaFlag + 1];
  try {
    const { readFileSync } = require("node:fs");
    writeFileSync(process.env.SHIM_SCHEMA_COPY, readFileSync(schemaPath));
  } catch {
    // Absent/unreadable schema file: leave no copy; the test will fail loudly.
  }
}

if (process.env.SHIM_MARKER_FILE) {
  process.on("SIGINT", () => {
    appendFileSync(process.env.SHIM_MARKER_FILE, "SIGINT\n");
    if (scenario !== "ignores-sigint") process.exit(1);
  });
}

switch (scenario) {
  case "valid":
    drainStdinThen(() => {
      preamble();
      // A preliminary narration message first: consumers must select the
      // LAST completed agent_message, not the first.
      emit({
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: "Let me work on that." },
      });
      // The double-parse quirk: item.text is a JSON *string* of the payload.
      answer(output);
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
      emit({ type: "turn.failed", error: { message: "stream error: rate limited" } });
      process.exit(1);
    });
    break;
  case "fatal-error":
    drainStdinThen(() => {
      emit({ type: "error", message: process.env.SHIM_ERROR ?? "something broke" });
      process.exit(1);
    });
    break;
  case "envelope-drift":
    drainStdinThen(() => {
      emit({ type: "item.completed", item: { type: "reasoning", text: "hmm" } });
      emit({ type: "turn.completed", usage: {} });
      process.exit(0);
    });
    break;
  case "stderr-exit":
    drainStdinThen(() => {
      process.stderr.write(process.env.SHIM_STDERR ?? "codex shim exploded\n", () =>
        process.exit(Number(process.env.SHIM_EXIT_CODE ?? 1)),
      );
    });
    break;
  default:
    process.stderr.write(`fake-codex: unknown scenario ${scenario}\n`);
    process.exit(64);
}
