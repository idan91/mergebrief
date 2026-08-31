# BRIEF-176 — derive LoC counts mechanically (model stops counting lines)

Implementation plan. All decisions LOCKED on the ticket (BRIEF-176, sections
"Decisions (grilled 2026-08-14)" and "Prototype verdict") — this plan does not
re-open them; it sequences them.

## Locked decisions (gist)

1. Model attributes, code counts: `loc` + `concernView` leave the model schema
   and prompt (`## LoC` section deleted). Model keeps per-chunk `concern` +
   `addedRanges`/`removedRanges`.
2. Header/core totals derive from the parsed diff (`diff/revchanges.ts`);
   chunk/group counts derive from validated ranges clamped by **intersection
   with the diff's changed lines**. Gap = **unattributed remainder**, stored as
   per-file ranges (`{file, addedRanges, removedRanges}`), counts derived.
   Warn-only coverage warning. Remainder attaches to NO chunk.
3. `concernView` stays on the Brief type, populated by code post-generation
   (BriefGenerationSchema omission pattern); leaves `SALVAGE_FIELDS`.
4. Inter-chunk overlaps: counted in both chunks + warn-only. No dedupe.
5. gh cross-check: per-file `PrFile.additions/deletions` vs diff-derived
   per-file totals; warn-only, no threshold.
6. "adjusted" residue dies by construction (`types.ts` loc description,
   `prompt.ts` `## LoC`); grep for strays.
7. Eval pair-case props read derived counts; scoped eval runs, rebaseline
   where legitimately moved.
8. UI = **A+C** (prototyped, verdict on ticket): header "unattributed" stat +
   thin banner above the reading toolbar with per-file "Show lines" expansion.
   No colored accent border; labels lowercase.

## Git requirements (git-eng — mandatory for ALL git operations)

- Stacked branches off `main`, one per PR below; branch names
  `feature/BRIEF-176/<slug>`; PR titles `[BRIEF-176] <prefix>: Title Case`.
- **Chunked commits** per logical unit; **performance-reviewer** runs on
  staged changes before every commit (findings ≥80 confidence: fix, re-stage,
  re-run until clean).
- No `Co-Authored-By` trailers; no AI-attribution in PR bodies.
- Push via HTTPS + gh helper. After each squash-merge: realign the stack with
  `rebase --onto` (patch-id proof), never plain-pull a rebased branch.
- `reviewer` subagent reviews each PR branch before handoff; Idan
  merges. Review-loop severity: medium+ iterate, nitpick-only = clean.
  2 rounds max.

## Mandatory specialist skills

`typescript-eng`, `test-driven-development` (derivation engine is pure-function
heavy — test-first), `web-accessibility` (PR 4 surfaces), `verify` (runtime
drive after PR 4), `impeccable` (post-implementation audit pass — owed).

## PR stack

### PR 1 — feat: LoC derivation engine (packages/brief-core)

Pure functions + tests, no pipeline wiring. New `generation/loc.ts` (or
sibling): per-file changed-line sets from `diff/revchanges.ts`; per-chunk
counts = |chunk ranges ∩ changed lines|; unattributed remainder = per-file
complement of the union of chunk ranges, as ranges; concernView rollup builder
from chunks; per-file gh cross-check comparator. Inter-chunk overlap
detection (report, never dedupe).

- Est. ~350–600 LOC incl. tests. Model: **Fable 5, high** (subtle range
  arithmetic). TDD. Main thread.

### PR 2 — refactor: schema + prompt + pipeline wiring (brief-core, generators)

Drop `loc` from chunk model surface and `concernView` from
`BriefGenerationSchema` (omission pattern like warnings/anchoring); remove
`concernView` from `SALVAGE_FIELDS`; delete prompt `## LoC` section + LoC
mentions (`prompt.ts:204/206/308-310/373`); wire derivation post-generation
(populate chunk `loc`, `concernView`, new `unattributed` field on Brief);
validator warnings: coverage gap + overlap (extend `validatePartition`
coverage), gh mismatch. Grep "adjusted" strays. Brief-core fixture churn.

- **Eval-gated surface — deferred to end of stack, Idan-run only**: the agent
  NEVER runs evals. After PR 4 is up and before merging, the agent hands Idan
  the scoped case selection (`--case` per plausibly-moved case, selection
  justified) and the exact commands; Idan optionally runs
  `pnpm -C tools/categorizer eval` himself and pastes the report into this
  PR's body. Pair-case props (`eval/pair-cases/props.ts`) read
  post-derivation briefs; rebaseline only where legitimately moved, on main.
- Est. ~500–900 LOC incl. fixtures. Model: **Fable 5, high**. Main thread,
  after PR 1.

### PR 3 — refactor: consumers (worker, CLI, apps/web data layer)

Worker anchoring rollup (`anchoring.ts:459-472`) switches to the shared
builder; CLI artifact output unchanged in shape; web: wire-type mirrors
(`apps/web/.../types.ts`), `viewModel.ts` totals from brief-level derived
data + `unattributed` exposure on the view model, `buildConcernView`
(`validation.ts:1156`) consumes derived counts; fixture churn (worker, web
characterization, e2e perf `generateFixture.ts`).

- Est. ~600–1000 LOC (fixture-heavy; mechanical). If web data churn pushes
  past ~1000, split worker/CLI vs web-data into two PRs at that seam.
  Model: **Opus 5, high** (execution, little design). Main thread, after PR 2.

### PR 4 — feat: unattributed UI (apps/web)

The A+C verdict, from the prototype recipes (ticket "Prototype verdict"):

- Header stats group → **one grid**: `grid-auto-flow: column;
  grid-template-rows: auto auto`; each stat `grid-row: span 2;
  grid-template-rows: subgrid`. NEVER `align-items: baseline` on it (measured
  ~1.3px row inflation). `CoreLinesDisclosure`'s classless wrapper span:
  `display: contents`.
- Divider bug fix rides here: `.stat { border: 0 }` swallows the statsGroup
  `> * + *` divider (chunks/flags have none today) — repaint via
  `.statsGroup > * + .stat` placed after the reset.
- "unattributed" stat mirrors core lines (lowercase label, amber dot), click
  opens callout: per-file breakdown + "attributed X of Y" caveat
  (CoreLinesDisclosure grammar: hover-preview mouse-only, click canonical,
  Escape-at-capture, close-on-scroll).
- Thin banner between summary and reading toolbar: counts + "not covered by
  any chunk" + "Show lines" toggle → per-file rows → actual diff lines via
  `diffSlicing.ts`/`RawSpanDiff` synthesis. Plain `--line` border.
- All copy through `packages/i18n` catalog. `data-testid` + `data-state` at
  birth. Render-proof: compile, screenshot, measure before handoff
  (fixture harness: `MERGEBRIEF_OUT_DIR=apps/web/e2e/fixtures/briefs
  pnpm --filter @code-review/web dev` → `/briefs/mergebrief-e2e-fixture-1_2_22222222`).
  Prototype snapshot: scratchpad `brief-176-prototype.patch` +
  `UnattributedPrototype-ref/` (session 4a17dc2f).

- **/impeccable audit rides this PR**: after the UI is render-proofed, the
  agent runs the impeccable audit on the rendered header + banner (fixture
  harness) and applies its findings to this branch before handoff.
- Est. ~450–800 LOC. Model: **Fable 5, high** (UI polish + a11y). Skills:
  `web-accessibility`, `impeccable`, `verify` after merge-ready. Main thread,
  after PR 3.

## End-of-stack, pre-merge (optional, Idan-run)

- Scoped eval pass for PR 2's generation-surface change — Idan runs it
  himself if he chooses (live API spend; the agent never invokes the eval
  harness). Agent's part: deliver the justified case selection + exact
  commands; Idan pastes the report into the PR 2 body.

## Post-merge owes

- Eval rebaseline on main where the scoped runs legitimately moved.
- Delete this plan's prototype snapshot from scratchpad once PR 4 lands.

## Invocation summary

Sequential main-thread stack (each PR depends on the previous): PR 1 → 2
(Fable 5 high) → PR 3 (Opus 5 high) → PR 4 (Fable 5 high). No parallel
subagent implementation; `reviewer` + `performance-reviewer` gates as
above.
