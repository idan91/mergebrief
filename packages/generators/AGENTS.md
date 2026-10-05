# packages/generators — agent notes

The `Generator` port and its adapter family: structured generation — `(schema, system, user) → object valid against the schema` — behind one contract, with six interchangeable adapters.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

What the layout can't show:

- `Effort` and `Generation` live in `contract/generation.ts`.
- Two leaf subpaths sit beside the entry: `generators/generation` (`contract/generation.ts`, zod and `types` only) carries the origin vocabulary to the Brief types, and `generators/instance-policy` (`config/instancePolicy.ts`, which owns `RUNTIME_MARKER_VAR`) reads the instance policy without loading an adapter; neither leaf imports the registry.
- `createGenerator` construction returns `Result` (`config/registry.ts`); the yaml dep lives only in `config/readRoot.ts`.
- Every adapter's output passes through `validation/` (`runWithSchemaFloor`: validate → recover → one feedback retry → dump + throw).
- Harness spawns use no shell, with watchdog timers and a kill ladder (`harness/run.ts`); `test/shims/` fakes the CLI binary, not the spawn.
- No composition root lives here: `createGenerator`, `loadConfig` and `harness/run.ts` (`HarnessRunArgs.env`) take `env` explicitly, and the process roots that read `process.env` are the worker's `main.ts`, the brief-core CLIs and `smoke/`.
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
- **No secrets in errors**: error messages may name an env VAR, never echo its value, a key, or a connection string. Untrusted provider/CLI strings reach messages only through allowlists or `redactSecrets`.
- **No credential env var reaches a CLI spawn**: every harness spawn (generation AND startup check) goes through `envForSpawn`, which strips `HARNESS_STRIPPED_CREDENTIAL_VARS` (a leaked var outranks the CLI's own login and silently rebills generations to an API/cloud account). Two deliberate survivors: `CLAUDE_CODE_OAUTH_TOKEN` (claude's subscription route) and `CURSOR_API_KEY` (bills the same subscription pool). Residual hole: `apiKeyHelper` lives in the CLI's settings file, unreachable from env.
- **Construction returns `Result`; `generate()` throws** — a misconfigured instance refuses boot, never limps into jobs.

## Tests

`test/contract.ts` is the shared Generator conformance suite; each adapter runs it through its own transport fake. Brief-schema integration stays in `packages/brief-core/test` — importing the domain schema here would cycle.

## Verification

`pnpm -C packages/generators smoke -- --adapter <name>` is manual live smoke, never wired into vitest or CI.
