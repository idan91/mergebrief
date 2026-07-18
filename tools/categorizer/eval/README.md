# Generation-quality eval harness (BRIEF-59)

Regression net over generation quality: labeled real-PR fixtures, N runs
per case, mechanical property checklists, provider:model-keyed baselines.
Design decisions in `docs/plans/brief-59-eval-harness.md`.

```sh
pnpm -C tools/categorizer eval                  # all cases, 5 runs each, compare vs baselines
pnpm -C tools/categorizer eval --case <id>     # one case
pnpm -C tools/categorizer eval --runs 1        # quick smoke (verdicts withheld under 5)
pnpm -C tools/categorizer eval --rebaseline    # rewrite baseline.json (review + commit the diff)
pnpm -C tools/categorizer eval --config <mergebrief.config.yaml>   # non-default generator
pnpm -C tools/categorizer eval --prices <json> # non-default price table
```

Exit codes: `0` clean · `1` ≥1 REGRESSION · `2` config/usage error.
Reports land in `out/eval-report.json` + `out/eval-report.md` (paste the
markdown block into the PR — see the convention gate below). Every
scored run's brief is persisted to `out/eval-runs/<case>/run-N.brief.json`
(N = true run number; failed runs leave gaps) for flaky-property
diagnosis — wiped per case per invocation, so a `--case` rerun refreshes
that case and leaves the others' specimens from the last full run.

## When to run (convention gate — not CI)

Run before merging any change to the generation surface: `src/prompt.ts`,
the output schema (`src/types.ts`), validators/salvage, repo-config
injection, or output-affecting adapter defaults. Also once when a fixture
lands (`--rebaseline` records its baseline) and after a model bump.
Include the report in the PR body. Never wired into CI — live API spend.

## Verdict rules (decision 4)

Baseline classes per property: stable-pass (5/5) · flaky (1–4/5) ·
stable-fail (0/5). Branch verdicts: stable-pass failing ≥2/5 =
**REGRESSION** (exit 1) · 1/5 = WARN (rerun the case) · flaky = delta,
informational, never gates · stable-fail now passing = IMPROVEMENT (the
promotion evidence for prompt experiments). Rule-based on purpose: n=5
detects cliffs, not drifts. Verdicts are withheld under 5 scored runs.

## Cases

`cases/<id>/` = `fixture.json` + `expected.ts` + `baseline.json`.

- `fixture.json` — a fully cached generation input (FetchedPr shape +
  commitRange + optional PARSED `repoContext`). No GitHub at eval time.
  Built from a real PR (or an explicit commit span) via ad-hoc `gh api`
  captures — provenance lives in the PR that added each case.
- `expected.ts` — `export const properties: EvalProperty[]`. Anchor on
  run-stable facts (files, group relations, attribute names, categories);
  NEVER on chunk boundaries or prose text. A throwing predicate counts as
  a fail with a note. Empty lists are rejected.
- `baseline.json` — pass counts from main, keyed `provider:model`.
  Cross-key comparison is refused; v1 maintains the Anthropic default key
  only. Re-baselining is an explicit reviewed commit.

**Corpus rule: own-repos only.** This repo goes public (BRIEF-38); every
checked-in diff must be publishable. No third-party diffs without a
license decision.

Seed corpus: `copybutton-new-export` (BRIEF-55 cross-service FP) ·
`button-under-split` (sub-file intent splitting; its diff also carries
the dormant `unresolved-reference` probe — App.tsx switches
`variant="primary"` to `type="primary"`, an invalid value that the
`{...props}` spread lets override `type="button"` while `variant`
silently stops being passed) · `pure-move-persistence` ·
`multi-package-types` · `schema-change-provenance`.

Added post-seed: `delta-read-api-contract` (BRIEF-66 positive
cross-service probe — modified EXISTING wire contracts from
code-review#45; baselined at 1/5, the measured post-BRIEF-55 under-fire
that a future gloss re-tune targets).

## Cost (decision 7)

Shown, never capped. Pre-flight prints the generation count; the report
prints token totals (via the generators' `onUsage`) and dollars only if
`eval/prices.json` has a row for the active `provider:model` — copy
`prices.example.json` and fill CURRENT rates (prices are deliberately
not hardcoded). CLI adapters (claude-code/codex) render as
"subscription", never $0.

Cache-read semantics differ per provider family and `priceUsage` accounts
for it: Anthropic's input tokens EXCLUDE cache reads (priced additively);
OpenAI-compatible providers report cached tokens INSIDE prompt_tokens
(the cached subset is re-priced by subtraction; without a cache rate the
whole prompt bills at the input rate — an overcount, never an
understatement).

## Inspecting report.json

```sh
jq '.regressions' out/eval-report.json
jq -r '.cases[] | .caseId as $c | .properties[] | select(.verdict != "unchanged") | "\($c): \(.id) \(.verdict) \(.passes)/\(.runs)"' out/eval-report.json
jq '.usage' out/eval-report.json
```
