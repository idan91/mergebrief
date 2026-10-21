# packages/generators — agent notes

The `Generator` port and its adapter family: structured generation — `(schema, system, user) → object valid against the schema` — behind one contract, with six interchangeable adapters.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

What the layout can't show:

- `Effort` and `Generation` live in `contract/generation.ts`.
- Three leaf subpaths sit beside the entry: `generators/generation` (`contract/generation.ts`, zod and `types` only) carries the origin vocabulary to the Brief types, `generators/instance-policy` (`config/instancePolicy.ts`, which owns `RUNTIME_MARKER_VAR`) reads the instance policy without loading an adapter, and `generators/trackers` (`config/trackers.ts`) carries the tracker schemas to `brief-core`, `repo-config` and the worker; `config/consts.ts` holds the other config constants, so no leaf imports the registry.
- `createGenerator` construction returns `Result` (`config/registry.ts`); the yaml dep lives only in `config/readRoot.ts`.
- Every adapter's output passes through `validation/` (`runWithSchemaFloor`: validate → recover → one feedback retry → dump + throw).
- Harness spawns use no shell, with watchdog timers and a kill ladder (`harness/run.ts`); `test/shims/` fakes the CLI binary, not the spawn.
- No composition root lives here: `createGenerator`, `loadConfig` and `harness/run.ts` (`HarnessRunArgs.env`) take `env` explicitly, and the process roots that read `process.env` are the worker's `main.ts`, `tools/categorizer`'s CLIs (`src/cli/`, `eval/cli.ts`) and `smoke/`.
- `smoke/` is manual live smoke, NEVER wired into vitest/CI.

Config shape for operators: `mergebrief.config.example.yaml` (repo root) and `docs/self-host/generators.md`.

## Glossary (the vocabulary carried on the exported symbols)

- **Schema floor** (`runWithSchemaFloor`): the hard guarantee — output is schema-valid or the generation throws; native provider enforcement is a bonus layer, never the mechanism.
- **Salvage** (`salvageDroppableEnums`): recovery step inside the floor — invalid entries in caller-designated array fields are dropped (warn-and-drop) instead of failing the whole generation.
- **Harness**: the subprocess machinery under the claude-code/codex/cursor adapters only; API adapters never touch it.

## Invariants (enforced, don't weaken)

- **The structured-output floor is hard**: every adapter must return schema-valid output or throw — never a silent text-mode degrade.
- **Abort is not a failure**: an abort rejection propagates to the caller untouched — no salvage, no feedback retry, no failure dump.
- **Origin is honest**: `Generation` records what was requested/declared; capability gaps (no effort knob, unknown served model) surface rather than being papered over.
- **Warnings are typed**: every degradation a generation survives calls `req.onWarning` with a `GeneratorWarning` (`contract/types.ts`) beside its log line; callers never parse log lines. A warning's `message` never carries the failure-dump path, a key or a credentialed URL; those stay in the log line.
- **Errors name an env VAR, never its value.** Untrusted provider/CLI strings reach messages only through allowlists or `redactSecrets`.
- **No credential env var reaches a CLI spawn**: every harness spawn (generation AND startup check) goes through `envForSpawn`, which strips `HARNESS_STRIPPED_CREDENTIAL_VARS` (a leaked var outranks the CLI's own login and silently rebills generations to an API/cloud account). Two deliberate survivors: `CLAUDE_CODE_OAUTH_TOKEN` (claude's subscription route) and `CURSOR_API_KEY` (bills the same subscription pool). Residual hole: `apiKeyHelper` lives in the CLI's settings file, unreachable from env; generation skips user settings, so it reaches only the boot `claude auth status` check.
- **Every harness spawn runs in an empty cwd**: generation and startup check alike spawn in a fresh empty dir under `~/.cache/mergebrief/harness` (`harness/work-dir.ts`), never the shared `/tmp` whose parent `CLAUDE.md` any local user could write, removed after; files a CLI reads by path sit beside that dir, never in it. No run leaves a resumable session behind: codex runs `--ephemeral`, claude `--no-session-persistence` (each temp cwd would otherwise mint its own `~/.claude/projects` folder holding the prompt).
- **No operator CLI config reaches a generation**: claude runs `--setting-sources ""` with `--strict-mcp-config` and `--disable-slash-commands`, so user settings, hooks, plugins, MCP servers and skills stay out; codex runs `--ignore-user-config --ignore-rules -c features.hooks=false` (a `~/.codex/hooks.json` loads apart from `config.toml`). A user-level hook would otherwise run on every generation and see the PR diff. cursor-agent has no such switch.
- **Construction returns `Result`; `generate()` throws** — a misconfigured instance refuses boot, never limps into jobs.

## Tests

`test/contract.ts` is the shared Generator conformance suite; each adapter runs it through its own transport fake. Brief-schema integration stays in `packages/brief-core/test` — importing the domain schema here would cycle.

## Verification

`pnpm -C packages/generators smoke -- --adapter <name>` is manual live smoke, never wired into vitest or CI.
