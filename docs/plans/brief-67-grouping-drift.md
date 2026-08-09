# BRIEF-67 — grouping drift: verdict + remediation plan

Status: investigation complete (2026-07-20), implementation planned. Ticket:
BRIEF-67 "Eval harness: persist per-run briefs; investigate coherent-grouping
drift". Scope item 1 (specimen persistence) landed earlier via #126; this plan
covers the remainder plus the fixes the findings justify.

## Drift verdict (measured, 2026-07-20)

`coherent-grouping` on copybutton-new-export (pass = 1–3 change groups):

| Batch | Pass rate |
| --- | --- |
| Corpus seed b833124c (pre BRIEF-55) | 4/5 |
| Post-#125 drift window (four batches) | 6/20 |
| Rebaseline batch (ea4eed57 baked 2/5) | 2/5 |
| BRIEF-69 branch probe (Jul 18) | 4/5 |
| Merged main, 10-run probe ($0.91) | **2/10** |

**Verdict: real wording-induced regression, still present on main.** The
BRIEF-69-branch 4/5 was an outlier (its final wording was never re-measured —
known BRIEF-69 debt). Pooled post-BRIEF-55 era: 10/35 ≈ 29% vs seed 80%.

**Mechanism** (10 fresh specimens, `out/eval-runs/copybutton-new-export/`):
failing runs fragment the one new component per-file — types / facade hook /
view(+scss) / stories+tests / barrel exports ≈ 5 groups (6 when scss splits
from tsx). Stable across all 10 runs: stories+test always pair; barrels always
pair. The lost behavior is exactly one thing: consolidating a new component's
internal anatomy (types, hook, view, styles) into one story group. Run-to-run
variance also cuts the other way in product (components#11 collapsed 5→1), so
the fix targets a stable consolidation rule, not a group-count nudge.

**Sequencing consequence: BRIEF-74's full-source rebaseline waits for PR C** —
rebaselining now would bake ~20–30% grouping as the reference.

Incident found en route (2026-07-20 12:43): an eval invocation whose runs all
failed generation wiped `out/eval-runs/copybutton-new-export/` and wrote
nothing, destroying the Jul 18 specimens — cli.ts wipes before checking it has
briefs to write. Cross-model runs also spend before failing the baseline-key
lookup. Both fixed in PR A.

## Process requirements

- **git-eng is mandatory for all git operations.** Confirmed with Idan:
  chunked commits per logical unit; no Co-Authored-By trailers, no
  AI-attribution in PR bodies; PR titles `[BRIEF-67] prefix: Title Case`.
  PRs ready-for-review; Idan merges.
- **Review gate: fable-reviewer subagent on each branch diff before its PR
  goes up.** No per-commit review agents.
- **Confirmed specialist skills (mandatory): `typescript-eng`, `tdd`.**
  Test-first for PR A guard logic and PR B snapshot pinning.
- **Spend cap for PR C: ~$5** (1–2 × $0.45 five-run probes + ~$4 full-source
  gate). Stop and report if the first two probes don't improve the pass rate.
- Lint/gates judged by exit codes (`pnpm oxlint`); no prettier in this repo.
- Full eval runs exceed the 600s Bash timeout — background them.

## PRs

Order A → B → C. A is independent (base main); B base main; C stacked on B so
the wording edit lands once in the shared constants.

### PR A — eval-harness hardening

Branch `chore/BRIEF-67/eval-harness-hardening`, base main. ~120 LOC.
`tools/categorizer/eval/` only; no API spend, no eval gate (harness code, not
generation surface).

1. **Baseline-key preflight**: before any generation, load every selected
   case's `baseline.json` and fail exit 2 if the resolved `provider:model` key
   is missing (skipped under `--rebaseline`). Kills spend-then-exit-2 on
   cross-model runs.
2. **Specimen-wipe guard**: in `evaluateCase`, only wipe/rewrite
   `out/eval-runs/<case>/` when `result.briefs.length > 0`; on an all-failure
   run keep prior specimens and write `failure-messages.json` instead.

Tests first (tdd) in `tools/categorizer/eval/` test files: preflight
missing-key exit path, wipe-guard on zero-brief results, rebaseline bypass.

Model/effort/invocation: mechanical — main thread, medium effort suffices
(any capable model; no subagent needed).

### PR B — prompt-builder text dedupe (folded ticket scope)

Branch `refactor/BRIEF-67/prompt-prose-dedupe`, base main. ~250–400 LOC
(mostly moved lines + snapshot fixtures).

The three builders in `packages/brief-core/src/prompt.ts`
(`buildSystemPrompt`, `buildDeltaSystemPrompt`,
`buildRevisionNarrativeSystemPrompt`) duplicate text rules (line-range rules
etc.) and share only RISK_GLOSS; every description edit needs manual multi-way sync
— part of how BRIEF-55/69 edits had unintended grouping side effects.

1. First commit: snapshot tests in `packages/brief-core/test/prompt.test.ts`
   pinning all three builders' full output (with and without repoContext for
   the brief builder).
2. Second commit: extract shared text blocks into module-level constants;
   snapshots must pass unchanged — **byte-identical is the gate, so no eval
   run** (per CLAUDE.md, no generation-surface change).

Model/effort/invocation: precision refactor — main thread, medium effort.
Verify by test exit codes, not eyeballing.

### PR C — grouping consolidation prompt fix

Branch `fix/BRIEF-67/grouping-consolidation`, base = PR B's branch. ~60–120
LOC prompt text + probe evidence. Generation-surface change ⇒ **eval gate
applies** (CLAUDE.md / BRIEF-59).

1. Wording change in the grouping instructions (now a shared constant from
   PR B): an all-new component's internal anatomy — types, hook/facade, view,
   styles — belongs to ONE change group; tests/stories and barrel/export
   wiring may stand apart. Derived directly from the specimen mechanism; keep
   it a consolidation rule, not a numeric group-count cap (components#11
   showed collapse-to-1 is the opposite failure).
2. Iterate: `pnpm -C tools/categorizer eval --case copybutton-new-export
   --runs 5` (~$0.45/probe, default config = anthropic:claude-opus-4-8;
   never `--config`). Target ≥4/5. Max 2 probes, then stop + report.
3. Full-source gate run (~$4) once the probe holds; report in the PR body.
   Watch the other grouping-adjacent case (`pure-move-persistence`) for
   regression.
4. NO rebaseline in this PR — that is BRIEF-74, which unblocks on merge.

Model/effort/invocation: design-subtle (prompt wording with cross-case blast
radius) — main thread, Fable, high effort.

## Out of scope (recorded for the ticket)

- Instructions-compliance eval case (per-model fixture): deferred until after
  PR C; its properties should be shaped by these variance findings.
- Cross-revision group continuity: stays not-built; revisit trigger unchanged
  (reviewer state keyed to group identity).
