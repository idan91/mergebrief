# Generator adapter live smoke (manual-only)

> **Never wire these into vitest or CI.** They spend real money, need live
> auth (OAuth keychains, `auth.json`, API keys), and CI runners have none of
> it. The suite-level guarantees live in `packages/generators/test/`; this
> recipe covers exactly what those tests CANNOT: real CLI binaries, real
> envelope drift across CLI upgrades, real auth surfaces, and the real
> providers' structured-output enforcement.

Every step in this file is `manual-forever: live provider auth and real
spend`: live-spend surfaces stay out of CI permanently, so no trigger
retires them. The disposition tags are therefore
stated once, here, rather than repeated per step; the one exception is
tagged where it sits.

## When to run

- **Before a release**: one pass over every adapter you ship.
- **After a CLI version upgrade** (`claude`, `codex`, `cursor-agent`): the envelope shapes
  are documented-but-unpromised (capabilities note); a bump can drift them.
- **After touching an adapter**: transport/envelope/classification changes.

## The command

One real `generate()` with a tiny schema; prints origin info and the output;
exit 0 = schema-valid output received, nonzero = ANY failure (schema-floor
violation, auth, timeout, refusal):

```sh
# API adapters (need the key env var set):
pnpm -C packages/generators smoke -- --adapter anthropic
pnpm -C packages/generators smoke -- --adapter openai --model gpt-5.2
pnpm -C packages/generators smoke -- --adapter openrouter --model anthropic/claude-sonnet-5.5

# Harness-CLI adapters (need the CLI logged in on THIS machine):
pnpm -C packages/generators smoke -- --adapter claude-code
pnpm -C packages/generators smoke -- --adapter codex
pnpm -C packages/generators smoke -- --adapter cursor   # `cursor-agent login`, or CURSOR_API_KEY

# Or validate + smoke an actual instance config (paths resolve relative
# to packages/generators because of -C, hence the ../..):
pnpm -C packages/generators smoke -- --config ../../mergebrief.config.yaml
```

Per-adapter checklist (each run):

1. Startup check passed (no "boot refused"; for CLIs that proves `--version`
   + auth preflight against the real binary).
2. Origin line is HONEST: the provider/model/effort you expected:
   `effort: null` where the knob doesn't exist (claude-code; models without
   `reasoning`), `codex-default` when codex runs its configured default.
3. Output printed and schema-valid (the floor validated it: enum tags
   only from the closed vocabulary).
4. Any `warning:` lines are explainable (served-model mismatch, effort-knob
   gap); these are the same lines that reach artifacts as
   `generationWarnings`.

## The deliberate hung-run kill (once per release)

The watchdog, the kill ladder and the stderr redaction are already
`automated: pnpm -r test` against the shims in `packages/generators`
(`harness.test.ts`). What stays `manual-forever` is the last mile the shims
cannot fake: a REAL CLI's process tree, grandchildren included:

1. Start a smoke run against a CLI adapter, and mid-run put the CLI's
   backend out of reach (drop the network, or `kill -STOP` the CLI process
   to fake a wedge).
2. Expect: the inactivity watchdog fires (default 3 min; configure
   `timeouts.inactivityMs` lower in a scratch config for a faster check;
   cursor's stream is silent until exit, so its watchdog defaults to the
   15-minute wall-clock `hardMs` unless you set `inactivityMs`),
   the run exits nonzero with a `timeout`-kind message carrying a redacted
   stderr tail, and **no orphan processes remain** (`pgrep -f claude` /
   `pgrep -f codex` / `pgrep -f cursor-agent` is clean, because the process-group SIGKILL got the tree).
3. `kill -CONT` (if you used SIGSTOP) and clean up.

## What this covers that CI cannot

- Envelope fidelity: the shims mirror each CLI's envelope as last verified;
  a CLI upgrade can drift the real envelopes without failing any test.
- Auth reality: keychain/OAuth (claude), `auth.json` (codex), `cursor-agent login` or
  `CURSOR_API_KEY` (cursor). CI never has
  them; the boot probes only prove the SHIM's contract there.
- Provider enforcement: real `--json-schema` / `--output-schema` /
  `response_format` behavior at the providers, including their retry limits.
- The kill ladder against a real process tree (grandchildren included).
