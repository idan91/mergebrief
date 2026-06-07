# TODO

Active checklist. Items grouped by phase from `docs/mvp/validation-plan.md`. Gated phases stay unchecked until their gate is met.

## Phase 1 — Wizard-of-Oz C Test (active)

> Full Phase 1 protocol, PR candidates, and observation axes in [`phase-1.md`](./mvp/phase-1.md).

### Setup
- [ ] Pick 10–20 real PRs across mixed change types (refactor, lib-bump, schema-change, new-feature, pure-move, move-with-edits, generated-code, test-only, config-only)
- [ ] Decide PR sourcing — open-source repos? own past work? friendly company PRs (with permission)?
- [ ] Hand-label each PR per `briefs/labeling-workflow.md` (change-group model):
  - [ ] Chunk inventory — Concern + Role + weighted LoC (moves/generated excluded)
  - [ ] Change-groups — boundary rule, Summary (what not why), Categorization (dominant + secondary)
  - [ ] Playbook items per group's dominant Category + supporting-Concern checks
  - [ ] Risk-surface attributes per chunk
  - [ ] Concern view — weighted LoC rollup
  - [ ] Tricky-cases note (pre-registered, frozen)
- [ ] Write the per-category playbook library first (the templated checklists). Categories to cover at minimum:
  - [ ] `pure-move`
  - [ ] `move-with-edits`
  - [ ] `lib-bump`
  - [ ] `logic-refactor`
  - [ ] `new-feature`
  - [ ] `bugfix`
  - [ ] `schema-change`
  - [ ] `test-only`
  - [ ] `config-only`
  - [ ] `generated-code`
  - [ ] `dependency-update`
- [ ] Decide presentation format for Phase 1 (Notion doc / Loom walkthrough / markdown render / paper prototype). Pick one — fastest wins.
- [ ] Define a raw-diff-only baseline condition for behavior comparison

### Reviewer recruitment
- [ ] Identify 3–5 friendly reviewers spanning the four personas (PR author, human reviewer, tech lead, eng manager)
- [ ] Schedule observation sessions (live or async screen-recorded)
- [ ] Prepare observation protocol — what behaviors to log (read time on playbooks, navigation via categories, spontaneous mentions, dismissals, etc.)

### Run + analyze
- [ ] Run sessions
- [ ] Log behavior data per reviewer per PR
- [ ] Compare against baseline
- [ ] **Gate check:** behavior visibly moves vs raw diff. Reviewers reach for the structure unprompted. If yes → unlock Phase 2. If no → revisit wedge.

## Phase 2 — Categorizer Benchmark (gated, not active)

- [ ] Reuse Phase 1's hand-labeled PRs as gold set
- [ ] Choose model strategy (single model + prompt? multi-model ensemble? fine-tuned? structured-output schema?)
- [ ] Build categorizer prototype (no UI — CLI/script that takes a PR diff and outputs tagged chunks + brief)
- [ ] Define accuracy metrics:
  - [ ] Dominant-category agreement vs hand label (target: >80%)
  - [ ] Multi-tag overlap (precision + recall on secondary tags)
  - [ ] Per-domain breakdown (frontend / backend / infra)
  - [ ] "Uncertain" rate per category
  - [ ] Edge cases: mixed chunks, generated code, vendored deps
- [ ] Run categorizer on gold set, measure
- [ ] Expand sample beyond gold set (50–100 PRs of variety)
- [ ] (Parallel) Phase 1 round 2: broader reviewer audience with AI-tagged output (or mix of real + corrected). Test whether behavior signal holds when AI errors are present.
- [ ] **Gate check:** accuracy crosses threshold AND Phase 1 behavior signal holds with broader audience and AI labels. If yes → unlock Phase 3. If no → diagnose (taxonomy? model? data?).

## Phase 3 — Architecture & D Commit (gated, not active)

- [ ] Decide data model (mind-map space schema, brief cache schema, receipt schema)
- [ ] Pick persistence layer (Postgres + something for vector/embeddings if needed)
- [ ] Pick auth/identity stack (GitHub App + OAuth)
- [ ] Build web app shell
- [ ] Build GH App + webhooks (PR open → bot comment + permalink in PR description)
- [ ] Implement activation gate (manual first click → ACTIVATED state)
- [ ] Implement debounced delta compute on push
- [ ] Implement mind-map persistence per (PR × reviewer)
- [ ] Implement receipt generation + submit-to-GitHub flow
- [ ] First POC team onboarded

## Concurrent Track — Broader Discovery Interviews

From `docs/next-steps.md` PMF validation track. Runs in parallel, does not block phase work.

- [ ] Identify 8–12 interview targets across PR author / reviewer / tech lead / eng manager
- [ ] Prepare interview script anchored on the rubber-stamp moment ("walk me through the last AI-authored PR you merged — where did you stop reading?")
- [ ] Run interviews
- [ ] Log spontaneous mentions: do customers reach for intent-tagging / playbook engagement / private thinking space / receipt? Or do they describe wanting better bug catching?
- [ ] Synthesize: does qualitative N>10 confirm the wedge dimensions discovered in peer-network conversations?

## Open Questions to Revisit (from grilling)

These are decision-tree items deferred during scope grilling. Pick up when there's signal.

- [ ] Pricing model and ICP — separate session
- [ ] "Uncertain" threshold calibration — per-category, per-playbook, or global
- [ ] Two-reviewers-same-flag receipt UX — both reasons, latest only, or merged
- [ ] Bottoms-up POC flow for individuals before admin install

## Author Side (v2)

- [ ] Full grilling session for author-side scope (placeholder bullets in `initial-scope.md` not yet decision-tree-walked)
- [ ] Decide author-side surface (same web app / IDE plugin / CLI / pre-commit hook)
- [ ] Resolve cross-side mind-map visibility (author vs reviewer spaces on same PR)

## Done

_Items move here once completed. Empty for now._
