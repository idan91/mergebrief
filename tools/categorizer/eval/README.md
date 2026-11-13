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
pnpm -C tools/categorizer eval --case <id> --record-base-brief   # store a pair case's base Brief once
pnpm -C tools/categorizer eval --case multi-package-types --force-multi-call   # a small case through the multi-call route
pnpm -C tools/categorizer eval --case next-60530 --force-outline headers      # the grouping reads a fixed outline form
pnpm -C tools/categorizer eval --effort-grouping high --effort-detail medium  # per-call efforts on a multi-call run
```

The multi-call knobs (`--force-multi-call`, `--force-outline <form>`,
`--effort-grouping <effort>`, `--effort-detail <effort>`) steer a single
case's generation off the production path: `--force-multi-call` routes a
PR the call plan would answer in one call through the grouping and detail
calls; `--force-outline` fixes the outline form the grouping reads (`full`,
`lines-40`, `lines-20`, `lines-12`, `lines-6`, `lines-2`, `headers`,
`files`); the effort knobs set the grouping and detail calls' efforts,
each falling back to the generator's effort. Pair cases run unchanged.
On a case the call plan answers in one call, `--force-outline` and the
effort knobs have no effect, and the CLI says so on stderr before any
spend; add `--force-multi-call` to exercise them.
A knobbed run compares against the committed baseline as usual but can
never write one: `--rebaseline` refuses the combination. Its report names
the knobs in the markdown header, the terminal lines and the JSON
(`knobs`, `knobNotes`), so a pasted report shows it left the production path.

The default generator is `mergebrief.eval.claude-code.yaml`:
`claude-code:claude-opus-5-5`, billed to the subscription the local
`claude` CLI is logged into. The adapter strips API-key variables and
refuses to start unless `claude auth status` reports a `claude.ai` login.

Exit codes: `0` clean · `1` ≥1 REGRESSION · `2` config/usage error.
Reports land in `out/eval-report.json` + `out/eval-report.md` (paste the
markdown block into the PR; see the convention gate below). Every
scored run's brief is persisted to `out/eval-runs/<case>/run-N.brief.json`
(N = true run number; failed runs leave gaps) for flaky-property
diagnosis. Specimens are wiped per case per invocation, so a `--case` rerun refreshes
that case and leaves the others' specimens from the last full run.

## When to run (convention gate, not CI)

Run before merging any change to the generation surface:
`packages/brief-core/src/generation/prompt.ts`, the output schema
(`packages/brief-core/src/types.ts`), validators/salvage, the anchored
plan and stitch (`packages/brief-core/src/anchoring/`) with the diff
parsers that decide them (`packages/brief-core/src/diff/`),
repo-config injection, or output-affecting adapter defaults. Also once when a fixture
lands (`--rebaseline` records its baseline) and after a model bump.
Include the report in the PR body. Never wired into CI: live API spend.

**Scoped by default**: gate with one `--case <id>` run per
case whose properties could plausibly move. The flag takes a single
id (a repeated `--case` silently keeps only the last), and each
invocation overwrites `out/eval-report.{json,md}`, so capture the
report between runs. Justify the selection in the PR body, e.g. an
intent-check-only change is honestly gated by the nine `intent-*` cases
(nine runs), and a Product-diff-only change by the five `product-diff-*`
cases. Run the full suite for prompt-wide changes (shared prompt
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
stable-pass (gating) to flaky (never gates), silently retiring a
working canary. It took a third sample to establish the true 13/15.

The discipline: after any scoped rebaseline, diff the baseline files
and account for every changed number, not just the added ones. A
pre-existing property that moved is a finding, not noise; re-run the
case before believing a demotion.

## Cases

`cases/<id>/` = `fixture.json` + `expected.ts` + `baseline.json`. A
large case stores its fixture gzipped as `fixture.json.gz` instead (never
both); the loader reads either.

- `fixture.json`: a fully cached generation input (FetchedPr shape +
  commitRange + optional PARSED `repoContext`). No GitHub at eval time.
  Built from a real PR (or an explicit commit span) via ad-hoc `gh api`
  captures; origin info lives in the PR that added each case.
- `expected.ts`: `export const properties: EvalProperty[]`. Anchor on
  run-stable facts (files, group relations, attribute names, categories);
  NEVER on chunk boundaries or free text. One bounded exception:
  intent-check items may be keyword-matched: their `quote`
  fields are validator-tethered verbatim ticket substrings and the
  regexes match planted markers in fixture-authored ticket text, not
  free model text. A second: a Product diff row is found by a loose
  pattern over its `when` and `after`, because the row is
  prose and the behaviour it names is the fact under test; every such
  property also requires the section read, so an absent section fails it.
  The exception is a property that asks for no such row: it passes with no
  rows, and its case anchors it with one that needs a row.
  A throwing predicate counts as a fail with a note.
  Empty lists are rejected.

A fixture carries the diff, never a lockfile's full text at base and head,
so the harness passes no lockfile contents and every changed pnpm, npm or
yarn lockfile reads unread: its chunks carry `changes-package-source`
whether or not a package moved. The worker reads both sides and flags a
lockfile only for a real source change, so an eval property on that
attribute over a lockfile measures the harness, not production.

- `baseline.json`: pass counts from main, keyed `provider:model`.
  Cross-key comparison is refused; the committed key is the default
  config's, `claude-code:claude-opus-5-5`. Re-baselining is an explicit
  reviewed commit.

**Source rule: own repos, or MIT with its LICENSE.** This repo goes
public; every checked-in diff must be publishable. A third-party case
is allowed only from an MIT-licensed project, with that project's
`LICENSE` at the PR's head committed beside the fixture. Any other
license needs its own decision first. CI's secret scan and the release
export's both read inside a gzipped fixture, so a key the upstream diff
carries is replaced by a placeholder, never allowlisted: `next-60530` holds
one, fences renamed on the removed line because the scanner's rule matches
across both, so the added line still reads as a key to the redactor and
`adds-secret`. A gzipped case fixture is written with level 9 and mtime 0;
the harness writes a gzipped pair file (capture, `--record-base-brief`)
with zlib's default level, also mtime 0.

**Private cases.** A case whose fixture embeds private material (plan or
internal-doc text, private process) lives in `private-cases/<id>/` or
`private-pair-cases/<id>/`, same shape as its public peer. These dirs
stay private: the public source snapshot leaves them out, together with
`test/pipeline-goldens-private.test.ts` and its snapshot and
`test/eval-summary-media-cases.test.ts`, which load from them. The eval CLI
loads all four dirs, so `--case` finds a private id, and a missing
private dir is an empty list, so a public checkout runs without them.
Today: `delta-read-api-contract`, `pair-real-brief143-docs` and the four
`summary-media-*` cases. Their three third-party fixtures (grafana
AGPL-3.0, supabase and home-assistant Apache-2.0) carry the decision the
source rule asks for, taken for these three cases only: they sit here with
their `LICENSE` beside the fixture, since the snapshot never publishes
them. Any other non-MIT case still needs its own decision first.

The **Summary Media cases** measure which description Media the model
shows in the Brief summary or points at. Each fixture's description holds
Media, so its request carries the `<pr_media>` block, the rule and the
schema field; every other case has none and sends the request it sent
before. Their properties re-read the item list from the brief's own
description, so an item number in `expected.ts` is the number the model
saw. `summary-media-props.ts` holds two generator guarantees every case
carries (stored keys name description items; no item both shown and in
the pointer) beside the model-judged property each case asserts:
`summary-media-code-review-1141` (four screenshots and two mp4 links,
something shown or pointed at), `summary-media-grafana-107803` (AGPL-3.0;
an explanatory sequence diagram, shown), `summary-media-supabase-19466`
(Apache-2.0; one decorative GIF, nothing) and
`summary-media-home-assistant-55394` (Apache-2.0; a Before | After table,
nothing shown and a pointer holding both halves).

Seed sources: `copybutton-new-export` (a `cross-service` false-positive
probe) ·
`button-under-split` (sub-file intent splitting; its diff also carries
the dormant `unresolved-reference` probe: App.tsx switches
`variant="primary"` to `type="primary"`, an invalid value that the
`{...props}` spread lets override `type="button"` while `variant`
silently stops being passed) · `pure-move-persistence` ·
`multi-package-types` · `schema-change-provenance`.

Added post-seed: `delta-read-api-contract` (private; a positive
`cross-service` probe: modified EXISTING wire contracts from a real PR in this repo;
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
attributes over the CopyButton diff); `intent-github-primary` (the
precise-ticket diff and asks read as a GitHub issue reaches
production: no key, the title only in the `title · state · labels`
header, a body that never repeats it; the title at the issue's
`ticketUrls` position must be the title alone, never the header line;
a test proves the fixture matches the GitHub read's output);
`intent-jira-primary` (the precise-ticket PR and asks with the ticket in a
Jira issue: the summary leads the header, the body opens on a `Parent:`
line, and the PR body links the issue on the site; the PR is otherwise
byte-identical to `intent-precise-ticket`. Its `jira-issue.json` is a
hand-written response in Jira Cloud's shape, not one recorded from a live
site, and a test reads it through the production Jira read and holds the
fixture's primary equal to the result).

The alarm buckets added a **twin pair**: `intent-masked-fix` and
`intent-legit-demotion` share ONE diff byte-identically and differ in their
surrounding sources (ticket text plus PR title/body framing), so a model that
fires on the diff _shape_ rather than the sources passes one and fails the
other. They are also the source set's first
**authored diff**, hand-written over this repo's own `apps/api` webhook
route, because no real own-repo PR carries a fake-fix shape and that shape is
the point of the case (own-repo files, so the source rule holds by
construction; PR locators are placeholders). The same change extended
`intent-adversarial-ticket`'s ticket with a manufactured-alarm injection
block, which invalidated that case's checked-in `adv-*` baseline. The
predicates were unchanged but the input moved, and stable predicates
preserve nothing when the input does. Re-recorded later (all seven
properties 5/5; the hardening changed no original verdict); origin info
in its `expected.ts` header.

The **Product diff cases** score the section the call after a one-call
brief writes, on real own-repo PRs: `product-diff-removed-lines` (a before
read off removed lines, sourced `diff`), `product-diff-rename-only` (a
rename: read and empty), `product-diff-new-route` (a new route, sourced
`did-not-exist`), `product-diff-pr-text-contradicts` (the removed-lines
diff byte-identically under an authored description that claims no product
changes and a before the removed lines contradict) and
`product-diff-over-cap` (more than eight changes: `hasMore`). Their
predicates live in `cases/product-diff-props.ts` and are proved to pass and
fail in `test/eval-product-diff-cases.test.ts`, which also holds every
fixture to a one-call plan: past it the section is `unavailable` and every
row property fails for a reason the case is not about.

The **large cases** are real third-party MIT PRs past the single-call
limits, gzipped, each with its `LICENSE`: `kit-11161` (sveltejs/kit
SvelteKit 2.0, 342 files, output-bound), `react-router-11768`
(remix-run/react-router, v7 merged to dev, 724 files, input-bound) and
`next-60530` (vercel/next.js prettier reformat, 2,559 files, the
outline-form case). Each is the compare diff from the merge base to the
PR head, the PR's metadata and file list as the API returned them (the
files API reports 0/0 for some large added or removed files; kept
verbatim), and `gitAttributes`, the default branch's `.gitattributes` at
merge time (react-router had none). Their properties are pipeline
guarantees from `cases/large-pr-props.ts`: the groups partition the
chunks, every changed line is in a chunk or the unattributed remainder,
and each changed pnpm, npm or yarn lockfile reads shortened. Their brief
goldens record a digest, since the full briefs run to megabytes. None of
the three fits one model call, so they pass only on a build with the
multi-call engine; a full-suite run on an earlier build pays for calls
that fail or come back cut.

## Cost

The default route has no per-generation price; it draws on the
subscription's usage limits instead. The dollar figures below are the
API route's, kept for a `--config` run against `anthropic`.

Budgeting: measured 2026-07-25 on `anthropic:claude-opus-4-8`, the
suite, then 12 cases, cost **$9.70** over 60 generations (tokens in 536,885 /
out 267,230 / cache_read 659,692), ~$0.16 per generation. Estimate a
run as the pre-flight generation count × a recent measured
per-generation cost; never trust a previously quoted suite total: the
suite and the prompt both grow, so cached totals go stale silently (an
older "~$5 per suite" figure once caused a real ~2× budget overrun).

Per-case cost does not track diff size, so don't estimate a scoped run
from diff bytes. Six measured points (2026-07-25,
`anthropic:claude-opus-4-8`, 5 runs each, standalone invocations).
Sizes are the fixtures' `pr.diff` bytes; the six cases carry only
THREE distinct diffs; each same-size pair below is byte-identical,
differing in its ticket sources and PR title/body framing:

| case                        | diff  | cost / 5 runs |
| --------------------------- | ----- | ------------- |
| `intent-broad-epic`         | 4 KB  | $0.81         |
| `intent-none-no-ticket`     | 4 KB  | $0.61         |
| `intent-adversarial-ticket` | 11 KB | $0.54         |
| `intent-precise-ticket`     | 11 KB | $0.47         |
| `intent-masked-fix`         | 2 KB  | $0.44         |
| `intent-legit-demotion`     | 2 KB  | $0.22         |

The 4 KB `intent-broad-epic` costs 1.7× the 11 KB
`intent-precise-ticket`, and the twins' byte-identical 2 KB diff costs
$0.44 under one source set and $0.22 under the other. One
hypothesis, inferred from these points and not isolated, is that an
ambiguous source set makes the model deliberate longer. Only these six
cases have been measured standalone; per-case figures for the rest of
the source set would be apportionment, not measurement.

Shown, never capped. Pre-flight prints the generation count; the report
prints token totals (via the generators' `onUsage`) and dollars only if
`eval/prices.json` (committed; `--prices <json>` swaps it) has a row for
the active `provider:model`. Keep its rows at CURRENT rates, adding one
from `prices.example.json` for a new key; prices are deliberately not
hardcoded. CLI adapters (claude-code/codex) render as "billed to
the CLI's authenticated account", never $0, and never "subscription"
as a claim of fact, since the harness cannot verify which account the
CLI authenticated with.

Cache-read semantics differ per provider family and `priceUsage` accounts
for it: Anthropic's input tokens EXCLUDE cache reads (priced additively);
OpenAI-compatible providers report cached tokens INSIDE prompt_tokens
(the cached subset is re-priced by subtraction; without a cache rate the
whole prompt bills at the input rate: an overcount, never an
understatement).

## Inspecting report.json

```sh
jq '.regressions' out/eval-report.json
jq -r '.cases[] | .caseId as $c | .properties[] | select(.verdict != "unchanged") | "\($c): \(.id) \(.verdict) \(.passes)/\(.runs)"' out/eval-report.json
jq '.usage' out/eval-report.json
```

## Revision-pair cases

`pair-cases/<id>/` = `pair.json` + `expected.ts` (exporting
`pairProperties`). A pair = a base fixture + a revised fixture + the
revision span between them: `increment.filteredSpan` and
`increment.unfilteredSpan` (the PR's own change, filtered and not; on a
fast-forward both are the three-dot diff). A captured pair also records
the span the production read built (`increment.span`), and the runner
reads that. Otherwise it rebuilds the span the
worker would read from the two PR diffs and `unfilteredSpan`: the fast path
when both heads share the PR base, the builder otherwise. Fixtures hold
no blobs, so the rebuilt span neither slides a run over equal lines nor
confirms a base rename: on a case that needs either, its carry split can
differ from the worker's. It then drives the
PRODUCTION anchoring machinery per run: fresh `categorize` for the base,
`planAnchoredGeneration` over that span, anchored `categorize` for the
revision, `stitchBrief`, so the property pairs measure the real pipeline. **One pair run = TWO generations**, up to four with the
narrative and delta mode below, one fewer with a stored `baseBrief`, and
no revision call when that stored Brief carries every group over a span
that changed no file and its input fingerprint matches the revised
inputs'; the pre-flight line counts them per case. A stored `baseBrief`
must carry the `inputFingerprint` of the base inputs it was written from;
the loader refuses one without it. A large `pair.json` may ship as
`pair.json.gz`, never both.

A twin case runs another case's pair through the multi-call engine: its
`expected.ts` exports `fixtureFrom` (a sibling case id whose `pair.json` it
reads) and `forceMultiCall = true`, and scores under its own id and
baseline, as `pair-additive-multi-call` does. Every Brief the twin generates
runs multi-call; a base case's stored `baseBrief` is read as stored, so
`pair-force-push-amend-multi-call` forces only its revised Brief. The CLI's `--force-multi-call`
stays a knob that is never a baseline source; a twin is a case.

### Narrative and delta mode

A pair case opts in by exporting `narrativeProperties`, `deltaProperties`,
or both from `expected.ts`; ids are unique across all three lists. Each
run then calls `categorizeRevisionNarrative` on the stitched revised Brief
and `categorizeDelta` for a reviewer whose Checkpoint sits at the previous
head, both over `increment.filteredSpan`. An empty one is a push that left the PR's own change as it
was: the run writes the `revisionNarrativeUnchanged` and `deltaUnchanged`
records the worker writes and calls no model for them, and
`narrative-no-change` / `delta-no-change` score that (the record over an
empty span with zero model calls, a real artifact over any other). The
shared predicates live in `revision-props.ts` (grounded, covers the span
for both, no replay, comments from the input, no change); the chunk
predicates read a record as no chunks. No replay reads lines: a chunk fails
in a file outside the filtered span, or on a line only `unfilteredSpan`
changes (base noise), its added lines or the point a pure deletion sits
before. `SPAN_NARRATIVE_PROPERTIES` and `SPAN_DELTA_PROPERTIES` are the
lists a span case opts into whole. The narrative and delta specimens persist beside the
base and revised ones.

Optional `pair.json` fields: `reviewComments` (the comments that existed at the revised head),
`baseBrief` (the base head's Brief, read instead of generating one; its
head must be the base head). Cases that do not opt in cost what they cost
before. A case whose base Brief costs too much to generate per run exports
`requiresBaseBrief = true`: the harness refuses any invocation selecting it
until its pair file stores one. `pnpm eval --case <id> --record-base-brief`
generates that base Brief once on the production path and writes it into
the case's `pair.json` or `pair.json.gz`; a human runs it, as any eval spend.

The delta gets no review comments by default, because the worker sends
none. A case that scores the dev CLI's comment path exports
`deltaReadsReviewComments = true` beside `deltaProperties`, and its
`pair.json` must carry `reviewComments`. Under `--pair-fresh` the delta
is skipped and its properties drop out of the report: it never reads the
revised Brief, so the probe has nothing to show about it.

### Capturing a real pair

`pnpm capture-pair <pr-url> <prev-head> <head> --out <dir>` reads both
heads' PR diffs, the revision span through brief-core's `readPrSpan`, and
the PR's review comments through `gh`, then writes `pair.json` (gzipped
past 1 MiB). `--prev-base <sha>` names the previous head's base for a
retargeted PR; both bases default to the PR's current base. Title and
body come from the PR as it reads now; links are not read and stay
empty. The span's file split and both hops are recorded beside the two
diffs, so the run anchors on the worker's span. It never runs a
generation; write `expected.ts` by hand.

Review comments are cut at the revised head's committer date: a comment
created after it is left out. The cut is approximate. A comment written
between that commit and its push is dropped, and a commit date set by a
skewed clock moves the cut. A kept comment's body, `line` and `outdated`
read as GitHub serves them now, measured against the PR's current head,
not the captured one.

Source set: one synthetic pair per change-impact category: `pair-additive`,
`pair-meaning-changing`, `pair-risk-add`, `pair-risk-remove`,
`pair-subtractive`, `pair-new-material`, `pair-boundary-restructure`,
`pair-ask-edit`, `pair-rebase-noise`, `pair-intent-transition`, with
authored diffs over own-repo file shapes (difflib-generated, hunk-correct;
PR locators are placeholders), plus `pair-real-brief143-docs` (private), a
real pair built verbatim from this repo's history (daed6dae → db2fe83e → 472b6d7a).
`pair-risk-add-new-file` is `pair-risk-add` with the route added by the PR,
so the chunk that lost its guard removes no lines.
The span cases record the span their capture read: `pair-force-push-squash`,
`pair-force-push-amend`, `pair-merge-main-noop`,
`pair-rebase-upstream-same-file` and `pair-rebase-conflict-resolution`,
authored in a scratch git repo and captured through `capturePair` over a
local-git span source, each with a hand-written `baseBrief` of one group
per file so the carry split does not hang on the model's grouping, and `pair-real-sveltekit-2-0` (sveltejs/kit #11161,
a master merge that left the PR diff byte-identical). They opt into the
narrative and the delta, as do `pair-additive` (the fast-forward control)
and `pair-ask-edit` (with review comments).
The Media cases are authored the same way over a description holding two
mermaid diagrams, with Summary Media on the stored base: `pair-media-no-change`
(squash, carried with no call), `pair-media-fast-forward` and its multi-call
twin (one file re-looks, then the Summary Media call picks after the
stitch) and `pair-media-description-edit` (only the timing diagram swapped,
so the fingerprint moves and the carry is refused). Their Summary Media
properties reuse the guards in `summary-media-props.ts`, and the pre-flight
count adds the Summary Media call a Brief over Media makes.
Mechanical rows (untouched survival, frozen attrs, coverage, id carry,
anchored stamp) are pipeline guarantees; any failure is a pipeline bug;
model-judged rows (description updates, verdict transitions, summary
stability) ride the stable-pass/flaky discipline.

Every pair case has a committed `baseline.json`. A pair case without one
reports scores with verdicts withheld. Recording a baseline, first or
re-recorded, is a deliberate, reviewed step:

1. **Vacuous-pass check first.** The shared property
   builders are already shown to FAIL against broken pairs in
   `test/eval-pairs.test.ts` (mechanical evidence, no spend). For the live
   half, run one deliberately broken pass before believing any 5/5:
   `pnpm eval --case pair-additive --runs 1 --pair-fresh`. The flag runs
   BOTH generations fresh (no anchor view, no stitch, exactly what
   `full-regeneration: always` produces in production), so
   `untouched-survives-*` and `anchored-stamp` MUST fail (text
   byte-equality and the missing stamp fail deterministically).
   `id-carried-*` and `survivor-order-stable-*` are expected to fail too
   but CAN coincide: a fresh model take may renumber identically or
   re-emit the same diff-grounded ranges for a single-hunk file. Treat a
   pass there as suspicious, not disqualifying. A must-fail property that still passes
   under `--pair-fresh` is vacuous; fix it before baselining. The flag
   never combines with `--rebaseline`.
2. `pnpm eval --rebaseline --case <id>` per pair (or one full
   `--rebaseline` run), then review + commit the `baseline.json` diffs.
3. `full-regeneration: always` must keep the EXISTING single-case
   baselines byte-meaningful: the fresh prompt is snapshot-pinned
   unchanged, so a full-suite run under the default config is the
   confirmation, not a requirement.

Deliberately not covered (know before you hunt): spec pair 3 RIGHT (a
material increment adds/changes a changelog bullet) needs text-level
summary parsing and spec pair 3's summary rows are only partially pinned
(`summary-lede-stable`); pair 6 RIGHT's removed-chunk half rides
`pair-subtractive`'s group-death property rather than a chunk-level one.

Cost expectation: ~$0.16/generation on `anthropic:claude-opus-4-8`
(2026-07-25 measurement) → a full 12-pair (11 public, 1 private) × 5-run
recording ≈ 120 generations ≈ **$19** on top of the single-case suite; a scoped
`--case` pair recording ≈ 10 generations ≈ **$1.60**. Measure, don't
trust cached totals.
