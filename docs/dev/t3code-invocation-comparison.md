# T3 Code vs our claude-code adapter — CLI invocation comparison

Research note (AFK, 2026-08-08). Primary sources only:

- **t3code**: https://github.com/pingdotgg/t3code, commit `a20923ce463335e89e92f5983d98a180536e8e7d`
  (2026-08-08). All t3code paths below are relative to the repo root.
- **ours**: `packages/generators/src/adapters/claudeCode.ts`,
  `packages/generators/src/harness/run.ts`, `packages/generators/src/harness/probe.ts`.

## The headline: t3code has TWO Claude paths, and only one resembles ours

1. **Interactive sessions** go through the **`@anthropic-ai/claude-agent-sdk`**
   (`^0.3.170`, `apps/server/package.json:25`) — `query()` with a streaming
   `AsyncIterable` prompt, i.e. one persistent `claude` subprocess per thread,
   multi-turn (`apps/server/src/provider/Layers/ClaudeAdapter.ts:3747-3754`,
   `4158-4171`). They never hand-roll `--input-format stream-json`; the SDK owns
   the wire protocol.
2. **One-shot text generation** (commit messages, PR bodies, branch names, thread
   titles) spawns **`claude -p --output-format json --json-schema …`** per call —
   structurally the same shape as our adapter
   (`apps/server/src/textGeneration/ClaudeTextGeneration.ts:159-183`).

So t3code itself concluded what ADR 0030 concluded: for small structured one-shots,
a fresh `-p` process with `--json-schema` is the right tool; the persistent session
machinery exists for their actual product (interactive agent control), not for
structured generation.

---

## 1. Session model and cache economics

**t3code (interactive path)**: one long-lived SDK `query()` per thread. The prompt
is an Effect `Queue` adapted to an `AsyncIterable` (`ClaudeAdapter.ts:3747-3754`),
so every user turn is written into the same subprocess — the SDK's streaming-input
session mode. Sessions survive server restarts via a persisted `resumeCursor`
(`{ resume: sessionId, resumeSessionAt: lastAssistantUuid }`,
`ClaudeAdapter.ts:626-657, 4111-4112, 4182-4187`) replayed as the SDK `resume`
option. Idle sessions are reaped after 30 min by a sweeper
(`apps/server/src/provider/Layers/ProviderSessionReaper.ts:17-18`).

**Cache economics**: within a session, later turns ride the same process and
conversation, so prompt cache is reused — their usage accounting explicitly sums
`cache_creation_input_tokens` + `cache_read_input_tokens` per turn
(`ClaudeAdapter.ts:439-445`). But their **one-shot text-gen path pays fresh
cache-creation on every spawn exactly like ours** — no resume, no session reuse
(`ClaudeTextGeneration.ts:159-234`). Nothing in t3code reduces one-shot cache cost;
they only get reuse where the product is inherently conversational.

**Ours**: one `claude -p` process per attempt, stateless by design
(`claudeCode.ts:22-24`); the feedback retry is a fresh process with the failed
output stitched into the prompt (`claudeCode.ts:183-191`) because the CLI has no
assistant-turn seam. Measured cost: ~37K cache-creation input tokens per run
(2026-08-08, opus-4-8).

**Recommendation: investigate (narrow), mostly ignore.** The persistent-session
model conflicts with our core constraints (stateless one-shot, hard schema floor,
abort propagation untouched, kill-ladder ownership of the process tree) and t3code
demonstrates no one-shot cache win to copy. The narrow investigation: whether
`--resume <sessionId>` on a second `-p` invocation (the shape t3code persists at
`ClaudeAdapter.ts:4111`) would let our *feedback retry* — the only place we
re-send the same ~37K-token context — reuse the first attempt's cache instead of
re-paying creation. That is a bounded change (retry-only, still one process per
attempt) and the retry is rare, so expected value is low but the check is cheap.

## 2. Auth path

**t3code**: pure keychain-login inheritance. The spawn env is `process.env`
spread-through; the only mutation is optionally setting `CLAUDE_CONFIG_DIR` when a
per-instance Claude home is configured
(`apps/server/src/provider/Drivers/ClaudeHome.ts:17-35`). No token env vars are
set, no `setup-token` flow, and — notably — **no credential stripping at all**:
zero references to `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` /
`CLAUDE_CODE_OAUTH_TOKEN` anywhere in `apps/server/src` (verified by grep at the
pinned commit). A stray `ANTHROPIC_API_KEY` in the server's environment would
silently rebill their users to the API — the exact hole BRIEF-140 closed for us.
Their README's setup instruction is `claude auth login` (README.md, Installation).

Instead of enforcing the billing route, they **display** it: a capability probe
spawns an SDK session with a never-yielding prompt (so no API request is made),
reads `initializationResult().account` — email, `subscriptionType`, `tokenSource`,
`apiProvider` — and renders "Claude Max Subscription" vs "Claude API Key" in the
UI (`apps/server/src/provider/Layers/ClaudeProvider.ts:703-773, 540-559`).

**Ours**: inherit process env, then strip `HARNESS_STRIPPED_CREDENTIAL_VARS` at
the one spawn seam, `CLAUDE_CODE_OAUTH_TOKEN` deliberately surviving
(`run.ts:393-423`).

**Recommendation: keep ours (stronger); investigate their account-info read.**
Their `CLAUDE_CONFIG_DIR` note is worth stealing for docs: overriding `HOME` to
isolate config **breaks macOS keychain OAuth lookup** (`$HOME/Library/Keychains`),
which is why they point `CLAUDE_CONFIG_DIR` at the isolated dir and leave `HOME`
alone (`ClaudeHome.ts:27-33`) — a gotcha `docs/self-host/generators.md` should
mention for anyone sandboxing the CLI. The account probe is an **investigate**:
the stream-json `system/init` event (or an SDK-style init read) may expose
`tokenSource`/`subscriptionType`, which would upgrade our boot probe from "a
credential exists" (`probe.ts:75-108`) to "the credential is the subscription
route" — closing the residual `apiKeyHelper` hole documented in
`run.ts:390-392` at verification time instead of leaving it dark.

## 3. Exact flags and env vars

**t3code one-shot** (`ClaudeTextGeneration.ts:159-183`):

```
claude -p --output-format json --json-schema <schema>
       --model <slug or slug[1m]>
       [--effort <low|medium|high|xhigh|max>]
       [--settings <json: alwaysThinkingEnabled/fastMode/ultracode>]
       --dangerously-skip-permissions
```

prompt via stdin, `cwd` = the repo, env = inherited (+ optional
`CLAUDE_CONFIG_DIR`). The `[1m]` model suffix selects the 1M-context variant
(`ClaudeProvider.ts:452-459`). Effort is normalized per model
(`ultracode → xhigh` + settings flag, `ultrathink` handled as a prompt prefix,
downgrade mappings for older models — `ClaudeProvider.ts:409-432`).

**t3code interactive** (SDK options, `ClaudeAdapter.ts:4093-4131`): `model`,
`effort`, `systemPrompt: { preset: "claude_code" }`, `settingSources`,
`permissionMode` (+ `allowDangerouslySkipPermissions`), `resume`/`sessionId`,
`includePartialMessages`, `canUseTool`, `env`, `additionalDirectories`,
user-configured `extraArgs` passthrough, and an MCP server injection. The probe
variant adds `persistSession: false`, `allowedTools: []`, `mcpServers: {}` +
`strictMcpConfig: true`, and `ENABLE_CLAUDEAI_MCP_SERVERS=false`
(`ClaudeProvider.ts:586-611`).

**Ours** (`claudeCode.ts:195-208`):

```
claude -p --output-format stream-json --verbose --tools ""
       --model <model> --system-prompt-file <tmpfile> --json-schema <schema>
```

prompt via stdin, env = inherited minus stripped credentials.

Differences that matter:

| Flag | t3code | ours | note |
| --- | --- | --- | --- |
| `--output-format` | `json` (one-shot) | `stream-json` | ours is deliberate: in-band `system/api_retry` events feed error classification (`claudeCode.ts:245-247`) — theirs cannot see those |
| `--effort` | **passed** | not passed | see §"effort" below |
| `--tools ""` | absent | passed | t3code's one-shot leaves default tools enabled *and* passes `--dangerously-skip-permissions` with `cwd` = repo — their "generate a commit message" call can execute tools unsupervised; ours is pure generation |
| `--json-schema` | argv JSON | argv JSON | same wire enforcement |
| system prompt | none (all-in-one user prompt) | `--system-prompt-file` | ours dodges ARG_MAX for long taxonomies |
| `--settings` inline JSON | passed | absent | thinking/fastMode/ultracode knobs |
| model suffix `[1m]` | supported | n/a | CLI accepts `model[1m]` for 1M context |

**The `--effort` finding (adopt-investigate, highest value in this table).** Our
adapter stamps `effort: null` — "headless claude has no effort knob"
(`claudeCode.ts:32-33, 145-150`). t3code passes `--effort` to `claude -p` today,
normalized per model and version-gated (models catalog gates opus-4-8 at CLI
≥ 2.1.154, `ClaudeProvider.ts:54-57`; we run 2.1.226). If `--effort` works on our
CLI version — one smoke run verifies it — the adapter can honor `Effort` and stop
declaring the capability gap, restoring ADR 0010's triage lever under ADR 0013 #5
honest-provenance rules. Verify billing is unchanged before adopting (an effort
flag should not change the auth/billing route, but the 2026-08-08 measurement
should be re-run once with the flag).

**Recommendation** on the rest: keep `--tools ""` and the system-prompt file
(t3code's tool-enabled, permission-skipping one-shot would violate our pure
generation + least-surprise posture); ignore `--settings`/`[1m]` until a concrete
need exists.

## 4. Structured-output enforcement

**t3code**: single shot. Decode the `-p --output-format json` wrapper for
`structured_output` (Effect Schema, `ClaudeTextGeneration.ts:54-59, 236-247`),
then decode that against the operation schema (`:249-261`). Any failure → one
`TextGenerationError`. **No salvage, no feedback retry, no failure dump** —
acceptable for a commit-message suggestion the user edits anyway. They rely
entirely on the CLI's own `--json-schema` enforcement; if the CLI exhausts its
internal retries they just fail.

**Ours**: `--json-schema` is a bonus layer; every terminal answer still passes
`runWithSchemaFloor` (validate → salvage → one feedback retry → dump + throw,
`claudeCode.ts:26-29, 177-217`), and `error_max_structured_output_retries` hands
the raw text back to the floor for salvage instead of failing
(`claudeCode.ts:271-283`).

**Recommendation: ignore (keep ours).** Their consumers are human-editable
suggestions; ours is a hard contract (ADR 0013 #3). Nothing to adopt; their
design confirms `--json-schema` + envelope `structured_output` is the stable CLI
surface to build on.

## 5. Error/retry taxonomy

**t3code**: no kind taxonomy. One-shot: nonzero exit → `TextGenerationError` with
**raw stderr (or stdout) interpolated into `detail`**
(`ClaudeTextGeneration.ts:206-217`) — under our no-secrets-in-errors rule that is
a leak vector we must not copy. Interactive: turn status derived from the result
envelope — `success` → completed; interrupted detected via
`terminal_reason: "aborted_tools" | "aborted_streaming"` plus error-string
heuristics; `"cancel"` substring → cancelled; else failed
(`ClaudeAdapter.ts:364-387, 1284-1297`). `system/api_retry` is treated as a
**liveness heartbeat** (surfaced as "still running", deliberately not a warning
after a 502 storm spammed their log — `ClaudeAdapter.ts:3325-3338`), never
classified. They filter `[ede_diagnostic]` CLI-internal telemetry out of
user-facing errors (`ClaudeAdapter.ts:352-362`).

**Ours**: `API_RETRY_KIND` maps in-band retry categories to `GeneratorErrorKind`
(auth/transient/config, `claudeCode.ts:47-57`), allowlisted rendering of untrusted
subtype/category strings (`claudeCode.ts:64-90`), envelope-less exits classified
from the last seen retry category (`claudeCode.ts:252-267`).

**Recommendation: keep ours; adopt two small facts.** (a) `terminal_reason`
(`aborted_tools`/`aborted_streaming`) and (b) the `errors[]` array with
`[ede_diagnostic]` entries exist on current result envelopes — neither appears in
our envelope parsing (`claudeCode.ts:350-368`). We don't need them today (our
aborts are our own kill ladder, not CLI-side), but they belong in
`docs/dev/harness-cli-capabilities.md` as known envelope fields so a future
parser change doesn't treat them as drift.

## 6. Timeout/kill handling

**t3code**: one-shot — a single 180 s overall `Effect.timeoutOption` around
spawn-to-exit (`ClaudeTextGeneration.ts:48, 222-234`); no inactivity watchdog, no
kill ladder, no process-group signalling, no stdout cap (streams folded into an
unbounded string, `:68-81`). Interactive — no timers at all on the session (it is
user-driven); cleanup is `query.interrupt()` with 3 s/10 s `timeoutOption` guards
around background-task stops (`ClaudeAdapter.ts:4405-4462`), a 30-min idle-session
reaper (`ProviderSessionReaper.ts:17-18`), and a 25 s ceiling on the capability
probe (`ClaudeProvider.ts:573`), raised from 8 s because Bedrock init blew it —
a data point that our 10 s probe default (`probe.ts:37-39`) may be tight for
operators on Bedrock-like backends (not our supported route, but worth a config
note).

**Ours**: hard wall-clock (15 min) + output-inactivity watchdog (3 min) +
SIGINT → grace → SIGKILL ladder against the process **group** (detached spawn),
first-terminal-cause-wins, 16M-unit stdout cap (`run.ts:27-31, 119-124, 139-199,
249-269`).

**Recommendation: keep ours, no adoption.** t3code's model tolerates hangs (a
human is watching and can interrupt); ours runs unattended jobs with a lived
codex-hang precedent (`run.ts:14-15`). Their lack of a group kill or output cap
would be regressions for us.

## 7. Served-model verification

**t3code**: none. `modelUsage` is read only to derive the effective context
window and token counters for display (`ClaudeAdapter.ts:393-405, 439-445,
2174`). What they do instead is **version-gate the request side**: the model
catalog is filtered by parsed `claude --version` against per-model minimums
(2.1.219 for opus-5, 2.1.169 for fable-5, 2.1.154 for opus-4-8 —
`ClaudeProvider.ts:54-57, 338-356`), so a user cannot request a model the CLI
would silently substitute.

**Ours**: post-run `modelUsage`-keys-vs-requested check; mismatch or missing
usage logs a warning and fires `onModelMismatch`, stamp stays the declaration
(`claudeCode.ts:306-323`).

**Recommendation: keep ours; version-gating is a plausible probe add-on, low
priority.** A minimum-CLI-version check in our boot probe (we already run
`--version` and discard the string, `probe.ts:48-73`) would turn "requested model
too new for this CLI" into a boot-time `ConfigError` instead of a per-run
mismatch warning — but our mismatch hook already surfaces it, so this is polish.

## 8. Billing-relevant invocation differences

Nothing in t3code is *defensively* different — they are strictly more exposed
than we are:

- Same auth substrate: inherited keychain OAuth login (`claude auth login`,
  README.md), no token injection, no `setup-token`.
- **No env credential strip** — the BRIEF-140 hole is open in their codebase; a
  stray `ANTHROPIC_API_KEY` reroutes their billing silently.
- Their one-shots add `--dangerously-skip-permissions` and leave tools on —
  irrelevant to billing, worse for safety.
- Their only billing-adjacent mechanism is **observability**: the never-yielding
  SDK init probe reads `account.subscriptionType`/`tokenSource`/`apiProvider`
  without triggering an API request (`ClaudeProvider.ts:703-773`) and shows it in
  the UI.

**For `docs/self-host/generators.md`**: two additions are worth making. (1) The
`CLAUDE_CONFIG_DIR`-not-`HOME` isolation gotcha (§2). (2) An "investigate"
follow-up: if the init/account surface is reachable from our stream-json path, a
boot-probe assertion "tokenSource is subscription OAuth" would verify the billing
route positively instead of inferring it from env stripping — the strongest
possible answer to the residual `apiKeyHelper` hole (`run.ts:390-392`).

---

## Recommendation summary

| # | Difference | Verdict |
| --- | --- | --- |
| 1 | Persistent SDK session / stream-json input | Ignore for the adapter (conflicts with one-shot + kill-ladder + abort invariants); investigate `--resume` only for the feedback retry's cache reuse |
| 2 | No credential strip; UI-surfaced billing route | Keep BRIEF-140 strip; investigate init-time account read for positive billing-route verification; adopt `CLAUDE_CONFIG_DIR` doc note |
| 3 | `--effort` on `claude -p` | **Adopt after one smoke verification** — restores the effort lever our adapter documents as impossible |
| 3 | Tools-on + `--dangerously-skip-permissions` one-shots | Ignore (regression for pure generation) |
| 4 | Single-attempt schema handling | Ignore (our floor is the product guarantee) |
| 5 | `terminal_reason` / `errors[]` / `[ede_diagnostic]` envelope fields | Adopt as documentation in harness-cli-capabilities.md |
| 6 | 180 s single timeout, no ladder/cap | Ignore (regressions for unattended runs); note their 8 s→25 s probe-timeout lesson |
| 7 | CLI-version model gating instead of served-model check | Keep ours; optional probe polish |
| 8 | Billing invocation | No defensive difference to copy; we are the stricter implementation |
