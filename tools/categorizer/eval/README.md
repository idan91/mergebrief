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

Run before merging any change to the generation surface:
`packages/brief-core/src/generation/prompt.ts`, the output schema
(`packages/brief-core/src/types.ts`), validators/salvage, repo-config
injection, or output-affecting adapter defaults. Also once when a fixture
lands (`--rebaseline` records its baseline) and after a model bump.
Include the report in the PR body. Never wired into CI — live API spend.

**Scoped by default** (BRIEF-87): gate with one `--case <id>` run per
case whose properties could plausibly move — the flag takes a single
id (a repeated `--case` silently keeps only the last), and each
invocation overwrites `out/eval-report.{json,md}`, so capture the
report between runs. Justify the selection in the PR body — e.g. an
intent-check-only change is honestly gated by the six `intent-*` cases
(six runs). Run the full suite for prompt-wide changes (shared prompt
sections, output schema, salvage) and model bumps, where any property
could move. An honestly-scoped run beats the real alternative at
full-suite prices: not gating at all.

## Prose-length note (BRIEF-148)

Every case report carries a length-compliance note when any run's
artifact stamps `lengthViolations` (the warn-only prose floor); silence
means every run fit the caps. Pair cases report base/revised sides
separately. For a cross-model length check, the harness refuses
cross-key runs before spend — use the one-off spot script instead
(length numbers only, no property verdicts):

```sh
pnpm -C tools/categorizer exec tsx eval/spot-brief148.ts <config.yaml> <caseId> <runs>
```

## Verdict rules (decision 4)

Baseline classes per property: stable-pass (5/5) · flaky (1–4/5) ·
stable-fail (0/5). Branch verdicts: stable-pass failing ≥2/5 =
**REGRESSION** (exit 1) · 1/5 = WARN (rerun the case) · flaky = delta,
informational, never gates · stable-fail now passing = IMPROVEMENT (the
promotion evidence for prompt experiments). Rule-based on purpose: n=5
detects cliffs, not drifts. Verdicts are withheld under 5 scored runs.

## `--rebaseline --case X` re-measures EVERY property in the case

Not just the new ones. Every property is re-sampled from the fresh
runs, so a pre-existing property can land in a different class than
the one on record. During BRIEF-85 a scoped rebaseline re-sampled an
untouched BRIEF-54 grouping canary
(`intent-none-no-ticket/at-least-two-groups`), which came back 3/5
after being recorded 5/5; committing that would have moved it from
stable-pass (gating) to flaky (never gates) — silently retiring a
working canary. It took a third sample to establish the true 13/15.

The discipline: after any scoped rebaseline, diff the baseline files
and account for every changed number, not just the added ones. A
pre-existing property that moved is a finding, not noise — re-run the
case before believing a demotion.

## Cases

`cases/<id>/` = `fixture.json` + `expected.ts` + `baseline.json`.

- `fixture.json` — a fully cached generation input (FetchedPr shape +
  commitRange + optional PARSED `repoContext`). No GitHub at eval time.
  Built from a real PR (or an explicit commit span) via ad-hoc `gh api`
  captures — provenance lives in the PR that added each case.
- `expected.ts` — `export const properties: EvalProperty[]`. Anchor on
  run-stable facts (files, group relations, attribute names, categories);
  NEVER on chunk boundaries or prose text. One bounded exception
  (BRIEF-54): intent-check items may be keyword-matched — their `quote`
  fields are validator-tethered verbatim ticket substrings and the
  regexes match planted markers in fixture-authored ticket text, not
  free model prose. A throwing predicate counts as a fail with a note.
  Empty lists are rejected.
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
that a future gloss re-tune targets); the four `intent-*` cases
(BRIEF-54 intent check — precise/broad/none specificity boundaries plus
the adversarial ticket-injection posture; diffs reuse the published
components#7/#10 fixtures, ticket texts are authored data on
tasks.example URLs; all baselined stable-pass 5/5).

BRIEF-85 (alarm buckets) added a **twin pair**: `intent-masked-fix` and
`intent-legit-demotion` share ONE diff byte-identically and differ in their
surrounding corpus (ticket text plus PR title/body framing), so a model that
fires on the diff *shape* rather than the corpus passes one and fails the
other. They are also the corpus's first
**authored diff** — hand-written over this repo's own `packages/api` webhook
route, because no real own-repo PR carries a fake-fix shape and that shape is
the point of the case (own-repo files, so the corpus rule holds by
construction; PR locators are placeholders). The same change extended
`intent-adversarial-ticket`'s ticket with a manufactured-alarm injection
block, which invalidated that case's checked-in `adv-*` baseline — the
predicates were unchanged but the input moved, and stable predicates
preserve nothing when the input does. Re-recorded in #156 (all seven
properties 5/5; the hardening changed no original verdict); provenance
in its `expected.ts` header.

## Cost (decision 7)

Budgeting: measured 2026-07-25 on `anthropic:claude-opus-4-8`, the
12-case suite cost **$9.70** over 60 generations (tokens in 536,885 /
out 267,230 / cache_read 659,692) — ~$0.16 per generation. Estimate a
run as the pre-flight generation count × a recent measured
per-generation cost; never trust a previously quoted suite total — the
suite and the prompt both grow, so cached totals go stale silently (an
older "~$5 per suite" figure caused a real ~2× budget overrun during
BRIEF-85).

Per-case cost does not track diff size, so don't estimate a scoped run
from diff bytes. Six measured points (2026-07-25,
`anthropic:claude-opus-4-8`, 5 runs each, standalone invocations).
Sizes are the fixtures' `pr.diff` bytes; the six cases carry only
THREE distinct diffs — each same-size pair below is byte-identical,
differing in its ticket corpus and PR title/body framing:

| case | diff | cost / 5 runs |
| --- | --- | --- |
| `intent-broad-epic` | 4 KB | $0.81 |
| `intent-none-no-ticket` | 4 KB | $0.61 |
| `intent-adversarial-ticket` | 11 KB | $0.54 |
| `intent-precise-ticket` | 11 KB | $0.47 |
| `intent-masked-fix` | 2 KB | $0.44 |
| `intent-legit-demotion` | 2 KB | $0.22 |

The 4 KB `intent-broad-epic` costs 1.7× the 11 KB
`intent-precise-ticket`, and the twins' byte-identical 2 KB diff costs
$0.44 under one corpus and $0.22 under the other. One
hypothesis — inferred from these points, not isolated — is that an
ambiguous corpus makes the model deliberate longer. Only these six
cases have been measured standalone; per-case figures for the rest of
the corpus would be apportionment, not measurement.

Shown, never capped. Pre-flight prints the generation count; the report
prints token totals (via the generators' `onUsage`) and dollars only if
`eval/prices.json` has a row for the active `provider:model` — copy
`prices.example.json` and fill CURRENT rates (prices are deliberately
not hardcoded). CLI adapters (claude-code/codex) render as "billed to
the CLI's authenticated account" — never $0, and never "subscription"
as a claim of fact, since the harness cannot verify which account the
CLI authenticated with (BRIEF-140).

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

## Revision-pair cases (BRIEF-143)

`pair-cases/<id>/` = `pair.json` + `expected.ts` (exporting
`pairProperties`). A pair = a base fixture + a revised fixture + a provably
scoped increment (span diff, compare `files[]` metadata, `baseShaMoved`).
The runner drives the PRODUCTION anchoring machinery per run — fresh
`categorize` for the base, `planAnchoredGeneration`, anchored `categorize`
for the revision, `stitchBrief` — so the property pairs measure the real
pipeline. **One pair run = TWO generations**; the pre-flight line counts
them.

Corpus: one synthetic pair per change-impact category — `pair-additive`,
`pair-meaning-changing`, `pair-risk-add`, `pair-risk-remove`,
`pair-subtractive`, `pair-new-material`, `pair-boundary-restructure`,
`pair-ask-edit`, `pair-rebase-noise`, `pair-intent-transition` — with
authored diffs over own-repo file shapes (difflib-generated, hunk-correct;
PR locators are placeholders), plus `pair-real-brief143-docs`, a real pair
built verbatim from this repo's history (daed6dae → db2fe83e → 472b6d7a).
Mechanical rows (untouched survival, frozen attrs, coverage, id carry,
anchored stamp) are pipeline guarantees — any failure is a pipeline bug;
model-judged rows (description updates, verdict transitions, summary
stability) ride the stable-pass/flaky discipline (BRIEF-74 map).

**No baselines are committed yet** (BRIEF-143 PR 5 lands the corpus dry).
A pair case without `baseline.json` reports scores with verdicts withheld.
Recording the first baselines is a deliberate, reviewed step:

1. **Vacuous-pass check first** (BRIEF-59 trap). The shared property
   builders are already shown to FAIL against broken pairs in
   `test/eval-pairs.test.ts` (mechanical evidence, no spend). For the live
   half, run one deliberately broken pass before believing any 5/5:
   `pnpm eval --case pair-additive --runs 1 --pair-fresh` — the flag runs
   BOTH generations fresh (no anchor view, no stitch — exactly what
   `full-regeneration: always` produces in production), so
   `untouched-survives-*` and `anchored-stamp` MUST fail (prose
   byte-equality and the missing stamp fail deterministically).
   `id-carried-*` and `survivor-order-stable-*` are expected to fail too
   but CAN coincide — a fresh model take may renumber identically or
   re-emit the same diff-grounded ranges for a single-hunk file — treat a
   pass there as suspicious, not disqualifying. A must-fail property that still passes
   under `--pair-fresh` is vacuous — fix it before baselining. The flag
   never combines with `--rebaseline`.
2. `pnpm eval --rebaseline --case <id>` per pair (or one full
   `--rebaseline` run), then review + commit the `baseline.json` diffs.
3. `full-regeneration: always` must keep the EXISTING single-case
   baselines byte-meaningful — the fresh prompt is snapshot-pinned
   unchanged, so a full-suite run under the default config is the
   confirmation, not a requirement.

Deliberately not covered (know before you hunt): spec pair 3 RIGHT (a
material increment adds/changes a changelog bullet) needs prose-level
summary parsing and spec pair 3's summary rows are only partially pinned
(`summary-lede-stable`); pair 6 RIGHT's removed-chunk half rides
`pair-subtractive`'s group-death property rather than a chunk-level one.

Cost expectation: ~$0.16/generation on `anthropic:claude-opus-4-8`
(2026-07-25 measurement) → a full 11-pair × 5-run recording ≈ 110
generations ≈ **$17–18** on top of the single-case suite; a scoped
`--case` pair recording ≈ 10 generations ≈ **$1.60**. Measure, don't
trust cached totals (the BRIEF-85 lesson).
