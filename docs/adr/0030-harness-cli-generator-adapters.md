# Harness-CLI Generator Adapters (Local-Only)

Agent-harness CLIs become first-class `Generator` providers behind the port
from ADR 0013: **`claude -p`** and **`codex exec`** in v1 ~~(cursor-agent and
opencode deferred)~~, implemented as **thin per-CLI adapter classes over one
shared harness-execution core** in `packages/generators`. The adapters are
**local-only in v1** — they run where a human has interactively logged the
CLI in, never in a deployed worker — and the structured-output floor (ADR
0013 #3) is enforced by the adapter's own validate→salvage→retry pipeline on
every CLI, with native schema flags as a bonus layer, never a replacement.

**Amended (2026-10-06, BRIEF-332):** `cursor-agent` shipped as the third harness adapter; opencode stays deferred. All three CLI adapters, and their startup checks, spawn in a fresh empty temp directory removed after the run, so no CLI ever reads the worker's or CLI's own checkout as its workspace. Generation runs also skip the operator's user-level CLI config: claude runs `--setting-sources "" --strict-mcp-config --disable-slash-commands`, codex `--ignore-user-config --ignore-rules -c features.hooks=false`. A live smoke run showed a user-level hook rewriting generated output and a session logger copying the run to a notes vault; cursor-agent has no such switch.

## Context

The `Generator` port (ADR 0013) has one adapter — `AnthropicGenerator` on the
official SDK, BYOK by API key. But the people MergeBrief targets already pay
for agent subscriptions (Claude Pro/Max, ChatGPT/Codex), and a CLI-backed
generator lets a self-hosted instance ride that existing spend instead of a
second metered API bill. Two research notes feed this decision:
`docs/dev/harness-cli-capabilities.md` (invocation, schema enforcement,
envelopes, exit codes, auth — per CLI) and
`docs/dev/harness-cli-deployed-feasibility.md` (containerization and
subscription-ToS analysis). The capability facts that shaped the design: only
`claude -p` enforces a caller schema natively; codex delivers the answer as a
JSON string needing a second parse and its JSONL hides the model id (silent
reroute invisible); **no CLI has a built-in timeout**, and this project has a
lived codex hang precedent; exit codes are near-information-free everywhere.

## Decision

1. **Local-only in v1; the boundary is loud.** Subscription auth is what
   makes CLI backends attractive, and vendor ToS make unattended/server use
   of it at best gray (Anthropic: "ordinary, individual usage", active
   enforcement precedent; Codex: documented-but-discouraged; Cursor:
   undocumented). Harness adapters therefore run only on a user's own machine
   (categorizer CLI / local dogfood is their primary entry); the deployed
   worker keeps API-provider adapters. README/config docs state this boundary
   and why; deployed harness mode is a future ticket gated on the feasibility
   note's revisit triggers — never a silent v1 extension.
2. **Thin per-CLI classes over a shared core.** `ClaudeCodeGenerator` and
   `CodexGenerator` own only their CLI's flags, envelope parsing, and
   origin quirks; the shared core owns spawn, timers, the kill ladder,
   and the schema-floor pipeline. A generic `HarnessGenerator` with profile
   objects was rejected: answer extraction differs per CLI in kind (four
   shapes across the ecosystem, codex double-parse), so profiles stop being
   declarative, and registry union typing degrades. Adding a deferred CLI =
   one class + one options schema + one registry entry.
3. **The floor pipeline is identical for every CLI.** The shared
   validate→salvage(`salvageDroppableEnums`)→retry-once→dump pipeline
   (`runWithSchemaFloor`) runs regardless of native enforcement; claude's
   `--json-schema` and codex's `--output-schema` are handed the
   enum-preserving JSON schema as defense-in-depth on top. Retry is ONE fresh
   process with the failed output + validation errors stitched into the
   prompt — no session resume (uniformity across CLIs, ephemeral hygiene;
   the re-paid input cost is accepted). Failures dump raw output + captured
   stderr.
4. **Process lifecycle.** Spawn in streaming mode always (`claude -p
   --output-format stream-json --verbose --include-partial-messages`;
   `codex exec --json`) — the event stream is the liveness signal. No shell;
   argv arrays; the prompt goes via stdin, then stdin closes (kills
   interactive traps, dodges ARG_MAX). Two timers, both mandatory: hard
   wall-clock (default 15 min) and output-inactivity watchdog (default
   3 min), per-adapter tunable in instance config. Cancellation and timer
   fire share one kill ladder: SIGINT, 5 s grace, SIGKILL. An abort
   propagates untouched (not a generation failure, per ADR 0006 #6); a timer
   fire becomes a classified failure with stderr tail + partial-output dump.
   Generation runs use lockdown profiles (codex `--sandbox read-only
   --skip-git-repo-check --ephemeral`; claude without `--bare` — OAuth is
   the point and `--bare` reads only API-key auth — exact tool lockdown
   settled at implementation).
5. **Failure taxonomy.** `generate()` keeps throwing (no port surgery);
   construction keeps `Result`. A shared `GeneratorError` carries `kind`:
   `auth | config | provider-transient | timeout | schema-floor | refusal |
   cli-missing | opaque` — classified from in-band JSON where the CLI
   provides it (claude `system/api_retry` categories, result `errors[]`),
   else `opaque` plus captured stderr. Construction-time startup checks run
   `<cli> --version` and an auth preflight (`claude auth status` exits 0/1;
   codex equivalent probed at implementation, `auth.json` presence as a weak
   fallback) so a misconfigured instance refuses boot instead of failing
   inside jobs.
6. **Origin: the CLI is the provider; honest within the static
   declaration.** Provider tokens `claude-code` / `codex`; `model` = the
   requested/configured id (the CLI owns actual routing). Where the CLI makes
   reality observable, trust-but-verify: the claude adapter compares the
   result envelope's `modelUsage` keys against the requested model post-run —
   mismatch logs a warning and surfaces in the UI (the stamp itself stays the
   declaration). Codex's silent-reroute blind spot is documented plainly;
   upgrading it to verification waits on its JSONL gaining a model event.
   Effort: codex maps to `model_reasoning_effort` (flag existence verified at
   implementation, else null-treatment); claude-code has no headless effort
   knob → `effort: null`, honestly recording that ADR 0010's triage loses its
   effort lever there (capability gap per ADR 0013 #5). The UI must visibly
   distinguish harness-CLI runs from API/SDK runs, and retry/salvage events
   must be explicit in logging, generation status, and docs.

## Considered Options

- **Adapter shape.** Generic `HarnessGenerator` + per-CLI profile objects
  (rejected: profiles stop being declarative once answer extraction and
  double-parse quirks differ in kind; registry typing suffers) · **thin
  per-CLI classes over a shared core (chosen)** — mirrors the
  OpenAI-compatible core precedent for API adapters.
- **Schema floor.** Trust native enforcement where it exists, wrapper only
  for the rest (rejected: two enforcement regimes, and codex's failure
  semantics are undocumented; the enum-server-enforcement lesson says layers
  slip) · **identical wrapper pipeline everywhere, native flags as bonus
  (chosen).**
- **Retry transport.** Session resume with feedback (rejected: per-CLI resume
  semantics diverge, session persistence conflicts with ephemeral hygiene) ·
  **one fresh process with feedback stitched into the prompt (chosen).**
- **Deployment posture.** Ship container support behind a flag (rejected:
  every subscription-auth route is gray-to-banned per the feasibility note;
  API-key mode erases the cost advantage that motivates harness adapters) ·
  **local-only v1 with loud docs + revisit triggers (chosen).**

## Why This Way

The whole product rests on schema-valid output (ADR 0013 #3), and CLIs are
the weakest structured-output substrate we support — so the floor lives in
code we own, uniformly, and native flags only reduce retries rather than
carry correctness. Process handling is the actual risk surface (the hang
precedent is lived, not hypothetical), which is why the core owns timers and
the kill ladder and why tests fake the binary rather than the spawn. And the
local-only boundary converts a ToS landmine into a product statement: ride
your subscription on your machine; the deployed worker uses API keys.

## Consequences

- **New in `packages/generators`:** shared harness core, two adapter classes,
  two registry entries, provider vocabulary tokens `claude-code`/`codex`,
  startup check + auth preflight machinery, `GeneratorError`.
- **Testing:** real-process fake-CLI shims (`SHIM_SCENARIO` failure matrix),
  injectable timer/kill-ladder durations, shared conformance suite
  (`describeGeneratorContract`) every adapter must pass; live smoke stays
  manual and outside CI (no live keys/CLIs in CI).
- **Docs debt (mandated):** README local-only boundary + why, per-CLI
  isolation/lockdown story, codex origin blind spot, retry/salvage
  visibility.
- **Capability gaps recorded:** no effort knob on claude-code, no
  cost/model accounting on codex — surfaced via origin metadata per ADR 0013 #5.
- **Revisit triggers:** vendor sanctions unattended subscription use /
  ships a server CLI distribution (deployed-mode ticket); codex JSONL gains
  a model/reroute event (verification upgrade); ~~cursor/opencode~~ opencode
  promotion adds one class + entry behind a conformance smoke gate (cursor
  promoted, amended 2026-10-06).
- Builds on ADR 0013 (port, floor, origin, BYOK), ADR 0006 #6 (abort
  semantics), ADR 0010 (triage effort lever weakened on claude-code);
  sibling: instance-level config (ADR 0006/0013 amendments, 2026-07-12).
