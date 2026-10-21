# Harness CLI capabilities (claude / codex / cursor-agent / opencode)

**Date:** 2026-07-12; §3 (cursor-agent) execution-verified 2026-08-27.
**Purpose:** feeds the Harness CLI adapter design ticket on the generator-adapters wayfinder map.

**Sources (all primary; fetched 2026-07-12 unless noted):**

- `claude --help` / `claude --version` run locally — Claude Code v2.1.207
- Claude Code headless docs: <https://code.claude.com/docs/en/headless>
- Claude Code CLI reference: <https://code.claude.com/docs/en/cli-reference>
- Claude Code authentication docs: <https://code.claude.com/docs/en/authentication>
- Agent SDK structured outputs: <https://code.claude.com/docs/en/agent-sdk/structured-outputs>
- Agent SDK TypeScript reference (SDKResultMessage): <https://code.claude.com/docs/en/agent-sdk/typescript>
- `codex --help` / `codex exec --help` run locally — codex-cli 0.142.5
- Codex non-interactive docs: <https://developers.openai.com/codex/noninteractive> (308-redirects to <https://learn.chatgpt.com/docs/non-interactive-mode>)
- Codex auth docs: <https://developers.openai.com/codex/auth> (redirects to <https://learn.chatgpt.com/docs/auth>)
- Codex source (main branch): `codex-rs/exec/src/exec_events.rs`, `codex-rs/exec/src/lib.rs`, `codex-rs/exec/src/event_processor_with_human_output.rs`, `codex-rs/exec/src/event_processor_with_jsonl_output.rs` — <https://github.com/openai/codex>
- Cursor CLI docs: <https://cursor.com/docs/cli/reference/parameters>, <https://cursor.com/docs/cli/headless>, <https://cursor.com/docs/cli/reference/output-format>, <https://cursor.com/docs/cli/reference/authentication>; authenticated execution runs on `cursor-agent 2026.08.25-3e8eec8` + `@cursor/sdk` smokes, darwin/arm64 (2026-08-27)
- OpenCode docs: <https://opencode.ai/docs/cli/>; source (dev branch): `packages/opencode/src/cli/cmd/run.ts` — <https://github.com/sst/opencode> (NOT installed locally)
- Project memory: `~/.claude/projects/-Users-idan-Projects-Code-code-review/memory/brief-14-27-28-implementation-2026-07.md` (codex hang observation)

---

## 1. `claude -p` (Claude Code headless mode) — v1 target

Local version verified: **2.1.207** (`claude --version`).

### Headless invocation

- `claude -p "prompt"` (or `--print`) — print response and exit. All CLI options work with `-p`. (headless docs; `claude --help`)
- **stdin:** piped stdin is read as input (`cat build-error.txt | claude -p 'explain...'`). Piped stdin capped at **10MB** since v2.1.128; exceeding it exits non-zero with a clear error. (headless docs)
- **TTY:** explicitly designed for pipes; the workspace-trust dialog is skipped when run via `-p` or when stdout is not a TTY. Settings files that fail validation are *silently ignored* in this mode. (`claude --help`, `-p` description)
- **Permissions:** `--allowedTools "..."` (permission-rule syntax), `--permission-mode` (`acceptEdits`, `dontAsk`, `bypassPermissions`, ...), or `--dangerously-skip-permissions` (≡ `bypassPermissions`). In `dontAsk`/locked-down CI mode, a disallowed tool attempt **aborts the run** rather than prompting. (headless docs, CLI reference)
- **Adapter-relevant extras:** `--bare` — skips hooks/plugins/MCP/CLAUDE.md auto-discovery, recommended for scripted calls, "will become the default for `-p` in a future release"; note `--bare` reads auth *only* from `ANTHROPIC_API_KEY` or `apiKeyHelper` (no OAuth/keychain). `--tools ""` disables all built-in tools (useful for a pure-generation call). `--max-budget-usd <amount>` caps spend per invocation (print mode only). (headless docs; `claude --help`)

### Structured output

- `--output-format json` → single JSON envelope; `stream-json` → NDJSON events. (headless docs)
- **Native schema enforcement:** yes — `--json-schema '<schema>'` (print mode only). The SDK/CLI validates the model's final answer against the schema and **re-prompts on mismatch**; if validation doesn't succeed within the retry limit the result is an error (`subtype: "error_max_structured_output_retries"`), not junk output. So it's enforce-with-internal-retry, not decode-time grammar constraint — but the contract to the caller is: `structured_output` is schema-valid or absent. (structured-outputs docs)
- **Field paths:** plain text answer → `.result`; schema-validated answer → `.structured_output`; session id → `.session_id`. Invalid schema input fails fast: `Error: --json-schema is not a valid JSON Schema` (behavior since v2.1.205; before that invalid schemas were silently ignored). `format` keyword accepted but not enforced. (headless docs)
- **Envelope stability:** documented as the SDK `SDKResultMessage`: `type:"result"`, `subtype: "success" | "error_max_turns" | "error_during_execution" | "error_max_structured_output_retries"`, `duration_ms`, `duration_api_ms`, `is_error`, `num_turns`, `result`, `session_id`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `structured_output`, `errors`, `uuid`. Core fields (`result`, `structured_output`, `session_id`, `total_cost_usd`, subtypes, `errors`) are confirmed across the headless + structured-outputs pages; the exact optional-field list comes from the SDK TypeScript reference via a summarizing fetch — re-verify field-by-field against a live `--output-format json` run at implementation time.

### Model selection + origin

- `--model` takes an alias (`sonnet`, `opus`, `haiku`, `fable`) or full name (`claude-fable-5`); overrides `ANTHROPIC_MODEL` env and settings. `--fallback-model a,b` auto-falls back when primary is overloaded/unavailable (print mode only). (CLI reference; `claude --help`)
- **Origin tracking:** good. The `system/init` stream event "reports session metadata including the model" (headless docs), and the result envelope's `modelUsage` is keyed by the model(s) actually billed — so a fallback-model switch is observable. Caveat from structured-outputs docs: a mid-stream model fallback can retract an already-completed structured output.

### Exit codes + error surfaces

- **No documented exit-code table.** Documented non-zero exits: stdin >10MB cap, invalid `--json-schema`; `claude auth status` exits 0 if logged in / 1 if not (CLI reference). Beyond that: unverified — treat any non-zero as opaque failure and read the JSON.
- In-band errors: `.is_error`, `.subtype`, `.errors[]` in the result envelope. During streaming, retryable API failures emit `system/api_retry` events with `error` category strings: `authentication_failed`, `oauth_org_not_allowed`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `unknown` — this is the documented surface for auth expiry and rate limits. (headless docs)
- Refusals: no distinct signal; they arrive as ordinary `result` text (unverified — nothing in the docs fetched distinguishes refusals).

### Streaming vs buffered; timeout/hang; cancellation

- `stream-json` (+ `--verbose --include-partial-messages` for token-level deltas). (headless docs)
- **Hang surfaces (documented):** a background Bash task spawned during the run is killed ~5s after the final result (since v2.1.163; before that a never-exiting background process held `-p` open indefinitely). Background subagents can hold the process up to a 10-minute cap (since v2.1.182), tunable via `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`. (headless docs)
- **No wall-clock timeout flag.** `--max-budget-usd` is a cost cap, not a time cap. Adapter must own the timeout.
- SIGINT/SIGTERM behavior: not documented in fetched pages — unverified; assume kill-and-discard.

### Token/cost accounting

- `--output-format json` payload includes `total_cost_usd`, `usage` (input/output tokens), and a per-model breakdown (`modelUsage`, incl. `cost_usd` per model). Explicitly pitched in docs for per-invocation spend tracking. (headless docs; SDK TS reference)

### Auth

- **macOS: credentials in the encrypted macOS Keychain** (Keychain item `Claude Code-credentials`; item name verified only from community sources — the official page says "macOS Keychain" without naming the item). Linux: `~/.claude/.credentials.json` (mode 0600); Windows: `%USERPROFILE%\.claude\.credentials.json`; `CLAUDE_CONFIG_DIR` relocates it on Linux/Windows. (authentication docs)
- **Precedence** (documented): cloud-provider env switches → `ANTHROPIC_AUTH_TOKEN` (Bearer) → `ANTHROPIC_API_KEY` (X-Api-Key; in `-p` mode "the key is always used when present", no approval prompt) → `apiKeyHelper` script (re-called after 5 min or on HTTP 401; `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`) → `CLAUDE_CODE_OAUTH_TOKEN` (one-year token from `claude setup-token`, subscription plans, inference-only) → subscription OAuth from `/login`. (authentication docs)
- **Expiry:** OAuth logins expire; ≥v2.1.203 warns 5 days ahead at startup. An unattended session that outlives the login "stops making progress once the credential expires" — directly relevant to long-running adapter jobs on OAuth auth. `--bare` never reads OAuth/keychain (nor `CLAUDE_CODE_OAUTH_TOKEN`). (authentication docs)

---

## 2. `codex exec` (OpenAI Codex CLI) — v1 target

Local version verified: **codex-cli 0.142.5** (`codex --version`).

### Headless invocation

- `codex exec [OPTIONS] [PROMPT]`. **stdin:** if prompt arg omitted or `-` given, instructions are read from stdin; if stdin is piped *and* a prompt arg is given, stdin is appended as a `<stdin>` block. (`codex exec --help`)
- Progress streams to stderr; final agent message to stdout (non-JSON mode). (non-interactive docs)
- **TTY:** designed for scripts; no TTY required (non-interactive docs' CI examples). Project-memory caveat below under hangs.
- **Sandbox/approvals:** `-s/--sandbox <read-only|workspace-write|danger-full-access>` (read-only is the exec default per non-interactive docs); `--dangerously-bypass-approvals-and-sandbox` skips everything ("EXTREMELY DANGEROUS"). `--skip-git-repo-check` needed outside a git repo. `--ephemeral` avoids persisting session files. `--cd <DIR>` sets working root. (`codex exec --help`)

### Structured output

- `--json` → JSONL events on stdout. Event vocabulary (verified in source, `exec_events.rs`): `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.started`, `item.updated`, `item.completed`, `error`. Item types incl. `agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `todo_list`, `error`.
- **Answer field path:** final answer = last `{"type":"item.completed","item":{"type":"agent_message","text":"..."}}` — `.item.text`. Doc comment in source: agent_message text is "either a natural-language response or a JSON string when structured output is requested" — i.e. even with a schema, **the answer arrives as a JSON *string* inside `text`**, needing a second parse.
- **Native schema enforcement:** `--output-schema <FILE>` — "Path to a JSON Schema file describing the model's final response shape" (`codex exec --help`; non-interactive docs show it combined with `-o`). It is wired to the OpenAI structured-outputs feature, but **neither the help nor the docs state what happens on validation failure or whether there is a retry** — treat the guarantee as strict-decoding-level (strong) but unverified at the edges; adapter should still validate.
- `-o/--output-last-message <FILE>` writes the final message to a file — the simplest robust extraction path (works with or without `--json`).
- **Envelope stability:** the Rust types are `ts-rs`-exported and mirrored in the official TypeScript SDK (`sdk/typescript/src/events.ts`), which suggests intent to keep stable, but no explicit stability promise found — unverified.

### Model selection + origin

- `-m/--model <MODEL>`; also `-c model="..."` config override; `--oss`/`--local-provider` for local models. (`codex exec --help`)
- **Origin gap (verified in source):** no JSONL event carries a model id — `thread.started` has only `thread_id`; `turn.completed` has only `usage` (`exec_events.rs`). The model name is printed only in the *human* stderr header (`event_processor_with_human_output.rs` prints a `("model", ...)` config line). Worse: a `ModelRerouted` server notification exists and is rendered in human mode ("model rerouted: X → Y") but has **no counterpart in the JSONL processor** (`event_processor_with_jsonl_output.rs` — no model/reroute handling). So in `--json` mode you cannot confirm which model actually ran.

### Exit codes + error surfaces

- Verified in source (`codex-rs/exec/src/lib.rs`): exec tracks `error_seen` — set on a non-retryable server error notification or a turn ending `Failed`/`Interrupted` — and calls `std::process::exit(1)`; comment: "exit with a non-zero status for automation-friendly signaling." Otherwise exit 0. Config/bootstrap failures also `exit(1)`. No richer exit-code taxonomy exists.
- In-band: fatal → `{"type":"error","message":"..."}` or `turn.failed` (wraps the same `ThreadErrorEvent`, a bare `message` string); non-fatal → `error` items. Auth expiry / rate limits / refusals are **not** discriminated by type — they arrive as message strings. A `required = true` MCP server that fails to init makes exec exit with an error. (source; non-interactive docs)

### Streaming vs buffered; timeout/hang; cancellation

- `--json` is inherently streaming (JSONL as events happen). No built-in wall-clock timeout flag (`codex exec --help` — none exists).
- **Hang risk (project observation, not docs):** during earlier review loops a `codex exec` run hung ~1h with zero output (machine likely slept mid-run; ps showed 8h elapsed) and had to be killed (project memory, 2026-07-10). Adapter must enforce external timeout + inactivity watchdog.
- **Cancellation (verified in source):** SIGINT is caught and forwarded as a `turn/interrupt` request; an interrupted turn sets `error_seen` → clean shutdown with exit 1. So SIGINT is safe and yields a deterministic non-zero exit.

### Token/cost accounting

- `turn.completed` event: `usage` = `{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}` (verified in `exec_events.rs`). **No cost/USD field anywhere** — adapter must price tokens itself. Multi-turn runs emit usage per turn; the JSONL processor aggregates from the server's running total (source).

### Auth

- `codex login` (ChatGPT OAuth browser flow) or `printenv OPENAI_API_KEY | codex login --with-api-key` (API-key mode, API pricing). Headless: `codex login --device-auth`, or copy credentials from another machine. (auth docs)
- **Storage:** `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`) or OS keyring, controlled by config `cli_auth_credentials_store` = `file` | `keyring` | `auto`. Docs: "treat `~/.codex/auth.json` like a password: it contains access tokens." (auth docs)
- **Refresh:** ChatGPT tokens are auto-refreshed during use before expiry; long-idle credentials can still require re-login (auth docs). Env vars: `OPENAI_API_KEY` (login-time), `CODEX_API_KEY` shown in the non-interactive docs for direct `codex exec` env auth, `CODEX_ACCESS_TOKEN` for enterprise tokens. (auth + non-interactive docs)

---

## 3. `cursor-agent` (Cursor CLI) — execution-verified

Verified by authenticated execution on binary `2026.08.25-3e8eec8` (darwin/arm64, Pro subscription, 2026-08-27). Where behavior contradicts the cursor.com docs, execution wins and the conflict is noted.

### Headless invocation

- `-p/--print` — non-interactive; default output format text. **Has access to all tools, including write and shell — and it USES them: a plain `-p` run without `--force` created a file on disk** (verified). The docs-era assumption that print mode proposes-not-applies is false.
- **Read-only lockdown:** `--mode plan` (or `--mode ask`) — verified: the same file-creation prompt under `--mode plan` produced a textual plan and wrote nothing. This, not the absence of `--force`, is the generation lockdown. `--sandbox <enabled|disabled>` also exists (not exercised).
- **stdin prompt delivery: works** (verified — prompt piped, no TTY needed for `json` mode).
- `--trust` skips the workspace-trust prompt; needed for scripted runs in fresh directories.

### Structured output

- `--output-format <text|json|stream-json>` (print mode only); `--stream-partial-output` for deltas.
- **Envelope (verified):** `{"type":"result","subtype":"success","is_error":false,"duration_ms":...,"duration_api_ms":...,"result":"<answer>","session_id":...,"request_id":...,"usage":{"inputTokens":...,"outputTokens":...,"cacheReadTokens":...,"cacheWriteTokens":...}}`. Answer in `.result`. The `usage` block and `request_id` are new since the 2026-07 docs snapshot.
- **stream-json (verified):** `system/init` → `user` → `assistant` → terminal `result` (same shape as json envelope incl. `usage`). `system/init` carries `apiKeySource` (`"login"` or `"env"`), `model` (display name incl. effort, e.g. "GPT-5.2 Medium"), `permissionMode`, `cwd`, `session_id`.
- **No JSON-Schema flag** (still true on current binary) — adapter validate/retry is the enforcement.

### Model selection + origin

- `--model <model>`; `--list-models` enumerates ~200 ids; effort is baked into the id (`-low/-medium/-high/-xhigh/-max`, `-thinking`, `-fast` variants). **Bracket overrides are REJECTED by `--model`** (execution-verified 2026-08-28, binary 2026.08.25: `cursor-grok-4.6-high[effort=high]` and `gpt-5.2[effort=high]` both fail with `Cannot use this model`; the bracket note previously recorded here came from help text, not accepted argv). The id list is the whole vocabulary — base ids (`gpt-5.2`) and flattened effort variants (`gpt-5.2-high`) both appear in it, and the rejection's ~200-id "Available models" payload flushes the error prefix out of a 4KB stderr tail (capture the head for classification).
- **Origin:** `result` envelope has no model field (verified). stream-json `system/init` reports the *requested* model's display name — under a pinned model it echoes the request; not proof of the served model. Origin stays a declaration.

### Exit codes + error surfaces

- Verified: success 0; bad model exit 1 (`Cannot use this model: <id>. Available models: ...` on stderr); unknown flag exit 1 (`error: unknown option`); logged-out generation exit 1 (`Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.`). AUTH vs CONFIG classify from stderr prefixes; errors are NOT in-band JSON.
- **Trap:** logged-out `status` exits **0** ("Not logged in" on stdout) — exit code is auth-blind. `cursor-agent update` while logged out exits 1.

### Streaming / timeout / cancellation

- **stream-json emits NOTHING to a pipe until process exit** (verified: 0 bytes for 24s mid-generation, full event log flushed at termination). Under a pty, output streams incrementally. An output-inactivity watchdog on piped stdout will kill every long run — the adapter must run the CLI under a pty or watch process-liveness + wall-clock only.
- SIGTERM (verified): process dies in ~16ms, exit 143, no cleanup stall — single-rung kill ladder suffices.
- No timeout flags (unchanged); the docs-era `status` hang is gone on the current binary.
- Per-attempt overhead: ~14–16s wall for a trivial one-shot vs ~4–5s `duration_api_ms` — ~9s process startup/auth cost per spawn.

### Token/cost accounting

- Tokens: yes, in `usage` on the terminal `result` event (json and stream-json) — totals only, no per-turn breakdown events. Cost: none — price it yourself or record "unknown".

### Auth

- `agent login` (browser OAuth) / `logout` / `status`. **Probe (verified): `cursor-agent about --format json`** — exit 0 both states, `userEmail`/`subscriptionTier` null when logged out, plus `cliVersion`, default `model`, update status. Instant, machine-checkable; prefer it over `status` (exit-blind) for the boot probe.
- **`CURSOR_API_KEY` (verified): takes precedence over the stored login** — `system/init` reports `apiKeySource: "env"` with both present. The init event is the billing-route assertion hook.
- **darwin quirk (verified):** given an env key, the CLI persists it to the macOS keychain (warns and continues on failure). `HOME` overrides do not isolate credentials on macOS and can trigger keychain dialogs — don't fake HOME in tests.
- SDK note: `@cursor/sdk` credentials (`~/.cursor/sdk/auth.json`, API-key only) are **disjoint from CLI login** (verified behaviorally: SDK sees no CLI session). SDK error classes work via `instanceof` only — constructor names are minified.

---

## 4. `opencode run` (OpenCode CLI) — deferred; lower depth

Not installed locally; facts from opencode.ai/docs and source at `sst/opencode` **dev branch** `packages/opencode/src/cli/cmd/run.ts` (fetched 2026-07-12; note the default branch is `dev`, so this is ahead of the latest release).

### Headless invocation

- `opencode run [message..]` — non-interactive: sends one prompt, streams events, exits when the session goes idle (source header comment).
- **stdin (verified in source):** `process.stdin.isTTY ? undefined : await Bun.stdin.text()` — piped stdin is read fully and appended after the message arg. Empty message + no stdin → error, exit 1. Non-TTY stdout gets raw text lines (source, `text` part handling) — no TTY needed.
- **Permissions (verified in source):** in non-interactive mode, permission requests are **auto-rejected** by default (with a warning line); `--auto` (docs: "Auto-approve permissions that are not explicitly denied (dangerous!)"; hidden aliases `--yolo`, `--dangerously-skip-permissions`) flips to auto-approve. `question`/`plan_enter`/`plan_exit` permissions are force-denied in run mode.

### Structured output

- `--format <default|json>` — json = "raw JSON events" as NDJSON (source `emit()`): each line `{type, timestamp, sessionID, ...data}` with types `text`, `tool_use`, `step_start`, `step_finish`, `reasoning`, `error`.
- **Answer field path:** the final answer is the `text` event(s): `.part.text` (emitted when a text part completes). There is **no terminal aggregate result event** — the adapter must collect `text` events and detect completion by process exit (session idle). Envelope is an internal event mirror, not a documented stable contract.
- **No JSON-Schema enforcement flag** for the model's answer — none in docs or the run command's yargs builder (verified). Validate+retry must live in the adapter.

### Model selection + origin

- `-m/--model provider/model` (e.g. `anthropic/claude-...`); `--variant` for reasoning effort; `--agent`. (docs + source)
- **Origin tracking:** in default (human) format it prints `> {agent} · {modelID}`; in `--format json` mode that header is suppressed (verified in source: gated on `args.format !== "json"`), and none of the emitted event types carries a model id at the top level. Whether `step_start`/`step_finish` part payloads embed model info: unverified. Treat as an origin-tracking gap in JSON mode.

### Exit codes + error surfaces

- Verified in source: usage errors and missing files → `process.exit(1)`; `session.error` events or prompt-call errors → `process.exitCode = 1`; otherwise exits 0 on session idle. Errors in JSON mode are emitted as `{"type":"error","error":{...}}` events (provider errors carry `error.name` + `error.data.message`). No richer exit taxonomy; auth/rate-limit/refusal not discriminated.

### Streaming / timeout / cancellation

- JSON mode is streaming NDJSON. No timeout flags (verified against the run command builder). SIGINT handling: nothing special in `run.ts` — unverified beyond default process kill. Completion is signaled by a `session.status: idle` event internally, then exit — a stalled provider means no idle event, i.e. hang risk with no built-in guard.

### Token/cost accounting

- Not surfaced in the run command's own output handling (no token/cost fields in emitted events at the level verified). The underlying session/message model may include cost/token data inside `step_finish` part payloads — **unverified** at this depth.

### Auth

- `opencode auth login`; credentials stored in `~/.local/share/opencode/auth.json` (docs). Provider API keys via the auth store; env-var passthrough for provider keys (e.g. `ANTHROPIC_API_KEY`) is the norm for its provider layer but not verified here. Server mode has `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD` basic auth (docs + source).

---

## Implications for adapter design

Structured-output floor is HARD: every Generator adapter must guarantee schema-valid JSON out.

1. **Schema enforcement tiering:** `claude -p` is the only CLI with *documented validate-and-retry semantics* against a caller-supplied schema (`--json-schema` → `structured_output` or a typed error subtype). `codex exec --output-schema` enforces shape but delivers the answer as a JSON string inside `item.text` / `-o` file, with undocumented failure semantics. cursor-agent and opencode have **no schema flag at all** — for them the adapter's validate+re-invoke wrapper *is* the enforcement mechanism. Design the port so the wrapper exists for everyone (defense-in-depth, per the enum-server-enforcement lesson) and native enforcement is an optimization.
2. **Answer extraction is four different shapes:** `.result` / `.structured_output` (claude json envelope) vs last `item.completed agent_message .item.text` or `-o` file (codex) vs `.result` (cursor, claude-clone envelope) vs concatenated `text` events with **no terminal result event** (opencode). The adapter interface should be "give me (answer_text, structured_answer?, metadata)" and hide this entirely.
3. **Origin tracking:** only claude reports the model actually used in machine-readable output (`system/init` model + `modelUsage` keyed by model). Codex `--json` has a verified origin-tracking hole *including silent model rerouting* (reroute notification exists but is dropped by the JSONL processor). Cursor's `system/init` model field is a requested-echo (verified), and its result envelope has none; opencode JSON shows no model field. If knowing the model's origin matters for the brief record, the adapter must echo the *requested* model and mark actual-model as unknown for non-claude backends.
4. **Cost/token accounting:** claude gives tokens + USD (`total_cost_usd`, `modelUsage[].cost_usd`); codex and cursor give tokens only (codex `turn.completed.usage`; cursor `result.usage`, both incl. cache splits) — price it yourself; opencode gives effectively nothing. Any per-run cost ledger must tolerate "unknown".
5. **Timeouts are 100% the adapter's job:** none of the four has a wall-clock timeout flag. Codex has a *lived* hang precedent in this project (~1h zero-output hang during a review loop, killed manually) and opencode's exit condition is an idle event that never arrives if the provider stalls. Wrap every backend in hard timeout + output-inactivity watchdog; prefer streaming modes (`stream-json` / `--json` / `--format json`) so the watchdog has liveness signal — **except cursor, whose stream-json is silent on a pipe until exit (verified)**: there the watchdog must key on process-liveness + wall-clock, or the adapter must spawn under a pty.
6. **Cancellation:** codex SIGINT is verified-clean (forwards turn/interrupt, exits 1); cursor SIGTERM is verified-clean (dies ~16ms, exit 143). Claude/opencode SIGINT semantics are unverified — assume kill, and make adapter runs idempotent/ephemeral (codex `--ephemeral`, claude `--no-session-persistence`) so a killed run leaves no resumable junk.
7. **Exit codes are nearly information-free everywhere:** codex is deliberately binary 0/1 (verified in source); claude/opencode are 0/1-ish; cursor is 0/1 with classifiable *stderr* prefixes (verified: auth vs config discriminate on message text, but `status` exits 0 even logged out). Error *classification* (auth expiry vs rate limit vs refusal) is only possible in-band on claude, via documented `system/api_retry` error categories and result `errors[]`. The adapter's Result type should classify from in-band JSON where available and fall back to stderr-prefix matching, then "opaque failure + captured stderr".
8. **Permission lockdown for a generator call differs per CLI and is a correctness issue, not just safety:** claude `--tools "" --bare -p` gives a near-pure LLM call; codex minimum is `--sandbox read-only --skip-git-repo-check` (default sandbox already read-only in exec); cursor requires `--mode plan` — a bare `-p` run without `--force` *applies* file writes (verified), the docs-era proposes-not-applies assumption is false; opencode auto-*rejects* permissions in run mode — meaning a generation that tries to use a tool silently loses that capability rather than prompting. Bake per-backend "generation profile" flag sets into the adapter.
9. **Auth fragility ranking for unattended runs:** worst is claude-on-OAuth (login expiry stalls unattended runs; macOS Keychain access fails in sandboxed/backgrounded contexts — see docker-builds memory for the same keychain class of problem) — mitigate with `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, noting `--bare` only honors the API-key paths. Codex is file-based (`~/.codex/auth.json`) with auto-refresh — friendliest to headless. Cursor honors `CURSOR_API_KEY` with precedence over the stored login (verified; `system/init` `apiKeySource` asserts the route) and persists it to the macOS keychain on darwin. OpenCode is plain-file (`~/.local/share/opencode/auth.json`).
10. **Envelope churn risk:** claude's envelope is documented API surface (SDK types, versioned changelog behavior notes) — safest to parse. Cursor's is documented but the product is fast-moving. Codex's is source-typed but unversioned. OpenCode's is an internal event mirror read off the dev branch — pin the version you test against and gate opencode/cursor adapters behind a conformance smoke test rather than trusting the shape.
