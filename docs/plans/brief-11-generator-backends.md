# Plan — BRIEF-11: Composable generator backends (registry, harness CLIs, API providers, instance config)

> Status: **READY — wayfinder map closed 2026-07-12, not started.**
> Ticket: Notion BRIEF-11; map: "Wayfinder map: Generator backends (BRIEF-11)"
> (all 7 decision tickets closed 2026-07-12).
> ADRs: **0030** (harness-CLI generator adapters, new), **0013 as amended
> 2026-07-12** (registry, instance-level selection, config substrate), **0006 as
> amended 2026-07-12** (per-repo YAML killed → instance file).
> Research notes: `docs/dev/harness-cli-capabilities.md`,
> `docs/dev/harness-cli-deployed-feasibility.md`.
> Grills ran with Fable pre-cutoff; design is locked — execution does not
> require Fable.

## What this delivers (product + technical context)

**Product:** the single `AnthropicGenerator` becomes a composable backend
family behind the same `Generator` port: agent-harness CLI adapters
(`claude -p`, `codex exec`) that ride the user's existing subscription
**locally only**, and API-provider adapters (OpenAI, OpenRouter) for BYOK,
selected per instance by one optional YAML file. Zero-config keeps today's
behavior exactly (Anthropic API + `ANTHROPIC_API_KEY`, Opus 4.8).

**Technical:** four moves. (1) extract **`packages/generators`** — port +
vocabulary + AnthropicGenerator + a shared schema-floor pipeline + a static
registry with async `createGenerator`. (2) harness-CLI adapter family over a
shared process-execution core (timers, kill ladder, floor pipeline).
(3) OpenAI + OpenRouter adapters over an internal OpenAI-compatible core.
(4) instance-level config loader (`mergebrief.config.yaml` via
`MERGEBRIEF_CONFIG`), boot fail-fast, `GENERATOR_API_KEY_ENV` killed, plus the
docs/UI mandates the map accumulated.

## Locked decisions (map 2026-07-12 — do not re-litigate)

Full detail lives on the map's tickets; gists here, contracts inline where
implementation needs them.

1. **Registry + construction seam.** Static compiled-in `as const` registry;
   each entry = provider literal + Zod options schema + `create(opts, deps)`.
   Config discriminated union (`z.discriminatedUnion("provider", …)`) is
   **derived from the registry** — single source of truth for vocabulary,
   config schema, unknown-provider errors. `satisfies` + generic entry helper;
   no `as`, no dynamic loading. "Add an adapter" = one class + one options
   schema + one registry entry. `createGenerator(config, { env, failureDir,
   log })` is **async**, returns `Result<Generator, ConfigError>`; composition
   roots stay the only `process.env` readers and convert to loud boot throw.
   `apiKeyEnv` exists on API-provider schemas only (defaults:
   `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY`); missing key
   = `Result` error naming the **var name only**. Harness entries probe
   `<cli> --version` + auth preflight at construction — boot fails loudly,
   never limps into jobs. `model` = instance config with per-adapter defaults;
   **Anthropic default stays Opus 4.8** (Sonnet cost knob documented loudly).
   `GenerateRequest` stays model-free (ADR 0010 triage = future amendment).
   Provenance stays a static construction-time declaration; provider
   vocabulary gains `claude-code` / `codex`. All three construction points
   migrate: `packages/worker/src/main.ts`,
   `apps/web/src/features/brief/generate.server.ts` (bespoke
   `MissingApiKeyError` collapses into the uniform error), and the categorizer
   CLI (`tools/categorizer`) — critical: harness adapters are local-only, so
   CLI/local dogfood is their primary entry.
2. **Harness-CLI adapters (ADR 0030).** Thin `ClaudeCodeGenerator` +
   `CodexGenerator` classes over one shared harness-execution core (spawn,
   timers, kill, validate→salvage→retry pipeline). Always spawn streaming
   (`claude -p --output-format stream-json --verbose
   --include-partial-messages`; `codex exec --json`) — the event stream is the
   watchdog's liveness signal. No shell; argv array; prompt piped via stdin
   then closed. Two timers, both required: hard wall-clock **15 min** +
   output-inactivity **3 min**, per-adapter tunable in instance config.
   AbortSignal → SIGINT, SIGKILL after 5 s grace; abort rejection propagates
   untouched. Native schema flags (claude `--json-schema` reusing the
   enum-preserving schema from `outputFormat.ts`; codex `--output-schema
   <tempfile>`) are a **bonus layer** — core always Zod-validates. Retry = ONE
   fresh-process invocation with failed output + errors stitched into the
   prompt (no session resume). Codex answer needs a **double parse** (JSON
   string inside `item.text`). Lockdown profiles: codex `--sandbox read-only
   --skip-git-repo-check --ephemeral`; claude WITHOUT `--bare` (OAuth is the
   point; `--bare` reads only API-key auth) — exact isolation ladder
   (`--tools ""` etc.) settled at implementation. Effort: codex
   `-c model_reasoning_effort=<low|medium|high>` (**flag existence UNVERIFIED
   — verify at implementation**, fall back to null-treatment); claude-code
   `effort: null` v1 (no headless effort knob; ADR 0010 loses its effort lever
   there). Provenance: the CLI **is** the provider; `model` = requested id;
   claude verifies post-run via `modelUsage` (mismatch → warning log + UI
   surfacing, stamp unchanged); codex silent-reroute blind spot documented in
   README. Boot probe gains auth preflight (`claude auth status` exits 0/1;
   codex equivalent probed at implementation, `auth.json` presence as weak
   fallback). Local-only v1 — deployed mode is a separate future ticket, never
   v1 (ToS analysis in `harness-cli-deployed-feasibility.md`).
3. **API-provider adapters.** Both on the official `openai` npm SDK
   (OpenRouter via `baseURL` override); internal non-exported
   `OpenAiCompatibleCore` owns request build, strict `json_schema` from Zod v4
   `z.toJSONSchema`, streaming + heartbeat logging, floor pipeline. Wire
   surface = chat completions. Always `response_format: { type:
   "json_schema", strict: true }` + core Zod validation; no `json_object` or
   text fallback ever. OpenRouter: construction-time preflight (`/models`
   metadata) requires `structured_outputs` in `supported_parameters`, else
   config-error `Result`; every request carries forced non-overridable
   `provider.require_parameters: true`. OpenAI: `/models/{id}` preflight for
   key validity + existence only (endpoint has NO capability metadata —
   verified); schema capability fail-fasts at first generate. Option schemas:
   OpenAI `{ provider: "openai", model?, apiKeyEnv?, baseURL? }` (baseURL =
   documented local-model escape hatch — vLLM/Ollama/LM Studio/Groq; preflight
   downgrades missing-metadata to warnings); OpenRouter `{ provider:
   "openrouter", model, apiKeyEnv?, providerRouting? { order, only, ignore,
   allowFallbacks } }`; `transforms` excluded from v1. Attribution headers
   (HTTP-Referer / X-Title = MergeBrief) hardcoded. Effort: OpenRouter sends
   `reasoning: { effort }` only when preflight-cached `supported_parameters`
   includes `reasoning`; OpenAI sends `reasoning_effort` always, on a 400
   naming the param retries once without and caches "no knob" for instance
   lifetime; dropped knob recorded as capability gap in provenance. Provenance
   keeps the full declared slug (OpenRouter vendor prefix NOT stripped);
   served-model mismatch recorded. SDK built-in retries only — no adapter
   backoff loop. AI-SDK = planned-only slot (promotion trigger: Bedrock/Vertex
   auth need or a model unreachable via the three shipped families). **Both
   adapters ship in this execution ticket.**
4. **Shared floor pipeline.** One `runWithSchemaFloor` (name at impl) in
   `packages/generators`: Zod validate → salvage (`salvageDroppableEnums`,
   `salvageFields`) → one feedback retry → failure dump to
   `<failureDir>/<label>-*.failed.json`. Per-core `attempt(feedback?) → { raw,
   parsed? }` closure absorbs transport differences (API feedback turn vs
   fresh CLI process). AnthropicGenerator migrates onto it. Abort passthrough
   untouched (ADR 0006 #6).
5. **`GeneratorError` taxonomy (reconciled at plan assembly).** `generate()`
   keeps throwing; `Result` at construction only. One `GeneratorError` with
   `kind`:
   `auth | config | provider-transient | timeout | schema-floor | refusal | cli-missing | opaque`.
   Harness classification from in-band JSON where available (claude
   `system/api_retry` categories + `errors[]`), else `opaque` + stderr tail.
   API mapping: 401/403 → `auth`; model-404 / response_format-unsupported 400
   / OpenRouter 402-credits / no-provider-available → `config`; 429/5xx after
   SDK retries → `provider-transient`; structured-outputs `refusal` field →
   `refusal`; pipeline exhaustion → `schema-floor`. Timer fire → `timeout`.
   AnthropicGenerator adopts the same class during migration.
6. **Instance config.** One optional YAML, conventional name
   `mergebrief.config.yaml` next to the compose file; `MERGEBRIEF_CONFIG` env
   var points at it. v1 `generator:` block = `provider` (discriminator) +
   `apiKeyEnv` (API arms only) + `model` (optional) + `options` (per-adapter;
   harness timer tunables live here). **No `tiers` block** (triage ticket adds
   it with its consumer). `loadGeneratorConfig(env)` in `packages/generators`
   (the `yaml` dependency lives there only); worker + web compose it into
   their existing `loadConfig(env)`. Every boot-knowable problem refuses boot
   with per-field issues, values omitted (existing ConfigError pattern):
   config path set but unreadable, schema failure, `apiKeyEnv` var unset,
   harness probe/auth-preflight failure. Env var unset → zero-config defaults.
   Web dogfood follows the same rule. **`GENERATOR_API_KEY_ENV` is killed**
   (YAML `apiKeyEnv` replaces it). Strict unknown-key reject at root and
   inside `generator:`; single `x-*` root-key carve-out (compose convention).
   Categorizer CLI gets explicit `--config <path>` (file < flags), NO ambient
   `MERGEBRIEF_CONFIG` honoring — and doubles as a fast config validator.
   MergeBrief thin-client CLI (ADR 0028) untouched — never constructs a
   generator. New naming uses MergeBrief casing from birth (pre-release sweep
   = separate board chore).
7. **Testing strategy.** Fake at the **process boundary**, not spawn: real
   child processes, fake binaries. Shims
   `packages/generators/test/shims/fake-claude.js` + `fake-codex.js`, scenario
   via `SHIM_SCENARIO` env (valid, invalid-json, hang, slow-drip, auth-error,
   ignores-sigint, envelope-drift, exit-code variants); tests inject the
   shim's absolute path as the command. Timeout durations + kill-ladder delay
   are injectable core config (tests pass tens-of-ms). Timer tests = scaled
   real timers; assert behavior (error kind, signal, marker file), never
   durations; keep 10x ratios between tiers. Typed conformance suite:
   `describeGeneratorContract(name, makeHarness)` in
   `packages/generators/test/contract.ts`; `GeneratorContractHarness`
   interface (generic over adapter extensions). Contract cases: valid
   passthrough; salvage without second attempt; retry-once with feedback;
   throw+dump after second failure; abort propagates untouched;
   `GeneratorError.kind` classification; provenance shape. API adapters fake
   at **fetch level** (custom `fetch` into the `openai` SDK client; canned
   HTTP fixtures; no new mocking libraries). **AnthropicGenerator keeps its
   stub-client fake** — deliberate asymmetry, unchanged tests are the
   characterization anchor during migration; mandate: code comment + testing
   note with promotion trigger (wire-level bug escapes or next substantive
   SDK-client change). Manual live smoke: thin tsx scripts under
   `packages/generators/smoke/`, excluded from vitest and CI entirely; recipe
   doc in `docs/dev/`. CI: new `generators-checks` job path-filtered on
   `packages/generators/` + workspace files; `packages/generators/` also added
   to the worker, categorizer, cli, and web job filters (the
   `packages/types/` precedent) — dependents run in CI by construction.

## Mandates

**Git — `git-eng` skill for ALL git operations** (requirements gathered
2026-07-12): branch per PR, stacked off the previous PR's branch,
`feature/BRIEF-11/<slug>`; PR titles `[BRIEF-11] <prefix>: <Title Case>`; Idan
merges. No `Co-Authored-By`, no AI attribution in commits or PR bodies.
Chunked commits per logical unit.
Pre-commit review gate: `security-reviewer` + `performance-reviewer` in
parallel on staged changes before every commit; findings ≥ 80 confidence →
fix and re-run. **LOC ceiling hard gate:** `git diff --stat` after every
part; ideal < 500, ceiling ~1000; exceeded → split (chores get their own PR).

**Specialist skills — mandatory (user-confirmed 2026-07-12):**
`typescript-eng` (all parts — registry typing, discriminated unions, new
package), `tdd` (shim/contract/timer tests, config loader, error mapping —
test-first), `verify` (runtime verification before committing nontrivial
parts: worker boot, config fail-fast, web dogfood), `claude-api`
(AnthropicGenerator migration + any Anthropic SDK-touching part).

## Review loop (mandatory per PR, user-confirmed 2026-07-12)

- **codex CLI (GPT 5.6 Sol, reasoning high)** inline review → address EVERY
  comment (fix + regression test, or reasoned pushback) → re-run until a pass
  has ZERO new findings.
- **Additionally, a dedicated security-focused review agent per PR** (beyond
  the pre-commit gate): injection/attack surface — child-process argv/stdin
  handling, prompt injection into CLIs, YAML config parsing, env-var key
  resolution, temp-file schema handoff, error-message secret hygiene.
- **Fable fallback for ALL review agents** when codex hangs (BRIEF-14/27/28
  lesson: codex hang → Fable-reviewer fallback).
- Upstream-first across the stack; rebase downstream immediately
  (force-with-lease with explicit `:sha`). CI green (`gh pr checks`) before a
  PR waits on Idan. Lint judged by exit code, per branch.

## Subtasks → PRs

Four subtasks, eleven PRs. Dependency spine: PR 1 → 2 → 3 → {B: 4 → 5 → 6}
∥ {C: 7 → 8} → 9 → 10 → 11. **Invocation:** Subtask A sequential in the main
thread (each PR consumes the previous contract). Subtasks B and C are
independent of each other — run B in the main thread and C via a parallel
subagent (or sequentially if review bandwidth is the constraint). Subtask D
sequential in the main thread after B + C merge.

**Model + effort per PR** (design is locked; Fable window closed — nothing
requires it):

| PR | Model / effort | Why |
|---|---|---|
| 1 generators-extraction | Opus medium | Mechanical move + CI wiring; risk is import churn, not design |
| 2 floor-pipeline-contract | Opus high | Characterization must hold while AnthropicGenerator migrates; contract factory typing |
| 3 registry-create-generator | Opus high | Registry generics without `as`; three composition roots; error union |
| 4 harness-core-shims | Opus high | Process lifecycle IS the risky code: timers, kill ladder, classification |
| 5 claude-code-adapter | Opus high | Envelope parsing + modelUsage verification + lockdown profile subtleties |
| 6 codex-adapter | Opus high | Double-parse, unverified flags to probe, provenance blind spot |
| 7 openai-core-adapter | Opus high | Shared core + strict json_schema + 400-sniff effort fallback |
| 8 openrouter-adapter | Opus medium | Pattern-following on PR 7's core; preflight + routing options |
| 9 instance-config | Opus high | Boot fail-fast surface across worker/web/CLI; strict-reject semantics |
| 10 ui-surfacing | Opus medium | Render generation status events + adapter class; follow existing FE patterns |
| 11 docs-smoke | Opus medium | Writing + thin tsx scripts |

### Subtask A — packages/generators: extraction, pipeline, registry

#### PR 1 — `feature/BRIEF-11/generators-extraction` (~600–900 LOC, mostly moves)

1. New `packages/generators` (workspace package, vitest + oxlint wiring,
   AGENTS.md seed). Move: `Generator` port + `GenerateRequest` + `Logger`
   (`tools/categorizer/src/generator.ts`), port vocabulary (`Effort`,
   `Generation` from categorizer `types.ts`), `AnthropicGenerator`,
   `salvage.ts` + `outputFormat.ts` (as Anthropic-adapter internals; note
   harness adapters will reuse the enum-preserving schema — export
   accordingly).
2. Categorizer + worker + web imports update; no behavior change
   (characterization: existing tests move with the code and stay green).
3. CI: new `generators-checks` job (typecheck + test) path-filtered on
   `packages/generators/` + workspace files; add `packages/generators/` to
   the worker, categorizer, cli, and web job filters (`packages/types/`
   precedent in ci.yml).

#### PR 2 — `feature/BRIEF-11/floor-pipeline-contract` (~500–800 LOC, stacked)

1. `runWithSchemaFloor` shared pipeline (validate → salvage → retry-once →
   dump) around an injected `attempt(feedback?) → { raw, parsed? }` closure.
2. `GeneratorError` class with the reconciled `kind` union (decision 5);
   AnthropicGenerator migrates onto the pipeline + error class. Stub-client
   tests stay untouched (characterization anchor) — add the asymmetry code
   comment + promotion trigger.
3. `describeGeneratorContract(name, makeHarness)` +
   `GeneratorContractHarness` in `test/contract.ts`; Anthropic harness is the
   first consumer (fold existing tests in as the migration seed).

#### PR 3 — `feature/BRIEF-11/registry-create-generator` (~500–800 LOC, stacked)

1. `as const` registry (Anthropic entry first) + generic entry helper;
   derived `z.discriminatedUnion("provider", …)` config union; provider
   vocabulary gains `claude-code` / `codex` tokens (types only until PRs 5–6).
2. Async `createGenerator(config, { env, failureDir, log })` →
   `Result<Generator, ConfigError>`: `apiKeyEnv` resolution (var name only in
   errors), harness boot-probe slot (wired in PR 4–6).
3. Migrate the three construction points: worker `main.ts`, web
   `generate.server.ts` (collapse `MissingApiKeyError`), categorizer CLI.
   Zero-config default = Anthropic + `ANTHROPIC_API_KEY` + Opus 4.8 —
   `GENERATOR_API_KEY_ENV` stays functional until PR 9 kills it.

### Subtask B — harness CLI adapters

#### PR 4 — `feature/BRIEF-11/harness-core-shims` (~700–1000 LOC, stacked; gate: shims+tests > 1000 → split shim suite into its own PR)

1. Shared harness-execution core: argv spawn (no shell), prompt via stdin
   then close, streaming event consumption seam, injectable timers (hard
   15 min / inactivity 3 min defaults), SIGINT → 5 s → SIGKILL ladder,
   fresh-process retry hook into `runWithSchemaFloor`, stderr capture +
   partial-output dump, `GeneratorError` classification, boot probe helper
   (`--version` + auth preflight).
2. `test/shims/fake-claude.js` + `fake-codex.js` with `SHIM_SCENARIO`
   matrix; SIGINT-recording shim (marker file via env).
3. Scaled-real-timer tests: hang → watchdog (`kind: "timeout"`); slow-drip →
   activity resets watchdog, hard timeout still bounds; ignores-sigint →
   SIGINT recorded AND SIGKILL exit.

#### PR 5 — `feature/BRIEF-11/claude-code-adapter` (~400–700 LOC, stacked)

1. `ClaudeCodeGenerator`: stream-json envelope parsing (`structured_output` /
   `result`, `subtype` handling incl.
   `error_max_structured_output_retries`), `--json-schema` handoff (reuse
   enum-preserving schema), lockdown profile (no `--bare`; settle isolation
   ladder — `--tools ""` etc.), `system/api_retry` category → `kind` mapping,
   `modelUsage` trust-but-verify (mismatch → warning log + surfacing hook),
   auth preflight via `claude auth status`, provenance
   `{ provider: "claude-code", model: <requested>, effort: null }`.
2. Registry entry + contract harness + adapter-specific tests on
   `fake-claude`.

#### PR 6 — `feature/BRIEF-11/codex-adapter` (~400–650 LOC, stacked)

1. `CodexGenerator`: JSONL consumption (last `agent_message` `item.text` +
   double parse), `--output-schema` tempfile handoff (cleanup + no secrets in
   path), `--sandbox read-only --skip-git-repo-check --ephemeral` profile,
   `-c model_reasoning_effort` (**verify the flag exists**; absent →
   null-treatment), auth preflight (probe codex equivalent; `auth.json`
   presence as weak fallback), provenance
   `{ provider: "codex", model: <requested> }` + reroute blind-spot note.
2. Registry entry + contract harness + adapter tests on `fake-codex`.

### Subtask C — API-provider adapters (parallelizable with Subtask B)

#### PR 7 — `feature/BRIEF-11/openai-core-adapter` (~600–900 LOC, stacked on PR 3)

1. Internal `OpenAiCompatibleCore` (official `openai` SDK, injected fetch,
   chat completions, strict `json_schema` via `z.toJSONSchema`, streaming +
   heartbeat logging, `runWithSchemaFloor` wiring, HTTP-status →
   `GeneratorError.kind` mapping, attribution headers).
2. `OpenAiGenerator`: `/models/{id}` preflight (key validity + existence),
   `reasoning_effort` with 400-sniff retry-once + instance-lifetime "no knob"
   cache + provenance capability gap, `baseURL` escape hatch (preflight
   downgrades to warnings when set).
3. Registry entry + contract harness (fetch-level fixtures) + adapter tests
   (request construction, error mapping, SDK retry visibility).

#### PR 8 — `feature/BRIEF-11/openrouter-adapter` (~400–600 LOC, stacked)

1. `OpenRouterGenerator` on the core: `/models` preflight requiring
   `structured_outputs` (cache `supported_parameters` for reasoning gating),
   forced `provider.require_parameters: true` on every request,
   `providerRouting` options, `reasoning: { effort }` gating, provenance full
   slug + served-model mismatch recording.
2. Registry entry + contract harness + adapter tests.

### Subtask D — instance config, UI surfacing, docs

#### PR 9 — `feature/BRIEF-11/instance-config` (~500–800 LOC, stacked on B+C)

1. `loadGeneratorConfig(env)` in `packages/generators` (`yaml` dep there
   only): `MERGEBRIEF_CONFIG` → `mergebrief.config.yaml`; registry-derived
   `generator:` union incl. harness timer tunables; strict unknown-key reject
   root + block; `x-*` root carve-out.
2. Worker + web compose into their `loadConfig(env)`; **kill
   `GENERATOR_API_KEY_ENV`**; boot fail-fast per decision 6 (web included).
3. Categorizer CLI `--config <path>` (file < flags precedence, no ambient
   env honoring) — doubles as config validator + loader dogfood.
4. Tests: loader table (all fail-fast arms), precedence, zero-config
   defaults, unknown-key rejection, `x-*` pass.

#### PR 10 — `feature/BRIEF-11/ui-surfacing` (~300–600 LOC, stacked)

1. Map mandates: retry/salvage events explicit in logging + generation
   status surfaced in the web UI; UI visibly distinguishes harness-CLI runs
   from API/SDK runs (render adapter class, not just provider token); claude
   `modelUsage` mismatch warning surfaced.
2. Follow existing FE conventions (exported prop interfaces, facade hooks
   where heavy); tests per existing web harness.

#### PR 11 — `feature/BRIEF-11/docs-smoke` (~400–700 LOC, stacked)

1. Smoke scripts `packages/generators/smoke/` (per adapter or `--adapter`
   flag): one real `generate()` with a tiny schema, prints provenance,
   nonzero exit on floor violation; excluded from vitest + CI.
2. `docs/dev/` smoke recipe (run before release, after CLI version upgrades,
   after adapter changes; what it covers that CI cannot).
3. README + config docs: **local-only harness boundary stated loudly**
   (wording seeded from `harness-cli-deployed-feasibility.md` — subscription
   ToS is the reason; revisit triggers listed there), full config surface
   (file, `MERGEBRIEF_CONFIG`, `--config`, precedence, zero-config default,
   `x-*` carve-out), Anthropic Sonnet cost knob, codex provenance blind spot,
   retry/salvage visibility note, isolation/lockdown story per CLI.

## Deferred (planned slots — do NOT build)

- **AI-SDK adapter** — promotion trigger: Bedrock/Vertex-style auth need or a
  model unreachable via Anthropic/OpenAI/OpenRouter.
- **cursor-agent / opencode adapters** — one class + one registry entry each
  when promoted; capabilities note flags their envelope/provenance gaps
  (conformance smoke gate mandatory).
- **`tiers` config block** — lands with the ADR 0010 triage consumer.
- **Per-run observed provenance** — trigger: codex reroute caught mattering.
- **Deployed harness mode** — separate board ticket, never v1; re-read the
  feasibility note's revisit triggers first.

## PR budget sanity

| PR | Est. LOC | Gate |
|---|---|---|
| 1 generators-extraction | 600–900 | moves dominate; > 1000 → split CI wiring off |
| 2 floor-pipeline-contract | 500–800 | — |
| 3 registry-create-generator | 500–800 | > 900 → composition-root migration splits off |
| 4 harness-core-shims | 700–1000 | > 1000 → shim suite + timer tests split off |
| 5 claude-code-adapter | 400–700 | — |
| 6 codex-adapter | 400–650 | — |
| 7 openai-core-adapter | 600–900 | > 900 → OpenAiGenerator splits from core |
| 8 openrouter-adapter | 400–600 | — |
| 9 instance-config | 500–800 | — |
| 10 ui-surfacing | 300–600 | — |
| 11 docs-smoke | 400–700 | mostly markdown; scripts > 300 code → split |

## Verification (every PR)

```sh
pnpm -C packages/generators typecheck && pnpm -C packages/generators test
pnpm -C tools/categorizer typecheck && pnpm -C tools/categorizer test   # PRs 1-3, 9 (+ locally whenever generators contracts change)
pnpm -C packages/worker typecheck && pnpm -C packages/worker test       # PRs 3, 9
pnpm -C apps/web typecheck && pnpm -C apps/web test                     # PRs 3, 9, 10
pnpm lint    # exit code is the judge; per stacked branch
```

CI path filters close the dependents gap for `packages/generators` from PR 1
onward — but until PR 1 merges, and for any cross-package contract this plan
doesn't cover, the CLAUDE.md local-run duty stands.

End-to-end (after PR 9; `verify` skill drives the runtime): zero-config boot
(worker + web) still works with only `ANTHROPIC_API_KEY`; a
`mergebrief.config.yaml` selecting each adapter boots or refuses correctly
(bad provider, missing key var, unknown key, missing CLI each refuse with
per-field issues); categorizer CLI `--config` validates the same file. Manual
live smoke per adapter (PR 11 recipe): claude (OAuth), codex (login), OpenAI
+ OpenRouter (keys) each produce one schema-valid generation with honest
provenance; kill a hung run manually to confirm watchdog + kill ladder in the
real CLI once.

## Context for a fresh session (read before PR 1)

- **The port today:** `tools/categorizer/src/generator.ts` (`Generator`,
  `GenerateRequest`, `AnthropicGenerator` — the validate/salvage/retry loop
  that becomes `runWithSchemaFloor`); `salvage.ts`, `outputFormat.ts`
  (enum-preserving schema — server-enforcement lesson, PR #22);
  `types.ts` (`Effort`, `Generation`).
- **Construction points:** `packages/worker/src/main.ts`,
  `apps/web/src/features/brief/generate.server.ts`,
  `tools/categorizer/src/index.ts` + `delta-cli.ts`;
  `packages/worker/src/config.ts` (`GENERATOR_API_KEY_ENV` — dies in PR 9;
  its ConfigError pattern is the model for loader errors).
- **Research notes:** `docs/dev/harness-cli-capabilities.md` (envelopes,
  flags, exit codes, auth surfaces — the implementation crib for PRs 4–6),
  `docs/dev/harness-cli-deployed-feasibility.md` (README boundary wording +
  revisit triggers — the crib for PR 11).
- **ADRs:** 0030 (harness adapters), 0013 + 0006 as amended 2026-07-12,
  0010 (triage — future consumer), ADR 0006 #6 (abort semantics).
- **Repo rules:** CLAUDE.md (extensionless imports, no enum, Result vs
  throw, no secrets in errors, CI path-filter gotcha); per-package AGENTS.md.
- **Test gotchas (BRIEF-23/24/25 lessons):** CI is path-filtered per package;
  octokit throttling keeps module-global Bottleneck groups — never
  freeze/rewind `Date.now` in `packages/api` tests; docker/keychain fails
  sandboxed (docker-builds memory) — live smoke runs unsandboxed in a real
  terminal.
- **Out of scope (map-ruled):** hosted arm (ADR 0023); debounce/size/triggers
  block semantics (Comparison-overlay follow-ups ticket); MergeBrief
  naming sweep (board chore).
