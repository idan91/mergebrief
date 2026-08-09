# packages/generators — agent notes

The `Generator` port and its adapter family: structured generation — `(schema, system, user) → object valid against the
schema` — behind one contract, with five interchangeable adapters.

## Map

**Entry point: `src/index.ts`** — the package's only export
(`package.json` `exports["."]`); every public symbol is re-exported there,
grouped by folder. Start reading there.

```
src/
  index.ts                ENTRY — sectioned re-exports = the public surface
  contract/               what an adapter IS
    generator.ts            Generator interface, GenerateRequest, Logger
    provenance.ts           Effort, Generation (the origin stamp)
    errors.ts               GeneratorError + kinds, ConfigError
  config/                 how an instance CHOOSES an adapter
    registry.ts             provider registry + per-adapter option schemas
                            + createGenerator (construction = Result)
    loader.ts               mergebrief.config.yaml loader (yaml dep lives here)
  adapters/               the five implementations
    anthropic.ts            Anthropic SDK (streaming, the default)
    claudeCode.ts codex.ts  local-CLI adapters (run on the harness)
    openaiCore.ts           shared OpenAI-compatible streaming core
    openai.ts openrouter.ts assemblies on that core
  validation/             what every adapter's OUTPUT passes through
    enforceSchema.ts        runWithSchemaFloor: validate → recover →
                            one feedback retry → dump + throw
    enumRecovery.ts         salvageDroppableEnums (drop bad enum entries)
    jsonSchema.ts           enum-preserving strict JSON schema + parse
  harness/                how the CLI adapters RUN local binaries
    run.ts                  spawn (no shell), watchdog timers, kill ladder
    redact.ts               redactSecrets, harnessTimeoutError
    probe.ts                startup check (--version + auth preflight)
test/                     per-module suites; contract.ts = the shared
                          conformance suite every adapter runs; shims/ =
                          fake CLI binaries (fake the binary, not the spawn)
smoke/                    manual live smoke — NEVER wired into vitest/CI
```

Config shape for operators: `mergebrief.config.example.yaml` (repo root)
and `docs/self-host/generators.md`.

## Glossary (the vocabulary carried on the exported symbols)

- **Schema floor** (`runWithSchemaFloor`): the hard guarantee — output is
  schema-valid or the generation throws; native provider enforcement is a
  bonus layer, never the mechanism.
- **Salvage** (`salvageDroppableEnums`): recovery step inside the floor —
  invalid entries in caller-designated array fields are dropped
  (warn-and-drop) instead of failing the whole generation.
- **Harness**: the subprocess machinery under the claude-code/codex
  adapters only; API adapters never touch it.

## Invariants (enforced, don't weaken)

- **The structured-output floor is hard**: every adapter must
  return schema-valid output or throw — never a silent text-mode degrade.
- **Abort is not a failure**: an abort rejection propagates to
  the caller untouched — no salvage, no feedback retry, no failure dump.
- **Origin is honest**: `Generation` records what was
  requested/declared; capability gaps (no effort knob, unknown served model)
  surface rather than being papered over.
- **No secrets in errors**: error messages may name an env VAR, never echo
  its value, a key, or a connection string. Untrusted provider/CLI strings
  reach messages only through allowlists or `redactSecrets`.
- **No credential env var reaches a CLI spawn**: every harness
  spawn (generation AND startup check) goes through `envForSpawn`, which
  strips `HARNESS_STRIPPED_CREDENTIAL_VARS` — env credentials outrank the
  CLI's own login in its auth precedence, so a leaked var would silently
  rebill generations to an API/cloud account. `CLAUDE_CODE_OAUTH_TOKEN`
  deliberately survives (it IS the subscription route). Residual hole:
  `apiKeyHelper` lives in the CLI's settings file, unreachable from env.
- **Construction returns `Result`; `generate()` throws** — a misconfigured
  instance refuses boot, never limps into jobs.

## Conventions

Repo-wide rules apply (root `CLAUDE.md`): no `enum`, strict TS, no bare
`as`, Zod at boundaries, named exports, extensionless relative imports.
`zod` is imported as `zod/v4`.

## Tests

`test/contract.ts` is the shared Generator conformance suite; each adapter
runs it through its own transport fake — a stub SDK client (anthropic, the
characterization anchor), real fake-binary processes (claude-code/codex),
fetch-level SSE fixtures (openai/openrouter). The generic pipeline
mechanics are covered here; their integration with the real Brief schema
stays in `packages/brief-core/test` (the domain schema lives there —
importing it here would cycle).

## Verification

```sh
pnpm -C packages/generators typecheck
pnpm -C packages/generators test
pnpm lint                        # repo-root oxlint --type-aware
pnpm -C packages/generators smoke -- --adapter <name>   # MANUAL live smoke
```
