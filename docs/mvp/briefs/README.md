# Phase 1 Briefs

Hand-labeled briefs for the Phase 1 wizard-of-Oz C test. One file per PR. Format follows the structure in `../phase-1.md` (Hand-Labeling Protocol section).

**Before labeling, read [`labeling-workflow.md`](./labeling-workflow.md)** — the step-by-step process, in the order that produces best calibration. Different from the order the brief file lists its sections.

Naming convention:
- `<repo>-<PR-number>.md` — full brief (categorization + playbook + risk surface + tricky-cases note)
- `<repo>-<PR-number>.baseline.md` — baseline variant (summary only, no structure) for raw-diff comparison condition

Each brief draws categories from `../playbooks.md` and risk-surface attributes from `../risk-surface.md`.

## Set

Track 1 — gate evaluation (6 PRs, reviewer sessions):
- [ ] `nextjs-93940.md` — Fix cross-param leak with `prefetch={true}` and `cachedNavigations` (primary first label)
- [ ] (TBD — 5 more PRs spanning bugfix × 1 more, logic-refactor × 1, lib-bump × 1, move-with-edits × 1, new-feature × 1)

Track 2 — taxonomy stress-test (2 PRs, no reviewer sessions):
- [ ] (TBD — 1 mixed-no-dominant PR)
- [ ] (TBD — 1 outside-taxonomy PR)

Plus `drizzle-5331.md` as backup for either track (logic-refactor + new-feature mix; pick during selection pass).
