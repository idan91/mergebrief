# BRIEF-11 implementation notes (running)

> Maintained from PR 1 onward; committed as part of PR 11. Records only what
> the plan doesn't already say: resolved unknowns, deviations with rationale,
> review-loop fallbacks, and surprises the next session would trip on.

## Review-round ledger (rounds to zero findings)

| PR | rounds | headline catches |
|---|---|---|
| 1 extraction | 2 | test-placement cycle avoidance |
| 2 floor-pipeline | 11 | SDK eager-parse latent production bug |
| 3 registry | 4 | secret-echo gates (provider/key tokens) |
| 4 harness-core | 11 | kill(0) self-signal; post-close ladder; stdout bound; redaction shapes |
| 5 claude-code | 0+4 | salvage unreachable via invalidReason; prototype-key category lookup |
| 6 codex | 0+1 | fatal-event answer voiding; non-string text drift |
| 7 openai-core | 0+5 | truncated-SSE acceptance; salvage bypass of the stop invariant; effort-cache race; cause-chain leak |
| 8 openrouter | 0+1 | transport-aware knob backstop |
| 9 instance-config | 0+3 | YAML warning-channel source leak; unset ≠ empty |
| 10 ui-surfacing | 0+2 | OpenRouter mismatch log routing; own-property class lookup |
| 11 docs-smoke | — | (this PR) |

"0+N" = codex round 0 ran on the LOCAL diff pre-push (adopted after PR 4
per Idan's round-count feedback), then N post-push rounds.

## Resolved unknowns

- **codex `model_reasoning_effort` exists** (needed for PR 6): it is a real
  config key — `~/.codex/config.toml` carries `model_reasoning_effort =
  "high"` and `-c model_reasoning_effort=high` is accepted by
  `codex exec` 0.144.x. Values low|medium|high.
- **codex CLI had to be upgraded for the review loop**: 0.142.5 rejects
  `gpt-5.6-sol` ("requires a newer version of Codex", HTTP 400). Ran
  `codex update` → 0.144.1 (standalone self-updater at
  `~/.codex/packages/standalone`). Review loop runs on 0.144.1.

## Plan deviations

- **PR 4 shims are `.cjs`, not `.js`** (plan names `fake-claude.js`):
  `packages/generators` is `"type": "module"`, and the shims use `require`.
- **`modelUsage` nested metrics are camelCase** (`inputTokens`/`costUSD`,
  Agent SDK `ModelUsage` shape) — the capabilities note's `cost_usd`
  citation was the envelope-level field naming, not per-model. The PR 5
  adapter reads only the model-id KEYS (trust-but-verify), so this is shim
  fidelity, not adapter behavior. Re-verify against a live
  `--output-format json` run during manual smoke (PR 11 checklist).

- **PR stack shape:** one strict linear stack PR 1 → 11 (PR 7 stacks on
  PR 6), replacing the plan's B ∥ C parallel note — per run directive, keeps
  rebases and review order sane.
- **PR 1 test placement:** `salvage.test.ts` and `output-format.test.ts` did
  NOT move to `packages/generators` with their sources — they pin the real
  `BriefGenerationSchema`, and importing it from `generators` would create a
  workspace cycle (categorizer → generators → categorizer). They stay in
  `tools/categorizer/test` importing from `"generators"`; CI still runs them
  on generators changes via the new path filter. `generator.test.ts`
  (self-contained schema) moved with the code.
- **PR 1 strictness upgrade:** `packages/generators/tsconfig.json` includes
  `test/**` (the packages/* convention; categorizer's tsconfig never
  typechecked its tests). Three `noUncheckedIndexedAccess` guards added to
  the moved `generator.test.ts` — behavior unchanged.

- **PR 9 deviation — flat `generator:` block:** decision 6's early sketch
  nested per-adapter settings under `options:`; the shipped YAML block is
  the registry-derived FLAT union (provider/model/apiKeyEnv/timeouts/…
  at block level). Rationale: the PR-9 spec line says "registry-derived
  union", the flat registry schemas shipped reviewed through PRs 3–8,
  and a nesting layer would add an indirection users must type with no
  strictness gain. Revisit trigger: an adapter whose option surface
  grows big enough to want namespacing.

## Review-loop fallbacks

- **Round-count lever adopted mid-run (after PR 4, per Idan):** review
  rounds were substituting for implementation-time rigor on stateful code.
  From PR 5 on: (a) invariants written before code and every event handler
  audited against them; (b) a pre-review race-matrix self-pass (terminal
  causes × event orderings, each cell needs a winner + test); (c) codex
  "round 0" runs against the LOCAL diff before the first push, so its
  findings fold into the main commits.

- **codex `exec` hangs on an unclosed stdin pipe**: launched from a
  background shell it printed "Reading additional input from stdin..." and
  blocked indefinitely before starting (PR 4 round 7). It reads piped
  stdin IN ADDITION to the prompt argument and waits for EOF. Fix: always
  invoke review runs with `< /dev/null`. This is the same hang class the
  BRIEF-14/27/28 run hit — cause now identified, no Fable fallback needed.
- Otherwise no codex hangs (0.144.1 stable).
- **codex usage limit hit at PR 11 round 1** (ChatGPT plan limit, resets
  2026-07-20): fell back to a Fable reviewer agent with the identical
  prompt + settled dispositions, per the run directive. All prior rounds
  (PRs 1–10 and PR 11 round 0) were genuine codex/gpt-5.6-sol runs.
- **PR 5 converged in round 0 + 4 rounds** (vs PR 4's 11) with the new
  discipline: codex round 0 on the local diff folded 5 findings into the
  base commits pre-push; the remaining rounds trended medium→low. The
  headline round-1 catch: `invalidReason` on the CLI-rejected path made
  salvage unreachable — floor-contract knowledge worth keeping in prompts
  for PRs 6–8.
- **claude 2.1.207 flag verifications for PR 5** (help text + probe):
  `--system-prompt-file` exists (recognized; errors on a missing file);
  `--json-schema` is argv-inline only; `--tools ""` + `--verbose` +
  `-p --output-format stream-json` verified in help.
- **PR 4 ran ELEVEN rounds to zero findings** — but unlike PR 2's epsilon
  tail, rounds 5–10 each surfaced a REAL defect (spawn-gap kill(0)
  self-signal, fired-grace-timer double-SIGKILL, falsy abort reasons,
  Basic/Cookie/JWT/quoted/JSON redaction gaps, post-close ladder,
  unbounded stdout, spawn-code misclassification). Concurrency state
  machines are where the reviewer earns its keep; the round-count lever
  above (invariants first, race-matrix self-pass, round 0 on local diff)
  is aimed exactly here.
- **packages/persistence timeouts seen during this stack** (`freshDatabase`
  5s; DIFFERENT tests each run) were read as a stale-dev-db problem at the
  time. That reading was wrong — the suite is hermetic PGlite and never
  touches the dev database. BRIEF-114 found the real causes (per-test
  migration cost plus leaked PGlite instances) and fixed both.
- **PR 2 ran ELEVEN rounds to a genuine `[]`**: rounds 1–2 surfaced real
  bugs (headline: the SDK eager-parse salvage bypass), rounds 7–10 were
  guards-of-guards epsilon (`Symbol.toPrimitive`-throwing candidates).
  Two pacing levers adopted for PRs 3+: (a) disposition history goes in
  the FIRST review prompt, and (b) pushed-back items count as settled
  unless the reviewer rebuts the recorded rationale.

## Surprises / gotchas for the next session

- **`block-destructive.sh` hook matches keywords ANYWHERE in a Bash
  command, including heredoc text**: a review-prompt append containing
  the word "truncate" was blocked (no stderr). Rephrase the text (e.g.
  "clipped") rather than fighting the hook.

- **Anthropic SDK ≥0.101 parses structured output EAGERLY at message_stop**
  (`lib/MessageStream` → `maybeParseMessage` → `parseOutputFormat`, which
  throws when `output_config.format` carries a `parse` member — and still
  JSON.parses without one). Consequence: passing a parseable format object
  to `messages.stream()` turns an invalid output into a stream REJECTION
  that bypasses any wrapper salvage/retry. This was a LATENT PRODUCTION BUG
  in the pre-BRIEF-11 AnthropicGenerator too (stub-client tests couldn't
  see it). Fix pattern (PR 2): send the bare enum-preserving JSON schema
  (`enumPreservingJsonSchema`), accumulate text deltas as the raw fallback,
  and convert the SDK's `AnthropicError: Failed to parse structured output…`
  rejection into a pipeline-visible failed attempt. Found by codex review.
- **Codex review loop rounds converge slowly on quality-shaped findings** —
  rounds 1/2 each produced real fixes plus repeat items already
  pushed back; treat "no NEW findings" (repeats with recorded pushback
  excluded) as the exit condition, per plan.
- **`gh pr diff` serves STALE content for ~5s after a push** — two review
  rounds (PR 3 r3, PR 4 r3) re-reported already-fixed findings because the
  re-exported diff predated the fix commit. Guard adopted: after every
  push, poll `gh pr diff` until it contains a marker string from the new
  commit before launching the reviewer.
- **Codex re-review prompts must carry the pushback history.** Each
  `codex exec --ephemeral` run is stateless; with a static prompt it
  re-derives the same already-pushed-back findings every round (PR 2 saw
  the same 4 items across rounds 2–4). From PR 3 on: append a "known
  dispositions — do not re-report unless you can rebut the rationale"
  section to the re-review prompt.

- **macOS: signalling a never-spawned ChildProcess kills YOUR OWN process
  group.** During the async ENOENT window (`spawn` returned, `error` event
  not yet delivered), `child.pid` is `undefined` but the internal handle
  still exists with pid 0 — `child.kill(sig)` becomes `kill(0, sig)`, which
  signals the CALLER's entire process group. Symptom: vitest worker AND the
  invoking shell die silently mid-run (11 dots then nothing, no error
  output, subsequent chained commands never execute). Fix (PR 4 round 5):
  `signalTree` returns early when `pid === undefined` — a child that never
  spawned has nothing to signal; `child.kill` is only the fallback for a
  live child whose group kill failed. Regression test: "lets an abort
  during the spawn gap beat an ENOENT rejection".

- **CI billing blocker persists** (same as BRIEF-24/25): every Actions job
  on PR #83 fails in ~2 s with "recent account payments have failed or your
  spending limit needs to be increased" — jobs never start. Nothing
  run-side can fix it. Mitigation: full local verification per PR (all
  dependent suites + lint by exit code); re-check `gh pr checks` across the
  stack once billing is fixed, before merging.

- `tools/categorizer` has a vestigial `pnpm-lock.yaml` of its own; the root
  workspace lockfile is the real one. Left untouched.

## Carried into later PRs

- **apps/web full-object error logging — RESOLVED in PR 10**: both
  generate.server.ts sinks now log `errorMessage(error)` (message-only;
  the `errorMessage` helper sits next to GeneratorConfigurationError).
  PR 7 had already sanitized causes at the source (openai core); the web
  change is the defense-in-depth layer (worker logged this way all along).

## CONFLICT LOG (updated at every stack rebase)

_(no conflicts yet)_

### Hot spots (files touched by 3+ PRs)

- `packages/generators/src/lib.ts` — touched by PR 1 (created), PR 2
  (floor/errors exports); every adapter PR (3, 5, 6, 7, 8, 9) appends
  exports. THE merge-time conflict magnet: resolution is always "union of
  both export lists".
- `packages/generators/package.json` — PR 1 (created), PR 2 (types dep);
  PR 7 adds `openai`, PR 9 adds `yaml`. Resolution: union of dependency
  lists, keep alphabetical order.
