# BRIEF-59 — Generation-quality eval harness

Status: planned (2026-07-18). Grill locked in-session (7 decisions below).
Ticket: BRIEF-59 (Notion, In progress). Gates: BRIEF-55 fix, base-prompt
splitting promotion, future BRIEF-52/MERGEBRIEF.md prompt changes.

## Problem

Every prompt/schema change is vibes-verified — no regression net over
generation quality. FP cost rose with BRIEF-43 (soft gate lists every
current-head flag in front of authors). Grouping/labeling quality is model
judgment: not unit-testable (categorizer suite is FakeGenerator/deterministic
by design), and the BRIEF-13 spike proved single-run comparisons measure
run-to-run variance, not change quality.

## Locked decisions (grill, 2026-07-18)

1. **Mechanical-only scoring.** No LLM judge in v1 (judge variance + spend;
   addable later behind the same report format). Writing quality out of scope.
2. **Property checklists per case**, not similarity indices. Chunk boundaries
   are model output — "expected label per chunk" has no stable join key.
   Properties anchor on stable facts: group-count bounds, file→group-role
   bindings, group order relations, attribute must/must-not-fire (per file),
   concern-of-file. Each case ships `expected.ts` exporting typed predicates
   over the parsed `Brief`. Vocabulary grows per fixture need, never
   speculatively.
3. **On-demand local runs only.** Trigger: any generation-surface change
   (`prompt.ts`, output schema, validators/salvage, repo-config injection,
   output-affecting adapter defaults), new fixture landing, model-version
   bump. Convention gate, not enforced: AGENTS.md line "prompt-surface diff ⇒
   run `pnpm eval`, report in PR body". No CI live calls, no cron. (Possible
   later: textual-only CI check for a missing report — not v1.)
4. **N=5 runs per case.** Baseline classes per property: stable-pass (5/5),
   flaky (1–4/5), stable-fail (0/5). Branch verdicts: stable-pass failing
   ≥2/5 = REGRESSION; 1/5 = WARN (rerun case to resolve). Flaky = delta
   reported, never gates. Stable-fail passing = IMPROVEMENT (promotion
   evidence). Rule-based on purpose — n=5 has no statistical power; we
   detect cliffs, not drifts. `--runs` override exists but verdicts only
   at ≥5.
5. **Eval sources checked in, replayable offline.** Per case: cached diff
   (`.patch`), PR metadata JSON, any `.mergebrief/` inputs. No GitHub at
   eval time; only live calls are the generations. Own-repos-only (repo goes
   public at BRIEF-38) — rule recorded in the eval README. Location:
   `tools/categorizer/eval/` (no new package, no CI-matrix entry). Baselines
   (`baseline.json` per case) checked in, keyed `provider:model`; cross-key
   comparison refused; v1 maintains the Anthropic day-to-day key only.
   Re-baseline = explicit `eval --rebaseline`, committed and reviewed like a
   snapshot update.
6. **Output = measurement, never action.** Terminal report (quiet when
   clean), `report.json` + paste-ready markdown block (the convention-gate
   artifact; the shape a future textual CI check would read). Exit code
   non-zero iff ≥1 REGRESSION — the sole automation. No auto-rebaseline; no
   auto prompt changes; promotions stay manual decisions with the report as
   evidence.
7. **Cost shown, never capped.** Pre-flight line ("5 cases × 5 runs = 25
   generations") before the first call. Report shows token totals via a new
   optional `onUsage` callback where adapters have usage; × price only if a
   `provider:model` row exists in eval config (no hardcoded prices — they
   stale and mis-inform). claudeCode/codex rows say "subscription — see
   provider usage page", never $0. No `--max-spend`, no mid-run cutoff.

## Contract facts (verified in code)

- `Generator.generate` returns the parsed object only; usage is not in the
  contract (`packages/generators/src/contract/generator.ts`). Anthropic
  adapter logs `input_tokens`/`output_tokens`/`cache_read` but discards them;
  openaiCore/openrouter don't capture usage; claudeCode/codex are CLI
  subprocess adapters with no reliable per-call usage.
- Categorizer test suite is FakeGenerator-based (deterministic) — the harness
  is deliberately the only live-call surface.
- Seed cases (ticket): components-repo `cross-service` FP (BRIEF-55), a
  monorepo multi-package PR, a pure-move PR, a schema-change PR, plus the
  Button under-split fixture (`Idan91/components` PR #10 @ `3110bbb`) with
  its dormant `unresolved-reference` probe noted.

## Mandated skills (user-confirmed)

- **git-eng** — ALL git operations (branch, commits, push, PR). No ad-hoc git.
- **typescript-eng** — strict TS; no `any`/bare `as`; named exports; Result
  for expected failures; `as const` maps.
- **tdd** — harness logic (property engine, baseline compare, verdict rules,
  report rendering) built test-first on vitest with fake run results. Live
  generations obviously excluded from tests.
- **jq** — report.json inspection recipes in the eval README.

## Git flow (git-eng, user-confirmed)

- Branches `feature/BRIEF-59/<part>`, stacked in dependency order on main.
- Chunked commits per logical unit. Reviewer gates: **fable-reviewer** on
  each PR branch diff before opening the PR; performance-reviewer pre-commit
  where staged code warrants it (offline tooling — expected rarely).
- 3 PRs, ready-for-review, Idan merges. Per-branch lint before push; judge
  by exit codes. Squash-merge stack maintenance per the established
  rebase --onto recipe.

## PR breakdown

### PR 1 — `onUsage` contract + adapter capture (~200 LOC)

`packages/generators`: optional `onUsage?: (usage: TokenUsage) => void` on
`GenerateRequest`; `TokenUsage` = input/output/cacheRead token counts.
Anthropic wires its existing response usage; openaiCore + openrouter add
capture; claudeCode/codex untouched (never call it). Unit tests per adapter
fake. **Additive only — no call-site changes elsewhere in the monorepo.**

- Model/effort: Sonnet, medium — mechanical, contract is settled.
- Invocation: main thread (small; not worth a subagent).

### PR 2 — harness core (~600–800 LOC)

`tools/categorizer/eval/`: case loader (fixture dir → generation inputs),
run executor (N generations via the categorizer's real prompt/parse/validate
path, serial; no cooperative AbortSignal — `categorize()` doesn't accept
one, and threading it through is not worth the signature change for a
local tool where Ctrl-C kills the process and serial runs bound waste to
one in-flight call — amended at implementation), property engine (run `expected.ts`
predicates over each parsed Brief), baseline load/compare/classify, verdict
rules (decision 4), report rendering (terminal + `report.json` + markdown
block), `--rebaseline`, `--runs`, pre-flight count line, cost accumulation
via `onUsage` + optional price config. `pnpm -C tools/categorizer eval`.
TDD throughout on faked run results; one placeholder fixture for loader
tests.

- Model/effort: **Fable, high** — verdict semantics, property-engine API,
  and report shape are the design-carrying surface.
- Invocation: main thread, sequential after PR 1 (consumes `onUsage`).

### PR 3 — eval sources + baselines + convention gate (~300 LOC code/docs + fixture data)

Five seed cases: cached diffs + PR meta + `.mergebrief/` inputs + authored
`expected.ts` each. Generate baselines live (Anthropic key, 5×5 = 25
generations) and commit `baseline.json`s. Eval README (fixture format,
own-repos rule, jq recipes, price-config example). AGENTS.md convention-gate
line (root + `tools/categorizer`). Ticket links updated.

- Model/effort: **Fable, high** — authoring properties IS the judgment work
  (a badly written property poisons every future verdict); diff caching is
  mechanical but small.
- Invocation: main thread, sequential after PR 2. Baseline generation needs
  Idan's live key in env — coordinate before this part starts.

## Verification

- Per PR: package typecheck + test + lint, exit-code judged; dependent-suite
  rule (root CLAUDE.md) — PR 1 touches `packages/generators`, run
  `tools/categorizer` suites locally too.
- End-to-end (PR 3): one full `pnpm eval` invocation on main = all-clean
  report + a deliberate prompt perturbation run showing a REGRESSION line,
  screenshot/paste into the PR.

## Risks / notes

- **Baseline flakiness at n=5:** first real baselines may classify several
  properties flaky (that's signal, not failure — the Button case is *known*
  to coin-flip). Do not tune properties until baselines exist.
- **Spend:** ~25 generations per full invocation + 25 for the perturbation
  check in PR 3. Report's own cost line is the tracking.
- **Model bump invalidates baselines** — re-baseline is the documented
  response, not editing properties.
- codex CLI quota (memory: exhausted until ~07-23) is irrelevant here — v1
  baselines are Anthropic-only by decision 5.
