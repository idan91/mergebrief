# BRIEF-209 — Cursor CLI as a local harness generator: implementation plan

Goal: an operator generates briefs on a Cursor subscription the way they can on a
Claude or Codex one. One new harness adapter over the existing harness core —
fourth stamp of the template, no new invariants. All contract decisions were
locked on the BRIEF-209 wayfinder map (GO, 2026-08-27); contract facts are
execution-verified in `docs/dev/harness-cli-capabilities.md` §3 (binary
2026.08.25).

## Ground rules

- **Git operations go through the `git-eng` skill, explicitly, every time.**
  Requirements gathered up front:
  - Feature branches off `main`, stacked: `feature/BRIEF-209/cursor-adapter`
    then `feature/BRIEF-209/cursor-wiring` (based on the first).
  - Chunked commits: commit after each logical unit.
  - **Pre-commit gate: `security-reviewer` on the staged diff before every
    commit**; findings at confidence ≥ 80 get fixed and re-reviewed before the
    commit lands.
  - No `Co-Authored-By` trailers; no AI-attribution lines in PR bodies.
  - PR titles: `[BRIEF-209] feat: …` in Title Case. Push + PR creation are
    asked, not assumed.
- **Mandatory specialist skills (user-confirmed): `typescript-eng`, `tdd`.**
  Adapter logic is built test-first against the fake binary.
- Review lifecycle per the established stack flow: subagent review per PR, two
  rounds, address medium+ findings only; PR bodies pass `/unslop`; after both
  PRs are open, `watch-pr-stack` babysits the merges.
- **Reviewer mandate: compare against the existing harness generators**
  (`claudeCode.ts`, `codex.ts`, shared `harness/`). Classify every deviation:
  - **Worse** — naming, syntax, security, perf, etc. below the existing
    adapters' bar: correct it, align to the established pattern.
  - **Better** — naming, syntax, security, abstraction, perf, or compliance
    with lint rules / coding standards the existing adapters don't yet meet:
    keep it, and record a note for a follow-up PR that aligns the existing
    generators to the better way. Deviations never merge unclassified.
    Accumulated "better" notes become Part 3 — worked automatically in the
    same session once PRs 1–2 are done, not parked.
- Evals and live smoke are **Idan-run only** — the build prepares selections
  and commands, never spends.

## Adapter invariants (from `packages/generators/AGENTS.md` + ticket)

Schema floor is hard (`runWithSchemaFloor` on every terminal answer — cursor
has no schema flag, so it is the *only* enforcement); abort rejections
propagate untouched; honest origin stamp; no secrets in errors (untrusted CLI
strings only through allowlists or `redactSecrets`); every spawn including the
probe goes through `envForSpawn`; construction returns `Result`, `generate()`
throws; tests fake the binary, never the spawn.

## Part 1 — the adapter (PR 1: `feature/BRIEF-209/cursor-adapter`)

Model: Fable 5, high effort (quota fallback: Opus 5 high, note the
substitution). Main thread. Design-heavy: new stderr-prefix error taxonomy and
probe interpreters that neither existing adapter has.

Anchor on `codex.ts` (closer sibling than claude): free-function run
interpreter, optional model, prompt concatenation, probe const.

1. `packages/generators/src/adapters/cursor.ts` (~300–400 LOC), TDD loop with
   the shim:
   - **Argv:** `-p --output-format stream-json --mode plan --trust
     [--model <id>]`. System + user prompt via stdin (no system channel —
     system text is prepended to the user turn; feedback-retry stitching per
     codex). Spawn cwd = fresh empty temp dir, best-effort cleanup in
     `finally`. Never `--force`, no `--sandbox` (separate hardening ticket),
     never `--api-key` argv.
   - **Envelope:** answer at `.result` on the terminal `result` event; record
     `usage` tokens; read `system/init` for `apiKeySource` (log it) and
     `permissionMode`.
   - **Timeouts:** stream is pipe-silent until exit, so inactivity = hard via
     `HarnessTimeoutOverrides` (wall-clock + process-liveness only). Default
     hard timeout stands (15 min swallows ~9 s spawn overhead).
   - **Errors:** exit 1 + stderr prefixes, allowlist-rendered:
     `Authentication required` → AUTH; `Cannot use this model` /
     `error: unknown option` → CONFIG; else OPAQUE.
   - **Probe:** `CURSOR_PROBE` = `--version` + `about --format json` (`status`
     exits 0 even logged out). Auth verdict from output: null `userEmail` /
     `subscriptionTier` → refuse boot, hint `cursor-agent login` or
     `CURSOR_API_KEY`. Version floor 2026.08.25 warn-only — compare the
     `YYYY.MM.DD` prefix, ignore the `-hash` suffix. **`userEmail` must never
     reach a message or warning** — allowlist rendering, with a test pinning it.
   - **Origin:** codex pattern — `model` optional (set → stamp id, `auto`
     allowed; unset → no flag, stamp `"cursor-default"`). Effort is real via
     bracket override `model[effort=x]`, stamped. No mismatch hook — origin is
     unverifiable by design; one doc line says so.
   - **Env:** add `CURSOR_API_ENDPOINT` to `HARNESS_STRIPPED_CREDENTIAL_VARS`
     in `harness/run.ts`; `CURSOR_API_KEY` deliberately survives the strip
     (same subscription pool).
2. `packages/generators/test/shims/fake-cursor.cjs` (~250 LOC) — scenario
   matrix per `fake-claude.cjs`: envelopes (buffered-flush, matching the
   pipe-silent contract — no drip pacing, which would misstate it),
   stderr-prefix failures, silent hangs. SIGINT promptness lives in the
   live-smoke checklist, not the shim.
3. `packages/generators/test/cursor.test.ts` (~450–550 LOC) — argv assertions,
   envelope classification, stderr taxonomy, probe/auth interpreters (incl. the
   email-redaction pin), version-floor compare, effort bracket, ms-scale
   timeout injection.
4. This plan document rides here.

Estimated ~1,000–1,200 changed LOC. Over the ~500 ideal because tests + shim
(~700) ride with the source they cover (coverage floors live inside
`pnpm test`); splitting them out would ship untested code. Source alone is
~350.

## Part 2 — wiring + surfaces (PR 2: `feature/BRIEF-209/cursor-wiring`, stacked on PR 1)

Model: Opus 5, medium effort. Main thread, sequential after Part 1 (mechanical
plug-points, small diff). ~300–400 LOC.

1. `config/registry.ts`: `Providers` token, strict Zod options schema
   (`model?`, `effort?`, `command`, timeout overrides) + default command
   const, `GENERATOR_REGISTRY` entry (async `create` runs the probe),
   discriminated-union listing, `createGenerator` switch case, and the
   `HARNESS_PROVIDERS` set so the compose worker refuses it correctly.
2. `test/cursor.contract.test.ts` — shared `describeGeneratorContract` through
   a `GeneratorContractHarness`; `supportsRefusal: false` unless the shim work
   shows a distinct refusal signal.
3. Barrel export in `src/index.ts`; smoke CLI usage string in
   `smoke/generate-smoke.ts`.
4. `ProviderBadge`: `CLI` class tag + provider config, plus its test. Logo is
   the BRIEF-135 gap — use the named generic fallback; a real logomark is a
   design asset call for Idan, not this stack.
5. Docs + config: `docs/self-host/generators.md` (provider table + harness
   section: mode-plan lockdown, darwin keychain-persistence quirk, `~/.cursor`
   session-junk note, origin-unverifiable line), `mergebrief.config.example.yaml`,
   `.env.example` (`CURSOR_API_KEY` only — `CURSOR_API_ENDPOINT` is
   deliberately undocumented there: it is a stripped-at-spawn redirect
   var, not an operator knob, and an example line would invite setting it).

## Part 3 — align existing generators (PR 3: `feature/BRIEF-209/generator-alignment`, stacked on PR 2)

Runs automatically in the same session after Parts 1–2 finish — no separate
go. Scope: exactly the "better" notes accumulated by the reviewer mandate,
applied to `claudeCode.ts`, `codex.ts`, and the shared `harness/` core;
nothing else rides along. If zero "better" notes accumulate, this part is
skipped and the plan says so in the final report.

Model: Opus 5, medium effort (mechanical alignment to an already-approved
pattern). Main thread, sequential. Same commit strategy, pre-commit gate, and
review lifecycle as the other parts. Existing tests pin behavior — alignment
must be behavior-preserving; `pnpm -C packages/generators test` green is the
proof.

Accumulated notes (PR 1 review):

1. Conditional fields assigned, not spread — cursor builds `floorArgs` /
   `runArgs` as typed locals with `if`-assignments; `codex.ts` and
   `claudeCode.ts` still use `...(cond ? {...} : {})`. Align both.
2. Verb-first rename pair — `claudeVersionWarning` and `cursorVersionWarning`
   both violate the verb-first function-name rule; rename together (e.g.
   `build*VersionWarning`) so the floor-check pair stays symmetric.

Accumulated notes (PR 2 review):

3. Conditional-assignment alignment widens: the registry's claude-code
   `create` still spreads `...(deps.log ? { log } : {})`;
   `codex.contract.test.ts` / `claude-code.contract.test.ts` (and
   `contract.ts`'s own `generate()`) still use conditional spread for
   `signal`. Fold into note 1's scope.
4. Badge fallback tests for codex and cursor both pass on the model cell
   alone (`gpt-5.2-codex` / `cursor-default` contain the slug) — switch both
   to a model string that does not contain the provider token so the visible
   token pin is real.
5. Verb-first: the three test-file `deps(...)` helpers
   (claude-code/codex/cursor) rename together (e.g. `makeDeps`).
6. `codex.contract.test.ts` builds its handle as an inferred literal —
   type it as `ContractGeneratorHandle` like cursor's, when touched.

## Prepared for Idan (never run by the agent)

- **Eval-case selection:** new adapter default surface ⇒ scoped eval per the
  repo convention. Deliverable: the `--case <id>` list with per-case
  justification, ready to paste. Expect the no-system-role delta (system text
  lands in the user turn) — the likeliest quality gap vs claude; the selection
  should cover cases sensitive to system-prompt adherence.
- **Live smoke checklist** (subscription spend, one command each, from the
  audit addendum):
  1. `--mode ask` vs `--mode plan` JSON-compliance compare — switch modes only
     on evidence; `plan` stands until then.
  2. `--stream-partial-output` against a pipe — if deltas arrive, the
     inactivity watchdog can be restored in a follow-up.
  3. SIGINT promptness (harness ladder sends SIGINT first; SIGTERM ~16 ms is
     verified, SIGKILL backstops).
  4. `--trust` from an empty temp cwd — must not hang on a trust prompt.

## Out of scope

`--sandbox` hardening (board ticket, Priority: Later); ToS stance (BRIEF-211);
capability discovery (BRIEF-198); real provider logomark (BRIEF-135); deployed
harness runs (compose worker keeps refusing harness providers).

## Verification per PR

`pnpm -C packages/generators test` (coverage floor rides inside), `pnpm lint`
judged by exit code, `pnpm -w typecheck` or the package builds. Part 2 also
runs the `apps/web` suite for the badge test. CI's changed-plus-dependents
filter covers consumers; no un-declared mirror of this contract exists for
cursor specifically.
