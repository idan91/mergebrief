# packages/generators: agent notes

The `Generator` port and its adapter family: structured generation, `(schema, system, user) → object valid against the schema`, behind one contract, with six interchangeable adapters.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

What the layout can't show:

- `Effort` and `Generation` live in `contract/generation.ts`.
- Three leaf subpaths sit beside the entry: `generators/generation` (`contract/generation.ts`, zod and `types` only) carries the origin vocabulary to the Brief types, `generators/instance-policy` (`config/instancePolicy.ts`, which owns `RUNTIME_MARKER_VAR`) reads the instance policy without loading an adapter, and `generators/trackers` (`config/trackers.ts`) carries the tracker schemas to `brief-core`, `repo-config` and the worker; `config/consts.ts` holds the other config constants, so no leaf imports the registry.
- `createGenerator` construction returns `Result` (`config/registry.ts`); the yaml dep lives only in `config/readRoot.ts`.
- Every adapter's output passes through `validation/` (`runWithSchemaFloor`: validate → recover → one feedback retry → dump + throw). An attempt stopped at its output cap (`cut`: Anthropic `max_tokens`, OpenAI-compatible `length`, claude's envelope `stop_reason`) is screened, dumped and thrown as `output-cut`, with no salvage and no retry. `maxOutputTokens` is the most the caller wants: anthropic and claude (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`, only when given) send the lower of it and the model's ceiling (`readClaudeOutputCeiling`: 128000 for current Claude models, 64000 for any other id), anthropic sends 64000 when it is absent, the OpenAI-compatible adapters send none (the model's ceiling is unknown to them, a cap past it is refused, and `length` still marks a cut), and codex and cursor have no knob.
- `GenerateRequest.userPrefix` is text a run's requests share: anthropic sends it as the user message's first content block with a cache breakpoint, every other adapter prepends it to `user` with a blank line (`adapters/utils.ts`). A request without one sends the same bytes as before.
- Harness spawns use no shell, with watchdog timers and a kill ladder (`harness/run.ts`); `test/shims/` fakes the CLI binary, not the spawn.
- No composition root lives here: `createGenerator`, `loadConfig` and `harness/run.ts` (`HarnessRunArgs.env`) take `env` explicitly, and the process roots that read `process.env` are the worker's `main.ts`, `tools/categorizer`'s CLIs (`src/cli/`, `eval/cli.ts`) and `smoke/`.
- `smoke/` is manual live smoke, NEVER wired into vitest/CI.

Config shape for operators: `mergebrief.config.example.yaml` (repo root) and `docs/self-host/generators.md`.

## Glossary (the vocabulary carried on the exported symbols)

- **Schema floor** (`runWithSchemaFloor`): the hard guarantee: output is schema-valid or the generation throws; native provider enforcement is a bonus layer, never the mechanism.
- **Salvage** (`salvageDroppableEnums`): recovery step inside the floor: invalid entries in caller-designated array fields are dropped (warn-and-drop) instead of failing the whole generation.
- **Harness**: the subprocess machinery under the claude-code/codex/cursor adapters only; API adapters never touch it.

## Invariants (enforced, don't weaken)

- **The structured-output floor is hard**: every adapter must return schema-valid output or throw, never a silent text-mode degrade.
- **Abort is not a failure**: an abort rejection propagates to the caller untouched: no salvage, no feedback retry, no failure dump.
- **Origin is honest**: `Generation` records what was requested/declared; capability gaps (no effort knob, unknown served model) surface rather than being papered over.
- **Warnings are typed**: every degradation a generation survives calls `req.onWarning` with a `GeneratorWarning` (`contract/types.ts`) beside its log line; callers never parse log lines. A warning's `message` never carries the failure-dump path, a key or a credentialed URL; those stay in the log line. `req.redact`, when given, runs over every failure dump before the credential patterns, and `req.screenAttempt` sees each attempt's raw and parsed output before validation, salvage, a warning or the retry, its throw ending the generation: the caller holds the secret values, the floor does not.
- **Errors name an env VAR, never its value.** Untrusted provider/CLI strings reach messages only through allowlists or `redactSecrets`.
- **An API adapter takes its host from the Instance config, never ambient env**: the host is the Instance config's `baseUrl` or the provider's canonical one, and `authToken`, `organization`, `project` and `adminAPIKey` are null, so the SDKs never read `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` or the `OPENAI_*` host and account vars. `logLevel` is `SDK_LOG_LEVEL` (`warn`) on every client, so `ANTHROPIC_LOG` and `OPENAI_LOG` are ignored: at `debug` an SDK prints request bodies to the console, past the log boundary. `ANTHROPIC_CUSTOM_HEADERS` and `OPENAI_CUSTOM_HEADERS` stay honoured and merge over the auth headers, so they can change a credential on the pinned host but never the host. An Anthropic client comes from `createAnthropicClient`, never a bare `new Anthropic()`.
- **A CLI spawn gets only the allowlist**: every harness spawn (generation AND startup check) goes through `envForSpawn`, which passes `HARNESS_BASE_ENV_VARS`, `LC_*` and the adapter's own `*_CLI_ENV` (its login vars plus fixed off switches), nothing else. A request sets only a var its adapter's `requestVars` names, never read from the root env: claude's `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, from `maxOutputTokens`. The worker's secrets never reach a CLI that reads PR text, and no billing-redirect var is on any list (a leaked one outranks the CLI's own login and rebills to an API/cloud account). Two deliberate login vars: `CLAUDE_CODE_OAUTH_TOKEN` (claude's subscription route) and `CURSOR_API_KEY` (bills the same subscription pool). Residual hole: `apiKeyHelper` lives in the CLI's settings file, unreachable from env; generation skips user settings, so it reaches only the boot `claude auth status` check. Tests reach a shim's `SHIM_*` settings through `stubShimCommand` (a `sh` wrapper), never by widening an adapter's list.
- **Every harness spawn runs in an empty cwd**: generation and startup check alike spawn in a fresh empty dir under `~/.cache/mergebrief/harness` (`harness/work-dir.ts`), never the shared `/tmp` whose parent `CLAUDE.md` any local user could write, removed after; files a CLI reads by path sit beside that dir, never in it. The one exception is a config file the CLI reads from its cwd (`HarnessCwdFile`): cursor's deny-all `.cursor/cli.json`, written for generation and startup check alike. No run leaves a resumable session behind: codex runs `--ephemeral`, claude `--no-session-persistence` (each temp cwd would otherwise mint its own `~/.claude/projects` folder holding the prompt).
- **No operator CLI config reaches a generation**: claude runs `--setting-sources ""` with `--strict-mcp-config` and `--disable-slash-commands`, so user settings, hooks, plugins, MCP servers and skills stay out; codex runs `--ignore-user-config --ignore-rules` with `features.hooks=false` (a `~/.codex/hooks.json` loads apart from `config.toml`), the shell and other built-in tools off, and a `default_permissions` profile whose filesystem table keeps `CODEX_HOME`'s `auth.json` unreadable; codex expands no `$HOME`, so its paths are absolute. A user-level hook would otherwise run on every generation and see the PR diff. cursor-agent has no such switch, so its cwd's deny-all `.cursor/cli.json` refuses shell, read and fetch calls instead (writes are off in plan mode; MCP is on the deny list, blocking it is unverified, and user-level MCP servers still load); cursor enforces it, not the OS.
- **Construction returns `Result`; `generate()` throws**: a misconfigured instance refuses boot, never limps into jobs.

## Tests

`test/contract.ts` is the shared Generator conformance suite; each adapter runs it through its own transport fake. Brief-schema integration stays in `packages/brief-core/test`. Importing the domain schema here would cycle.

## Verification

`pnpm -C packages/generators smoke -- --adapter <name>` is manual live smoke, never wired into vitest or CI.
