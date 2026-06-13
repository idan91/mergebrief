# TODO

Active checklist. Items grouped by phase from `docs/mvp/validation-plan.md`. Gated phases stay unchecked until their gate is met.

## ⮕ Reshape follow-ups (2026-06-13) — do before resuming Phase 1

From the direction reshape — full statement in [`mvp/center-of-gravity.md`](./mvp/center-of-gravity.md).

- [ ] **(GATING) Redefine the Phase 1 experiment** around the new center of gravity (does *story + risk-surface + delta* move reviewer behavior) — the current Treatment-vs-B′ tests the now-demoted playbook. Do this **before labeling any PRs**.
- [ ] **Grill the author-side self-review brief** — promoted to v1 but never decision-tree-walked. Hold scope loosely; keep it on the same web app.
- [ ] **Re-derive the moat** given taxonomy-secondary + playbook-demoted (delta + comment-to-rule + dual-consumer + create-to-merge workflow).
- [ ] **Write/revisit ADRs:** revisit 0004 (mind-map → persistence only); amend 0002 (receipt → org-quality-audit role); new ADRs for draft-first activation, author-side-in-v1, playbook demotion.
- [ ] Define the OSS / zero-install free tier minimally (individual + reviewer-side-only + distribution).
- [ ] Spec the comment-to-rule governance (role-gated promotion via CODEOWNERS / repo-YAML approvers; rules land as PRs) — v2+, but lock the guardrails now.
- [ ] Later: update `mockup/` + `mockup/ux.md` to reflect demotions (playbook collapsed/optional, author view) — not urgent.

## Phase 1 — Wizard-of-Oz C Test (active — paused pending redefinition above)

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
  - [ ] `dependency-update`
  - [ ] Supporting-Concern checks for `test` / `config` / `generated` (these are Concern values now, not Categories — see CONTEXT.md flagged ambiguities)
- [ ] Decide presentation format for Phase 1 (Notion doc / Loom walkthrough / markdown render / paper prototype). Pick one — fastest wins.
- [ ] Generate Baseline B′ renderings from the full briefs (taxonomy/playbooks/risk-surface stripped — see `phase-1.md`; raw-diff baseline dropped 2026-06-07)
- [ ] Label the Track 3 re-review PR: brief at base SHA + hand-built delta brief for the follow-up push

### Discovery interviews (run BEFORE first reviewer session — see next-steps.md sequencing note 2026-06-09)
- [ ] Send interview asks (6+ targets; interviewees are excluded from the Phase 1 reviewer pool — see script pool rule)
- [ ] Run ≥4 discovery interviews per [`docs/interviews/script.md`](./interviews/script.md); fill capture sheet within 1 hour of each
- [ ] Write `docs/interviews/synthesis.md` (5 gate questions in the script); fold findings into PR selection + playbook content before labeling the remaining gate PRs

### Reviewer recruitment
- [ ] Identify 3–5 friendly reviewers (senior/staff/tech-lead per `phase-1.md`; don't reveal which condition is "ours")
- [ ] Schedule observation sessions (async screen-recording + 15-min debrief; debrief tail doubles as discovery interview)
- [ ] Prepare observation protocol — what behaviors to log (read time on playbooks, navigation via categories, spontaneous mentions, dismissals, wall-clock time per PR per condition)

### Run + analyze
- [ ] Run sessions
- [ ] Log behavior data per reviewer per PR (incl. wall-clock time per condition — guardrail)
- [ ] Score hard-case matches blind (condition labels stripped, one sitting — see `phase-1.md` pre-registration discipline)
- [ ] Compare Treatment vs Baseline B′
- [ ] **Gate check:** hard-case detection delta over B′ + ≥2/3 confirmation families (`phase-1.md`). Time-cost guardrail can downgrade pass → ambiguous. If pass → unlock Phase 2. If fail → revisit wedge.

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
