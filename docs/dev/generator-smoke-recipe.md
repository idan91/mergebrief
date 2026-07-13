# Generator adapter live smoke (manual-only)

> **Never wire these into vitest or CI.** They spend real money, need live
> auth (OAuth keychains, `auth.json`, API keys), and CI runners have none of
> it. The suite-level guarantees live in `packages/generators/test/`; this
> recipe covers exactly what those tests CANNOT: real CLI binaries, real
> envelope drift across CLI upgrades, real auth surfaces, and the real
> providers' structured-output enforcement.

## When to run

- **Before a release** — one pass over every adapter you ship.
- **After a CLI version upgrade** (`claude`, `codex`) — the envelope shapes
  are documented-but-unpromised (capabilities note); a bump can drift them.
- **After touching an adapter** — transport/envelope/classification changes.

## The command

One real `generate()` with a tiny schema; prints provenance and the output;
exit 0 = schema-valid output received, nonzero = ANY failure (schema-floor
violation, auth, timeout, refusal):

```sh
# API adapters (need the key env var set):
pnpm -C packages/generators smoke -- --adapter anthropic
pnpm -C packages/generators smoke -- --adapter openai --model gpt-5.2
pnpm -C packages/generators smoke -- --adapter openrouter --model anthropic/claude-sonnet-5

# Harness-CLI adapters (need the CLI logged in on THIS machine):
pnpm -C packages/generators smoke -- --adapter claude-code
pnpm -C packages/generators smoke -- --adapter codex

# Or validate + smoke an actual instance config (paths resolve relative
# to packages/generators because of -C — hence the ../..):
pnpm -C packages/generators smoke -- --config ../../mergebrief.config.yaml
```

Per-adapter checklist (each run):

1. Boot probe passed (no "boot refused" — for CLIs that proves `--version`
   + auth preflight against the real binary).
2. Provenance line is HONEST: the provider/model/effort you expected —
   `effort: null` where the knob doesn't exist (claude-code; models without
   `reasoning`), `codex-default` when codex runs its configured default.
3. Output printed and schema-valid (the floor validated it — enum tags
   only from the closed vocabulary).
4. Any `warning:` lines are explainable (served-model mismatch, effort-knob
   gap) — these are the same lines that reach artifacts as
   `generationWarnings`.

## The deliberate hung-run kill (once per release)

The watchdog + kill ladder run against fake binaries in CI; confirm them
against a REAL CLI once:

1. Start a smoke run against a CLI adapter, and mid-run put the CLI's
   backend out of reach (drop the network, or `kill -STOP` the CLI process
   to fake a wedge).
2. Expect: the inactivity watchdog fires (default 3 min — configure
   `timeouts.inactivityMs` lower in a scratch config for a faster check),
   the run exits nonzero with a `timeout`-kind message carrying a redacted
   stderr tail, and **no orphan processes remain** (`pgrep -f claude` /
   `pgrep -f codex` is clean — the process-group SIGKILL got the tree).
3. `kill -CONT` (if you used SIGSTOP) and clean up.

## What this covers that CI cannot

- Envelope fidelity: the shims mirror `docs/dev/harness-cli-capabilities.md`;
  a CLI upgrade can drift the real envelopes without failing any test.
- Auth reality: keychain/OAuth (claude), `auth.json` (codex) — CI never has
  them; the boot probes only prove the SHIM's contract there.
- Provider enforcement: real `--json-schema` / `--output-schema` /
  `response_format` behavior at the providers, including their retry limits.
- The kill ladder against a real process tree (grandchildren included).
