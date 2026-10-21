# Generation-quality eval harness

Regression net over generation quality: labeled real-PR fixtures, N runs
per case, mechanical property checklists, provider:model-keyed baselines.

```sh
pnpm -C tools/categorizer eval                  # all cases, 5 runs each, compare vs baselines
pnpm -C tools/categorizer eval --case <id>     # one case
pnpm -C tools/categorizer eval --runs 1        # quick smoke (verdicts withheld under 5)
pnpm -C tools/categorizer eval --rebaseline    # rewrite baseline.json (review + commit the diff)
pnpm -C tools/categorizer eval --no-baseline   # characterize a key with no committed baseline (cross-model runs)
pnpm -C tools/categorizer eval --config <mergebrief.config.yaml>   # non-default generator (cross-key, so add --no-baseline)
pnpm -C tools/categorizer eval --prices <json> # non-default price table
```

The default generator is `mergebrief.eval.claude-code.yaml`:
`claude-code:claude-opus-5-5`, billed to the subscription the local
`claude` CLI is logged into. The adapter strips API-key variables and
refuses to start unless `claude auth status` reports a `claude.ai` login.

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
(`packages/brief-core/src/types.ts`), validators/salvage, the anchored
plan and stitch (`packages/brief-core/src/anchoring/`) with the diff
parsers that decide them (`packages/brief-core/src/diff/`),
repo-config injection, or output-affecting adapter defaults. Also once when a fixture
lands (`--rebaseline` records its baseline) and after a model bump.
Include the report in the PR body. Never wired into CI — live API spend.

**Scoped by default**: gate with one `--case <id>` run per
case whose properties could plausibly move — the flag takes a single
id (a repeated `--case` silently keeps only the last), and each
invocation overwrites `out/eval-report.{json,md}`, so capture the
report between runs. Justify the selection in the PR body — e.g. an
intent-check-only change is honestly gated by the seven `intent-*` cases
(seven runs). Run the full suite for prompt-wide changes (shared prompt
sections, output schema, salvage) and model bumps, where any property
could move. An honestly-scoped run beats the real alternative at
full-suite prices: not gating at all.

## Text-length note

Every case report carries a length-compliance note when any run's
artifact stamps `lengthViolations` (the warn-only text-length floor); silence
means every run fit the caps. Pair cases report base/revised sides
separately. For a cross-model length check, the harness refuses a
cross-key comparison before spend, so run the other key with
`--config <file> --no-baseline`: scores and the length note, no verdicts.

## Verdict rules

Baseline classes per property: stable-pass (5/5) · flaky (1–4/5) ·
stable-fail (0/5). Branch verdicts: stable-pass failing ≥2/5 =
**REGRESSION** (exit 1) · 1/5 = WARN (rerun the case) · flaky = delta,
informational, never gates · stable-fail now passing = IMPROVEMENT (the
promotion evidence for prompt experiments). Rule-based on purpose: n=5
detects cliffs, not drifts. Verdicts are withheld under 5 scored runs.

## `--rebaseline --case X` re-measures EVERY property in the case

Not just the new ones. Every property is re-sampled from the fresh
runs, so a pre-existing property can land in a different class than
the one on record. A scoped rebaseline once re-sampled an untouched
grouping canary
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
  captures — origin info lives in the PR that added each case.
- `expected.ts` — `export const properties: EvalProperty[]`. Anchor on
  run-stable facts (files, group relations, attribute names, categories);
  NEVER on chunk boundaries or free text. One bounded exception:
  intent-check items may be keyword-matched — their `quote`
  fields are validator-tethered verbatim ticket substrings and the
  regexes match planted markers in fixture-authored ticket text, not
  free model text. A throwing predicate counts as a fail with a note.
  Empty lists are rejected.
- `baseline.json` — pass counts from main, keyed `provider:model`.
  Cross-key comparison is refused; the committed key is the default
  config's, `claude-code:claude-opus-5-5`. Re-baselining is an explicit
  reviewed commit.

**Source rule: own-repos only.** This repo goes public; every
checked-in diff must be publishable. No third-party diffs without a
license decision.

Seed sources: `copybutton-new-export` (a `cross-service` false-positive
probe) ·
`button-under-split` (sub-file intent splitting; its diff also carries
the dormant `unresolved-reference` probe — App.tsx switches
`variant="primary"` to `type="primary"`, an invalid value that the
`{...props}` spread lets override `type="button"` while `variant`
silently stops being passed) · `pure-move-persistence` ·
`multi-package-types` · `schema-change-provenance`.

Added post-seed: `delta-read-api-contract` (a positive `cross-service`
probe: modified EXISTING wire contracts from a real PR in this repo;
baselined at 1/5, the under-fire measured after the false-positive fix,
which a future description re-tune targets); the first four `intent-*`
cases (the intent check: precise/broad/none specificity boundaries plus
the adversarial ticket-injection posture; diffs reuse two published
own-repo component PRs, ticket texts are authored data on tasks.example
URLs; all baselined stable-pass 5/5); `intent-primary-plus-refs` (the
precise-ticket case with two unfetched references beside the primary:
the alignment read must quote the primary alone);
`repo-policy-scoped-attribute` (the repo-config injection path, which no
other case exercises: an instruction block and two path-scoped custom
attributes over the CopyButton diff).

The alarm buckets added a **twin pair**: `intent-masked-fix` and
`intent-legit-demotion` share ONE diff byte-identically and differ in their
surrounding sources (ticket text plus PR title/body framing), so a model that
fires on the diff *shape* rather than the sources passes one and fails the
other. They are also the source set's first
**authored diff** — hand-written over this repo's own `apps/api` webhook
route, because no real own-repo PR carries a fake-fix shape and that shape is
the point of the case (own-repo files, so the source rule holds by
construction; PR locators are placeholders). The same change extended
`intent-adversarial-ticket`'s ticket with a manufactured-alarm injection
block, which invalidated that case's checked-in `adv-*` baseline — the
predicates were unchanged but the input moved, and stable predicates
preserve nothing when the input does. Re-recorded later (all seven
properties 5/5; the hardening changed no original verdict); origin info
in its `expected.ts` header.

## Cost

The default route has no per-generation price; it draws on the
subscription's usage limits instead. The dollar figures below are the
API route's, kept for a `--config` run against `anthropic`.

Budgeting: measured 2026-07-25 on `anthropic:claude-opus-4-8`, the
suite, then 12 cases, cost **$9.70** over 60 generations (tokens in 536,885 /
out 267,230 / cache_read 659,692) — ~$0.16 per generation. Estimate a
run as the pre-flight generation count × a recent measured
per-generation cost; never trust a previously quoted suite total — the
suite and the prompt both grow, so cached totals go stale silently (an
older "~$5 per suite" figure once caused a real ~2× budget overrun).

Per-case cost does not track diff size, so don't estimate a scoped run
from diff bytes. Six measured points (2026-07-25,
`anthropic:claude-opus-4-8`, 5 runs each, standalone invocations).
Sizes are the fixtures' `pr.diff` bytes; the six cases carry only
THREE distinct diffs — each same-size pair below is byte-identical,
differing in its ticket sources and PR title/body framing:

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
$0.44 under one source set and $0.22 under the other. One
hypothesis — inferred from these points, not isolated — is that an
ambiguous source set makes the model deliberate longer. Only these six
cases have been measured standalone; per-case figures for the rest of
the source set would be apportionment, not measurement.

Shown, never capped. Pre-flight prints the generation count; the report
prints token totals (via the generators' `onUsage`) and dollars only if
`eval/prices.json` (committed; `--prices <json>` swaps it) has a row for
the active `provider:model`. Keep its rows at CURRENT rates, adding one
from `prices.example.json` for a new key; prices are deliberately not
hardcoded. CLI adapters (claude-code/codex) render as "billed to
the CLI's authenticated account" — never $0, and never "subscription"
as a claim of fact, since the harness cannot verify which account the
CLI authenticated with.

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

## Revision-pair cases

`pair-cases/<id>/` = `pair.json` + `expected.ts` (exporting
`pairProperties`). A pair = a base fixture + a revised fixture + a provably
scoped increment (span diff, compare `files[]` metadata, `baseShaMoved`).
The runner drives the PRODUCTION anchoring machinery per run — fresh
`categorize` for the base, `planAnchoredGeneration`, anchored `categorize`
for the revision, `stitchBrief` — so the property pairs measure the real
pipeline. **One pair run = TWO generations**; the pre-flight line counts
them.

Source set: one synthetic pair per change-impact category — `pair-additive`,
`pair-meaning-changing`, `pair-risk-add`, `pair-risk-remove`,
`pair-subtractive`, `pair-new-material`, `pair-boundary-restructure`,
`pair-ask-edit`, `pair-rebase-noise`, `pair-intent-transition` — with
authored diffs over own-repo file shapes (difflib-generated, hunk-correct;
PR locators are placeholders), plus `pair-real-brief143-docs`, a real pair
built verbatim from this repo's history (daed6dae → db2fe83e → 472b6d7a).
`pair-risk-add-new-file` is `pair-risk-add` with the route added by the PR,
so the chunk that lost its guard removes no lines.
Mechanical rows (untouched survival, frozen attrs, coverage, id carry,
anchored stamp) are pipeline guarantees — any failure is a pipeline bug;
model-judged rows (description updates, verdict transitions, summary
stability) ride the stable-pass/flaky discipline.

Every pair case has a committed `baseline.json`. A pair case without one
reports scores with verdicts withheld. Recording a baseline, first or
re-recorded, is a deliberate, reviewed step:

1. **Vacuous-pass check first.** The shared property
   builders are already shown to FAIL against broken pairs in
   `test/eval-pairs.test.ts` (mechanical evidence, no spend). For the live
   half, run one deliberately broken pass before believing any 5/5:
   `pnpm eval --case pair-additive --runs 1 --pair-fresh` — the flag runs
   BOTH generations fresh (no anchor view, no stitch — exactly what
   `full-regeneration: always` produces in production), so
   `untouched-survives-*` and `anchored-stamp` MUST fail (text
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
material increment adds/changes a changelog bullet) needs text-level
summary parsing and spec pair 3's summary rows are only partially pinned
(`summary-lede-stable`); pair 6 RIGHT's removed-chunk half rides
`pair-subtractive`'s group-death property rather than a chunk-level one.

Cost expectation: ~$0.16/generation on `anthropic:claude-opus-4-8`
(2026-07-25 measurement) → a full 12-pair × 5-run recording ≈ 120
generations ≈ **$19** on top of the single-case suite; a scoped
`--case` pair recording ≈ 10 generations ≈ **$1.60**. Measure, don't
trust cached totals.
